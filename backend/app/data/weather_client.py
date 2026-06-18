"""
Weather client - historical track conditions via Open-Meteo (free, no auth).

Given a session (year/round/session), we resolve the circuit's GPS coordinate
and the session's date from FastF1, then query Open-Meteo's historical archive
for hourly air temperature, humidity, wind, precipitation and cloud cover over
the session window. Track surface temperature is estimated from air temp + a
solar/cloud adjustment (FastF1's free path has no real track-temp sensor).

Open-Meteo archive API: https://archive-api.open-meteo.com/v1/archive
No API key required. Hourly resolution.
"""
import logging
from datetime import timedelta

import httpx

log = logging.getLogger(__name__)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

# WMO weather interpretation codes -> short label + icon key
WMO = {
    0: ("Clear sky", "sun"),
    1: ("Mainly clear", "sun"),
    2: ("Partly cloudy", "cloud-sun"),
    3: ("Overcast", "cloud"),
    45: ("Fog", "fog"), 48: ("Rime fog", "fog"),
    51: ("Light drizzle", "drizzle"), 53: ("Drizzle", "drizzle"),
    55: ("Dense drizzle", "drizzle"),
    61: ("Light rain", "rain"), 63: ("Rain", "rain"),
    65: ("Heavy rain", "rain"),
    71: ("Light snow", "snow"), 73: ("Snow", "snow"), 75: ("Heavy snow", "snow"),
    80: ("Light showers", "rain"), 81: ("Showers", "rain"),
    82: ("Violent showers", "rain"),
    95: ("Thunderstorm", "storm"),
    96: ("Thunderstorm + hail", "storm"), 99: ("Thunderstorm + hail", "storm"),
}


def _wmo(code) -> dict:
    label, icon = WMO.get(int(code) if code is not None else -1,
                          ("Unknown", "cloud"))
    return {"label": label, "icon": icon, "code": code}


def _estimate_track_temp(air_c, cloud_pct):
    """Rough track-surface estimate: asphalt runs hotter than air under sun,
    the gap shrinking with cloud cover. Not a sensor reading - clearly an
    estimate. Typical dry sunny F1 delta is +15-20C; overcast ~ +3-5C."""
    if air_c is None:
        return None
    clear = 1.0 - (cloud_pct or 0) / 100.0
    return round(air_c + 4 + 16 * clear, 1)


async def fetch_session_weather(lat: float, lon: float,
                                date_iso: str) -> dict:
    """date_iso: 'YYYY-MM-DD' of the session (local circuit date)."""
    params = {
        "latitude": lat, "longitude": lon,
        "start_date": date_iso, "end_date": date_iso,
        "hourly": ",".join([
            "temperature_2m", "relative_humidity_2m", "precipitation",
            "cloud_cover", "wind_speed_10m", "wind_direction_10m",
            "weather_code",
        ]),
        "timezone": "auto",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(ARCHIVE_URL, params=params)
        r.raise_for_status()
        data = r.json()

    h = data.get("hourly", {})
    times = h.get("time", [])
    out = []
    for i, t in enumerate(times):
        air = _get(h, "temperature_2m", i)
        cloud = _get(h, "cloud_cover", i)
        out.append({
            "time": t,
            "air_temp": air,
            "track_temp": _estimate_track_temp(air, cloud),
            "humidity": _get(h, "relative_humidity_2m", i),
            "precipitation": _get(h, "precipitation", i),
            "cloud_cover": cloud,
            "wind_speed": _get(h, "wind_speed_10m", i),
            "wind_direction": _get(h, "wind_direction_10m", i),
            "weather": _wmo(_get(h, "weather_code", i)),
        })
    return {
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude"),
        "timezone": data.get("timezone"),
        "date": date_iso,
        "hourly": out,
    }


def _get(h, key, i):
    arr = h.get(key)
    if not arr or i >= len(arr):
        return None
    return arr[i]
