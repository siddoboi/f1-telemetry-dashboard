"""
FastAPI application - REST + WebSocket entry points.

REST (populate selector dropdowns, profile cards, exports):
  GET /api/health
  GET /api/schedule/{year}
  GET /api/sessions/{year}/{round}
  GET /api/drivers/{year}/{round}/{session}
  GET /api/laps/{year}/{round}/{session}/{driver}
  GET /api/profile/{year}/{round}/{session}/{driver}
  GET /api/history
  GET /api/export/csv
  GET /api/export/pdf

WebSocket /ws/replay:
  client -> {"action":"start", ...ReplayRequest}        replay a FastF1 session
            {"action":"start_history", "laps":[...]}     replay saved laps (Mongo)
            {"action":"pause"|"resume"|"speed"|"stop"}
  server -> {"type":"status"|"meta"|"frame"|"complete"|"error"}

Live mode (OpenF1) is intentionally not wired here: OpenF1's live feed requires
a paid Sponsor subscription and is only active during race weekends. OpenF1 is
still used (free tier) for driver headshots in the profile card. All telemetry,
schedules, lap times and GPS come from FastF1, which supports every season
including the current one.
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, \
    WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import config
from app.data import database, fastf1_loader as f1, openf1_client as of1
from app.export import report as export_report
from app.logging_setup import setup_logging
from app.ml.anomaly_detector import (AnomalyDetector, extract_events,
                                      score_rules_only)
from app.ml.physics_rules import agreement_report
from app.models.schemas import ReplayRequest
from app.replay.history_serve import build_history_comparison
from app.replay.replay_engine import ReplayEngine, FRAME_COLS

setup_logging()
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await database.connect()
    yield


app = FastAPI(title="F1 Telemetry & Driver Consistency API", lifespan=lifespan)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500,
                        content={"error": exc.__class__.__name__,
                                 "detail": str(exc),
                                 "path": request.url.path})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code,
                        content={"error": "HTTPException",
                                 "detail": exc.detail,
                                 "path": request.url.path})


app.add_middleware(CORSMiddleware, allow_origins=[config.FRONTEND_ORIGIN],
                   allow_methods=["*"], allow_headers=["*"])


# ----------------------------------------------------------------- REST ----
@app.get("/api/health")
async def health():
    return {"status": "ok", "mongo": database.is_available()}


@app.get("/api/schedule/{year}")
async def schedule(year: int):
    return await run_in_threadpool(f1.get_schedule, year)


@app.get("/api/sessions/{year}/{rnd}")
async def sessions(year: int, rnd: int):
    return await run_in_threadpool(f1.get_session_types, year, rnd)


@app.get("/api/drivers/{year}/{rnd}/{session}")
async def drivers(year: int, rnd: int, session: str):
    return await run_in_threadpool(f1.get_drivers, year, rnd, session)


@app.get("/api/laps/{year}/{rnd}/{session}/{driver}")
async def laps(year: int, rnd: int, session: str, driver: str):
    return await run_in_threadpool(f1.get_driver_laps, year, rnd,
                                   session, driver)


@app.get("/api/profile/{year}/{rnd}/{session}/{driver}")
async def profile(year: int, rnd: int, session: str, driver: str):
    """FastF1 performance stats + best-effort OpenF1 headshot (free tier)."""
    stats = await run_in_threadpool(f1.driver_session_stats, year, rnd,
                                    session, driver)
    bio = await of1.headshot_for(year, driver)     # returns None on any failure
    if bio:
        stats["headshot_url"] = bio.get("headshot_url")
        stats["country"] = bio.get("country")
        stats.setdefault("full_name", bio.get("name"))
    return stats


@app.get("/api/history")
async def history():
    return await database.get_saved_laps()


# -------------------------------------------------------------- export ----
_EXPORT_CACHE: dict = {"meta": None, "scored_laps": None, "name": "export"}


def _cache_export(meta, scored_laps, name):
    _EXPORT_CACHE.update(meta=meta, scored_laps=scored_laps, name=name)


@app.get("/api/export/csv")
async def export_csv():
    if not _EXPORT_CACHE["scored_laps"]:
        raise HTTPException(404, "No comparison loaded yet - start a replay "
                                 "or load saved laps first.")
    data = export_report.build_csv_zip(_EXPORT_CACHE["meta"],
                                       _EXPORT_CACHE["scored_laps"])
    return Response(data, media_type="application/zip", headers={
        "Content-Disposition":
            f'attachment; filename="{_EXPORT_CACHE["name"]}.zip"'})


@app.get("/api/export/pdf")
async def export_pdf():
    if not _EXPORT_CACHE["scored_laps"]:
        raise HTTPException(404, "No comparison loaded yet - start a replay "
                                 "or load saved laps first.")
    data = export_report.build_pdf(_EXPORT_CACHE["meta"],
                                   _EXPORT_CACHE["scored_laps"])
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition":
            f'attachment; filename="{_EXPORT_CACHE["name"]}.pdf"'})


# ----------------------------------------------------- replay preparation ----
def _prepare(req: ReplayRequest) -> dict:
    """Blocking FastF1 download + ML scoring. Runs in a threadpool."""
    comp = f1.build_comparison(req.year, req.round, req.session, req.drivers,
                               req.lap_numbers, req.baseline_mode,
                               req.baseline_override)
    meta = {"type": "meta", "mode": "replay",
            "baseline_mode": req.baseline_mode,
            "baseline_owner": comp.get("baseline_owner"),
            "baseline_lap_time": comp.get("baseline_lap_time"),
            "track": comp.get("track"),
            "drivers": {}, "events": [], "validation": {}}
    scored_laps = {}

    for drv, info in comp["drivers"].items():
        if info["baseline"] is None:                      # baseline OFF
            scored = score_rules_only(info["comparison"])
            scored_laps[drv] = scored
            meta["events"].extend(extract_events(scored, drv))
            meta["drivers"][drv] = {
                "meta": info["meta"], "lap_number": info["lap_number"],
                "lap_time": info["lap_time"],
                "baseline_driver": None, "baseline_lap_time": None,
                "baseline": {}}
            continue

        det = AnomalyDetector().fit(info["baseline"]["df"])
        scored = det.score(info["comparison"], info["baseline"]["df"])
        base_t = info["baseline"]["df"]["time_s"].to_numpy()
        n = min(len(scored), len(base_t))
        scored = scored.iloc[:n].copy()
        scored["delta"] = (scored["time_s"].to_numpy()[:n]
                           - base_t[:n]).round(3)
        scored_laps[drv] = scored

        meta["events"].extend(extract_events(scored, drv))
        meta["validation"][drv] = agreement_report(
            scored, scored["anomaly"].to_numpy())

        base_df = info["baseline"]["df"]
        meta["drivers"][drv] = {
            "meta": info["meta"], "lap_number": info["lap_number"],
            "lap_time": info["lap_time"],
            "baseline_driver": info["baseline"]["driver"],
            "baseline_lap_time": info["baseline"]["lap_time"],
            "baseline": {
                "distance": base_df["distance"].round(1).tolist(),
                "speed": base_df["speed"].round(1).tolist(),
                "throttle": base_df["throttle"].round(1).tolist(),
                "brake": base_df["brake"].round(1).tolist(),
                "rpm": base_df["rpm"].round(0).tolist(),
                "gear": base_df["gear"].tolist(),
            }}
    meta["events"].sort(key=lambda e: e["start_distance"])
    return {"meta": meta, "scored_laps": scored_laps}


# ------------------------------------------------------------ WebSocket ----
@app.websocket("/ws/replay")
async def ws_replay(ws: WebSocket):
    await ws.accept()
    engine: ReplayEngine | None = None
    stream_task: asyncio.Task | None = None
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            action = msg.get("action")

            if action == "start":
                if stream_task:
                    if engine:
                        engine.stop()
                    stream_task.cancel()
                req = ReplayRequest(**{k: v for k, v in msg.items()
                                       if k != "action"})
                await ws.send_json({"type": "status",
                                    "message": "Loading session data "
                                               "(first load can take a "
                                               "while)..."})
                try:
                    prepared = await run_in_threadpool(_prepare, req)
                except Exception as exc:                       # noqa: BLE001
                    log.exception("replay prepare failed")
                    await ws.send_json({"type": "error",
                                        "message": f"Could not load this "
                                                   f"session: {exc}"})
                    continue
                _cache_export(prepared["meta"], prepared["scored_laps"],
                              f"pitwall_{req.year}_R{req.round}_{req.session}")
                await ws.send_json(prepared["meta"])
                engine = ReplayEngine(prepared["scored_laps"],
                                      req.tick_rate_hz)
                stream_task = asyncio.create_task(
                    _stream(ws, engine, req, prepared["scored_laps"],
                            prepared["meta"]))

            elif action == "start_history":
                if stream_task:
                    if engine:
                        engine.stop()
                    stream_task.cancel()
                lap_reqs = msg.get("laps", [])[:config.MAX_DRIVERS]
                if not lap_reqs:
                    await ws.send_json({"type": "error",
                                        "message": "No saved laps selected."})
                    continue
                if not database.is_available():
                    await ws.send_json({"type": "error",
                                        "message": "MongoDB is not running - "
                                                   "history mode needs it."})
                    continue
                await ws.send_json({"type": "status",
                                    "message": "Loading saved laps from the "
                                               "database..."})
                frames = [await database.load_lap_frames(
                              r["year"], r["round"], r["session"],
                              r["driver"], r["lap"]) for r in lap_reqs]
                try:
                    prepared = build_history_comparison(lap_reqs, frames)
                except ValueError as exc:
                    await ws.send_json({"type": "error",
                                        "message": str(exc)})
                    continue
                _cache_export(prepared["meta"], prepared["scored_laps"],
                              f"pitwall_history_{lap_reqs[0]['year']}"
                              f"_R{lap_reqs[0]['round']}")
                await ws.send_json(prepared["meta"])
                engine = ReplayEngine(prepared["scored_laps"],
                                      msg.get("tick_rate_hz"))
                stream_task = asyncio.create_task(_stream_simple(ws, engine))

            elif action == "pause" and engine:
                engine.pause()
            elif action == "resume" and engine:
                engine.resume()
            elif action == "speed" and engine:
                engine.set_speed(float(msg.get("value", 1.0)))
            elif action == "seek" and engine:
                engine.seek_to_distance(float(msg.get("value", 0.0)))
            elif action == "stop" and engine:
                engine.stop()
    except WebSocketDisconnect:
        if engine:
            engine.stop()
        if stream_task:
            stream_task.cancel()
    except Exception as exc:                                   # noqa: BLE001
        log.exception("replay error")
        try:
            await ws.send_json({"type": "error", "message": str(exc)})
        except RuntimeError:
            pass


async def _stream_simple(ws: WebSocket, engine: ReplayEngine) -> None:
    """Stream without persisting (history laps are already in Mongo)."""
    try:
        async for frame in engine.frames():
            await ws.send_json(frame)
    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        engine.stop()


async def _stream(ws: WebSocket, engine: ReplayEngine,
                  req: ReplayRequest, scored_laps, full_meta: dict) -> None:
    try:
        async for frame in engine.frames():
            await ws.send_json(frame)
        # persist frames + per-lap v2 meta so a future load of this session
        # serves instantly with track map, events and baseline intact
        for drv, df in scored_laps.items():
            lap_no = (req.lap_numbers.get(drv, -1)
                      if req.lap_numbers else -1)
            frames = df[[c for c in FRAME_COLS
                         if c in df.columns]].to_dict("records")
            await database.save_lap_frames(
                req.year, req.round, req.session, drv, lap_no, frames)

            drv_meta = full_meta.get("drivers", {}).get(drv, {})
            lap_events = [e for e in full_meta.get("events", [])
                          if e.get("driver") == drv]
            await database.save_lap_meta(
                req.year, req.round, req.session, drv, lap_no, {
                    "events": lap_events,
                    "baseline": drv_meta.get("baseline", {}),
                    "baseline_driver": drv_meta.get("baseline_driver"),
                    "baseline_lap_time": drv_meta.get("baseline_lap_time"),
                    "lap_time": drv_meta.get("lap_time"),
                    "driver_meta": drv_meta.get("meta", {}),
                    "validation": full_meta.get("validation", {}).get(drv),
                })
    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        engine.stop()
