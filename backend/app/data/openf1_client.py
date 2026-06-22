"""
OpenF1 API client - historical data only.

Live car-data polling (LiveEngine) has been removed from this build.
Live mode requires the OpenF1 Sponsor tier (€9.90/month) and is only
active during race weekends. It is documented as a future feature.

What this file still does:
  - Detect whether a live session is happening (for informational display)
  - Fetch driver headshots for the profile overlay
  - Both work on the free Community tier for historical sessions
"""
import logging

import httpx

from app import config

log = logging.getLogger(__name__)

_http = httpx.AsyncClient(base_url=config.OPENF1_BASE, timeout=15)


async def _get(path: str, **params) -> list[dict]:
    r = await _http.get(path, params=params)
    r.raise_for_status()
    return r.json()


async def live_session() -> dict | None:
    """Return current OpenF1 session if one is active, else None.
    Returns None (not an error) on 401/403 - Sponsor tier required for
    live endpoints on the current season."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    try:
        sessions = await _get("/sessions", year=now.year)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            log.debug("OpenF1 live session check: Sponsor tier required "
                      "(year=%s)", now.year)
            return None
        log.warning("OpenF1 unreachable: %s", exc)
        return None
    except httpx.HTTPError as exc:
        log.warning("OpenF1 unreachable: %s", exc)
        return None
    for s in sessions:
        try:
            from datetime import datetime
            start = datetime.fromisoformat(
                s["date_start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(
                s["date_end"].replace("Z", "+00:00"))
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
    """Best-effort headshot lookup for the profile card (historical only).
    Returns None silently on any error including 401."""
    try:
        sessions = await _get("/sessions", year=year)
        for s in reversed(sessions):
            try:
                drivers = await session_drivers(s["session_key"])
                for d in drivers:
                    if d["code"] == code:
                        return d
            except httpx.HTTPError:
                continue
    except (httpx.HTTPStatusError, httpx.HTTPError):
        pass
    return None
