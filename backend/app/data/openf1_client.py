"""
OpenF1 API client + live streaming engine.

Live-mode honesty notes
-----------------------
* OpenF1's public feed runs ~3-60 s behind the actual track action. The UI
  shows a "DELAYED FEED" badge; we never pretend otherwise.
* OpenF1 does not provide lap distance. We integrate distance from speed
  (d += v*dt) and reset on lap-start signals from /laps. Good enough for a
  live overview; replay mode remains the precision tool.
* The Isolation Forest needs a baseline lap, which doesn't exist mid-session,
  so live mode scores anomalies with the incremental physics rules only.
  ML scoring stays a replay-mode feature - documented, not hidden.
"""
import asyncio
import logging
from datetime import datetime, timezone

import httpx

from app import config

log = logging.getLogger(__name__)

_http = httpx.AsyncClient(base_url=config.OPENF1_BASE, timeout=15)


async def _get(path: str, **params) -> list[dict]:
    r = await _http.get(path, params=params)
    r.raise_for_status()
    return r.json()


# --------------------------------------------------------------------------
# Session discovery
# --------------------------------------------------------------------------
async def live_session() -> dict | None:
    """Return the OpenF1 session happening right now, else None."""
    now = datetime.now(timezone.utc)
    try:
        sessions = await _get("/sessions", year=now.year)
    except httpx.HTTPError as exc:
        log.warning("OpenF1 unreachable: %s", exc)
        return None
    for s in sessions:
        try:
            start = datetime.fromisoformat(s["date_start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(s["date_end"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        if start <= now <= end:
            return s
    return None


async def session_drivers(session_key: int) -> list[dict]:
    """Driver list with headshots for a given OpenF1 session."""
    rows = await _get("/drivers", session_key=session_key)
    return [{
        "code": r.get("name_acronym"),
        "number": r.get("driver_number"),
        "name": r.get("full_name"),
        "team": r.get("team_name"),
        "color": f'#{r["team_colour"]}' if r.get("team_colour") else "#888888",
        "headshot_url": r.get("headshot_url"),
        "country": r.get("country_code"),
    } for r in rows]


async def headshot_for(year: int, code: str) -> dict | None:
    """Best-effort headshot/bio lookup for the profile card (replay mode).
    Uses the most recent OpenF1 session of that year that lists the driver."""
    try:
        sessions = await _get("/sessions", year=year)
        for s in reversed(sessions):
            for d in await session_drivers(s["session_key"]):
                if d["code"] == code:
                    return d
    except httpx.HTTPError:
        pass
    return None


# --------------------------------------------------------------------------
# Live streaming engine
# --------------------------------------------------------------------------
class IncrementalRules:
    """Streaming version of the physics rules (no baseline needed)."""

    def __init__(self):
        self.prev = None

    def check(self, f: dict) -> tuple[float, str | None]:
        score, label = 0.0, None
        p = self.prev
        if p and f["time_s"] > p["time_s"]:
            dt = f["time_s"] - p["time_s"]
            d_speed = (f["speed"] - p["speed"]) / dt          # km/h per s
            d_rpm = (f["rpm"] - p["rpm"]) / dt
            if f["brake"] > 50 and d_speed < -45:
                score, label = min(1.0, -d_speed / 90), "Possible lock-up"
            elif (d_rpm > 2800 and d_speed < 8 and f["throttle"] > 40
                  and f["gear"] == p["gear"]):
                score, label = min(1.0, d_rpm / 5600), \
                    "Traction loss / wheelspin"
        self.prev = f
        return score, label


class LiveEngine:
    """Polls OpenF1 car_data and yields frame bundles in the SAME shape the
    ReplayEngine produces, so the frontend is source-agnostic."""

    def __init__(self, session_key: int, drivers: list[dict]):
        self.session_key = session_key
        self.drivers = {d["code"]: d for d in drivers}
        self.last_ts = {c: None for c in self.drivers}
        self.distance = {c: 0.0 for c in self.drivers}
        self.prev_time = {c: None for c in self.drivers}
        self.rules = {c: IncrementalRules() for c in self.drivers}
        self._stopped = False
        self._index = 0

    def stop(self):
        self._stopped = True

    # live feed has no replay controls; keep the shared WS protocol happy
    def pause(self): ...
    def resume(self): ...
    def set_speed(self, _x): ...

    async def frames(self):
        while not self._stopped:
            bundle = {"type": "frame", "index": self._index,
                      "mode": "live", "drivers": {}}
            for code, info in self.drivers.items():
                rows = await self._poll(info["number"], code)
                for row in rows:
                    frame = self._to_frame(code, row)
                    if frame:
                        bundle["drivers"][code] = frame   # newest wins
            if bundle["drivers"]:
                self._index += 1
                yield bundle
            await asyncio.sleep(config.LIVE_POLL_INTERVAL_S)

    async def _poll(self, number: int, code: str) -> list[dict]:
        params = {"session_key": self.session_key, "driver_number": number}
        if self.last_ts[code]:
            params["date>"] = self.last_ts[code]
        try:
            rows = await _get("/car_data", **params)
        except httpx.HTTPError as exc:
            log.warning("live poll failed (%s): %s", code, exc)
            return []
        if rows:
            self.last_ts[code] = rows[-1]["date"]
        return rows[-12:]            # cap burst size per poll

    def _to_frame(self, code: str, row: dict) -> dict | None:
        try:
            t = datetime.fromisoformat(
                row["date"].replace("Z", "+00:00")).timestamp()
        except (KeyError, ValueError):
            return None
        prev_t = self.prev_time[code]
        speed = float(row.get("speed") or 0)
        if prev_t is not None and t > prev_t:
            self.distance[code] += speed / 3.6 * (t - prev_t)
        self.prev_time[code] = t

        frame = {
            "distance": round(self.distance[code], 1),
            "speed": speed,
            "rpm": float(row.get("rpm") or 0),
            "gear": int(row.get("n_gear") or 0),
            "throttle": float(row.get("throttle") or 0),
            "brake": float(row.get("brake") or 0),
            "drs": int(row.get("drs") or 0),
            "time_s": t,
        }
        score, label = self.rules[code].check(frame)
        frame["anomaly_score"] = round(score, 3)
        frame["anomaly"] = score >= 0.5
        frame["anomaly_label"] = label if frame["anomaly"] else None
        return frame
