"""
FastAPI application - REST + WebSocket entry points.

REST (used to populate the selector dropdowns):
  GET /api/health
  GET /api/schedule/{year}
  GET /api/sessions/{year}/{round}
  GET /api/drivers/{year}/{round}/{session}
  GET /api/laps/{year}/{round}/{session}/{driver}
  GET /api/history                       (laps persisted in MongoDB)

WebSocket (the live dashboard feed):
  WS /ws/replay
    client -> {"action":"start", ...ReplayRequest fields}
    server -> {"type":"status"...} while loading
              {"type":"meta"...}   baseline arrays + anomaly events + validation
              {"type":"frame"...}  10x per second
              {"type":"complete"}
    client -> {"action":"pause"|"resume"|"speed","value":2.0|"stop"}
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.data import database, fastf1_loader as f1
from app.ml.anomaly_detector import AnomalyDetector, extract_events
from app.ml.physics_rules import agreement_report
from app.models.schemas import ReplayRequest
from app.replay.replay_engine import ReplayEngine, FRAME_COLS

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await database.connect()
    yield

app = FastAPI(title="F1 Telemetry & Driver Consistency API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/api/history")
async def history():
    return await database.get_saved_laps()


# ------------------------------------------------------------ WebSocket ----
def _prepare(req: ReplayRequest) -> dict:
    """Blocking heavy lifting (FastF1 download + ML). Runs in a threadpool."""
    comp = f1.build_comparison(req.year, req.round, req.session, req.drivers,
                               req.lap_numbers, req.baseline_mode)
    meta = {"type": "meta", "baseline_mode": req.baseline_mode,
            "baseline_owner": comp.get("baseline_owner"),
            "baseline_lap_time": comp.get("baseline_lap_time"),
            "drivers": {}, "events": [], "validation": {}}
    scored_laps = {}

    for drv, info in comp["drivers"].items():
        det = AnomalyDetector().fit(info["baseline"]["df"])
        scored = det.score(info["comparison"], info["baseline"]["df"])
        scored_laps[drv] = scored
        events = extract_events(scored, drv)
        meta["events"].extend(events)
        meta["validation"][drv] = agreement_report(
            scored, scored["anomaly"].to_numpy())

        base_df = info["baseline"]["df"]
        meta["drivers"][drv] = {
            "meta": info["meta"],
            "lap_number": info["lap_number"],
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
            },
        }
    meta["events"].sort(key=lambda e: e["start_distance"])
    return {"meta": meta, "scored_laps": scored_laps}


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
                    engine.stop()
                    stream_task.cancel()
                req = ReplayRequest(**{k: v for k, v in msg.items()
                                       if k != "action"})
                await ws.send_json({"type": "status",
                                    "message": "Loading session data "
                                               "(first load can take a while)..."})
                prepared = await run_in_threadpool(_prepare, req)
                await ws.send_json(prepared["meta"])
                engine = ReplayEngine(prepared["scored_laps"],
                                      req.tick_rate_hz)
                stream_task = asyncio.create_task(
                    _stream(ws, engine, req, prepared["scored_laps"]))

            elif action == "pause" and engine:
                engine.pause()
            elif action == "resume" and engine:
                engine.resume()
            elif action == "speed" and engine:
                engine.set_speed(float(msg.get("value", 1.0)))
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


async def _stream(ws: WebSocket, engine: ReplayEngine,
                  req: ReplayRequest, scored_laps) -> None:
    try:
        async for frame in engine.frames():
            await ws.send_json(frame)
        # after a finished replay, persist each lap to MongoDB
        for drv, df in scored_laps.items():
            frames = df[[c for c in FRAME_COLS
                         if c in df.columns]].to_dict("records")
            await database.save_lap_frames(
                req.year, req.round, req.session, drv,
                req.lap_numbers.get(drv, -1) if req.lap_numbers else -1,
                frames)
    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        engine.stop()
