"""
FastF1 data access layer.

Everything downstream (ML, replay, charts) works on telemetry that has been
resampled onto a uniform DISTANCE grid (one row every DISTANCE_STEP_M metres).
That is the core architectural decision of this project: laps are compared by
*where on track* the car is, never by elapsed time.
"""
import logging
from functools import lru_cache

import fastf1
import numpy as np
import pandas as pd

from app import config

log = logging.getLogger(__name__)

config.FASTF1_CACHE_DIR.mkdir(parents=True, exist_ok=True)
fastf1.Cache.enable_cache(str(config.FASTF1_CACHE_DIR))

CHANNELS = ["Speed", "RPM", "nGear", "Throttle", "Brake", "DRS"]


# --------------------------------------------------------------------------
# Schedule / session discovery
# --------------------------------------------------------------------------
def get_schedule(year: int) -> list[dict]:
    """Return the event list for a season (for the Year -> Event dropdown)."""
    sched = fastf1.get_event_schedule(year, include_testing=False)
    out = []
    for _, ev in sched.iterrows():
        out.append({
            "round": int(ev["RoundNumber"]),
            "name": str(ev["EventName"]),
            "country": str(ev["Country"]),
            "date": str(ev["EventDate"].date()) if pd.notna(ev["EventDate"]) else None,
            "format": str(ev["EventFormat"]),
        })
    return out


def get_session_types(year: int, rnd: int) -> list[str]:
    """Which session identifiers exist for this event (sprint weekends differ)."""
    ev = fastf1.get_event(year, rnd)
    if "sprint" in str(ev["EventFormat"]).lower():
        return ["FP1", "SQ", "S", "Q", "R"]
    return ["FP1", "FP2", "FP3", "Q", "R"]


# --------------------------------------------------------------------------
# Session loading (cached in-process; FastF1 also caches on disk)
# --------------------------------------------------------------------------
@lru_cache(maxsize=4)
def load_session(year: int, rnd: int, session: str):
    """Load and return a fastf1 Session with laps + telemetry."""
    log.info("Loading session %s %s %s (first time may take minutes)...",
             year, rnd, session)
    ses = fastf1.get_session(year, rnd, session)
    ses.load(telemetry=True, weather=False, messages=False)
    return ses


def get_drivers(year: int, rnd: int, session: str) -> list[dict]:
    ses = load_session(year, rnd, session)
    out = []
    for drv_num in ses.drivers:
        info = ses.get_driver(drv_num)
        out.append({
            "code": str(info["Abbreviation"]),
            "name": f'{info["FirstName"]} {info["LastName"]}',
            "team": str(info["TeamName"]),
            "color": f'#{info["TeamColor"]}' if info["TeamColor"] else "#888888",
        })
    return out


def get_driver_laps(year: int, rnd: int, session: str, driver: str) -> list[dict]:
    """Lap list for the lap-picker dropdown. Marks each driver's personal best."""
    ses = load_session(year, rnd, session)
    laps = ses.laps.pick_drivers(driver)
    valid = laps[laps["LapTime"].notna()]
    pb_lap = None
    if len(valid):
        pb_lap = int(valid.loc[valid["LapTime"].idxmin()]["LapNumber"])
    out = []
    for _, lap in laps.iterrows():
        if pd.isna(lap["LapTime"]):
            continue
        out.append({
            "lap_number": int(lap["LapNumber"]),
            "lap_time": _fmt_laptime(lap["LapTime"]),
            "lap_time_s": float(lap["LapTime"].total_seconds()),
            "compound": str(lap["Compound"]) if pd.notna(lap["Compound"]) else "?",
            "is_personal_best": int(lap["LapNumber"]) == pb_lap,
        })
    return out


# --------------------------------------------------------------------------
# Lap selection + distance alignment
# --------------------------------------------------------------------------
def _fmt_laptime(td) -> str:
    total = td.total_seconds()
    return f"{int(total // 60)}:{total % 60:06.3f}"


def _sector_times(lap) -> dict:
    """S1/S2/S3 times for a lap as both seconds and formatted strings."""
    out = {}
    for i, col in enumerate(
            ("Sector1Time", "Sector2Time", "Sector3Time"), start=1):
        val = lap.get(col)
        if val is not None and not pd.isna(val):
            s = float(val.total_seconds())
            out[f"s{i}"] = round(s, 3)
            out[f"s{i}_fmt"] = f"{s:06.3f}"
        else:
            out[f"s{i}"] = None
            out[f"s{i}_fmt"] = None
    return out


def _pick_lap(ses, driver: str, lap_number: int | None):
    laps = ses.laps.pick_drivers(driver)
    if lap_number is not None:
        lap = laps[laps["LapNumber"] == lap_number]
        if len(lap) == 0:
            raise ValueError(f"Driver {driver} has no lap {lap_number}")
        return lap.iloc[0]
    return laps.pick_fastest()


def session_optimal_lap(ses):
    """Fastest lap of the whole session, any driver: the shared baseline."""
    return ses.laps.pick_fastest()


def lap_to_distance_grid(lap) -> pd.DataFrame:
    """
    Convert one lap's raw (time-indexed, irregular) telemetry into a uniform
    distance-indexed DataFrame. np.interp does the resampling per channel.
    """
    tel = lap.get_telemetry()                      # adds Distance column
    tel = tel.dropna(subset=["Distance"])
    dist = tel["Distance"].to_numpy(dtype=float)

    # Guard against non-monotonic distance (GPS jitter at low speed)
    keep = np.concatenate(([True], np.diff(dist) > 0))
    tel, dist = tel[keep], dist[keep]

    grid = np.arange(0, float(dist.max()), config.DISTANCE_STEP_M)
    out = {"distance": grid}
    for ch in CHANNELS:
        raw = tel[ch].to_numpy(dtype=float)
        out[ch.lower()] = np.interp(grid, dist, raw)

    # GPS path for the track-map view (FastF1 merges pos_data into telemetry)
    for ch in ("X", "Y"):
        if ch in tel.columns:
            out[ch.lower()] = np.interp(
                grid, dist, tel[ch].to_numpy(dtype=float))

    t = tel["Time"].dt.total_seconds().to_numpy(dtype=float)
    out["time_s"] = np.interp(grid, dist, t - t[0])

    df = pd.DataFrame(out)
    df["ngear"] = df["ngear"].round().astype(int)
    # Normalize brake: FastF1 returns 0/1 boolean in some sessions
    if df["brake"].max() <= 1.0:
        df["brake"] = df["brake"] * 100
    df["drs"] = df["drs"].round().astype(int)
    df.rename(columns={"ngear": "gear"}, inplace=True)
    return df


def get_circuit_info(year: int, rnd: int, session: str,
                     reference_lap=None) -> dict:
    """
    Corner positions, sector boundary distances and DRS zones for a circuit.

    Corners and DRS come from FastF1's get_circuit_info() (official circuit
    geometry). Sector boundaries are derived from the reference (fastest) lap's
    Sector1/2 session times mapped onto the distance grid, since circuit_info
    itself doesn't carry sector splits.

    Returns:
      corners:        [{number, letter, distance, x, y}]
      sector_distances: {s1_end, s2_end, total}   (metres along the lap)
      drs_zones:      [{start, end}]  (metres; end is the detection/zone end)
    """
    ses = load_session(year, rnd, session)
    out = {"corners": [], "sector_distances": None, "drs_zones": []}

    try:
        ci = ses.get_circuit_info()
    except Exception as exc:                            # noqa: BLE001
        log.warning("circuit_info unavailable for %s %s %s: %s",
                    year, rnd, session, exc)
        ci = None

    if ci is not None:
        corners = ci.corners
        for _, c in corners.iterrows():
            out["corners"].append({
                "number": int(c["Number"]),
                "letter": str(c.get("Letter", "") or ""),
                "distance": round(float(c["Distance"]), 1),
                "x": float(c["X"]), "y": float(c["Y"]),
            })
        # DRS zones: marshal_lights mark detection points; FastF1 exposes
        # rotation + corners but not explicit DRS spans, so we approximate a
        # zone as the span between consecutive long straights is out of scope.
        # Where available, FastF1 >=3.x exposes circuit_info with no DRS; we
        # leave drs_zones empty rather than guess wrongly.

    # sector boundaries from the reference lap
    lap = reference_lap if reference_lap is not None else \
        ses.laps.pick_fastest()
    try:
        tel = lap.get_telemetry().dropna(subset=["Distance"])
        dist = tel["Distance"].to_numpy(dtype=float)
        tsec = tel["Time"].dt.total_seconds().to_numpy(dtype=float)
        tsec = tsec - tsec[0]
        total = float(dist.max())

        # FastF1 gives Sector1Time / Sector2Time as durations. The S1/S2
        # boundary is at elapsed time = Sector1Time; the S2/S3 boundary at
        # Sector1Time + Sector2Time. Map those elapsed times to distance.
        s1 = lap.get("Sector1Time")
        s2 = lap.get("Sector2Time")
        s1_s = s1.total_seconds() if s1 is not None and not pd.isna(s1) else None
        s2_s = s2.total_seconds() if s2 is not None and not pd.isna(s2) else None
        s1_end = float(np.interp(s1_s, tsec, dist)) if s1_s else None
        s2_end = (float(np.interp(s1_s + s2_s, tsec, dist))
                  if s1_s and s2_s else None)
        out["sector_distances"] = {
            "s1_end": round(s1_end, 1) if s1_end else None,
            "s2_end": round(s2_end, 1) if s2_end else None,
            "total": round(total, 1),
        }
    except Exception as exc:                            # noqa: BLE001
        log.warning("sector boundary derivation failed: %s", exc)

    return out


def driver_session_stats(year: int, rnd: int, session: str,
                         driver: str) -> dict:
    """Performance summary for the slide-in driver profile card."""
    ses = load_session(year, rnd, session)
    laps = ses.laps.pick_drivers(driver)
    valid = laps[laps["LapTime"].notna()]

    stats = {"driver": driver, "session": session}
    res = ses.results
    row = res[res["Abbreviation"] == driver]
    if len(row):
        r = row.iloc[0]
        stats.update({
            "full_name": str(r.get("FullName", "")),
            "team": str(r.get("TeamName", "")),
            "color": f'#{r.get("TeamColor")}' if r.get("TeamColor") else "#888",
            "grid_position": _int_or_none(r.get("GridPosition")),
            "finish_position": _int_or_none(r.get("Position")),
            "classified_status": str(r.get("Status", "")) or None,
            "points": float(r.get("Points")) if pd.notna(r.get("Points")) else None,
        })

    if len(valid):
        best = valid.loc[valid["LapTime"].idxmin()]
        stats["fastest_lap"] = _fmt_laptime(best["LapTime"])
        stats["fastest_lap_number"] = int(best["LapNumber"])
        try:
            tel = best.get_telemetry()
            stats["top_speed_kmh"] = float(tel["Speed"].max())
        except Exception:                                    # noqa: BLE001
            stats["top_speed_kmh"] = None
        stats["laps_completed"] = int(len(valid))
        stats["pit_stops"] = int(laps["PitInTime"].notna().sum())
    return stats


def _int_or_none(v):
    try:
        return int(v) if pd.notna(v) else None
    except (TypeError, ValueError):
        return None


def build_comparison(year: int, rnd: int, session: str, drivers: list[str],
                     lap_numbers: dict[str, int] | None,
                     baseline_mode: str,
                     baseline_override: dict | None = None) -> dict:
    """
    The main data-prep entry point. Returns, for every requested driver:
      - the aligned comparison lap
      - the aligned baseline lap (session-optimal, personal-best, OFF, or a
        custom lap that may come from a completely different session)
    plus metadata the frontend needs (lap times, baseline owner, colors).
    """
    ses = load_session(year, rnd, session)
    lap_numbers = lap_numbers or {}
    result = {"drivers": {}, "baseline_mode": baseline_mode}

    shared_baseline = None
    if baseline_mode == "session_optimal":
        opt = session_optimal_lap(ses)
        shared_baseline = {
            "driver": str(opt["Driver"]),
            "lap_time": _fmt_laptime(opt["LapTime"]),
            "df": lap_to_distance_grid(opt),
        }
        result["baseline_owner"] = shared_baseline["driver"]
        result["baseline_lap_time"] = shared_baseline["lap_time"]
    elif baseline_mode == "custom" and baseline_override:
        # Load the baseline lap from its own session (may differ from the
        # comparison session entirely - different driver, event, even year).
        ov = baseline_override
        b_ses = load_session(ov["year"], ov["round"], ov["session"])
        b_lap = _pick_lap(b_ses, ov["driver"], ov.get("lap"))
        label = (f'{ov["driver"]} · {ov["year"]} R{ov["round"]} '
                 f'{ov["session"]}')
        shared_baseline = {
            "driver": label,
            "lap_time": _fmt_laptime(b_lap["LapTime"]),
            "df": lap_to_distance_grid(b_lap),
        }
        result["baseline_owner"] = label
        result["baseline_lap_time"] = shared_baseline["lap_time"]

    driver_meta = {d["code"]: d for d in get_drivers(year, rnd, session)}

    for drv in drivers:
        lap = _pick_lap(ses, drv, lap_numbers.get(drv))
        comp_df = lap_to_distance_grid(lap)

        if baseline_mode == "personal_best":
            pb = ses.laps.pick_drivers(drv).pick_fastest()
            base = {"driver": drv,
                    "lap_time": _fmt_laptime(pb["LapTime"]),
                    "df": lap_to_distance_grid(pb)}
        elif baseline_mode == "off":
            base = None          # no baseline traces, rules-only anomalies
        else:
            base = shared_baseline   # session_optimal OR custom

        result["drivers"][drv] = {
            "meta": driver_meta.get(drv, {"code": drv, "color": "#888888"}),
            "lap_number": int(lap["LapNumber"]),
            "lap_time": _fmt_laptime(lap["LapTime"]),
            "sector_times": _sector_times(lap),
            "comparison": comp_df,
            "baseline": base,
        }

    # GPS track path (for the Track Map view): take it from the shared
    # baseline if available, else from the first comparison lap
    path_df = (shared_baseline["df"] if shared_baseline is not None
               else next(iter(result["drivers"].values()))["comparison"])
    if "x" in path_df.columns and "y" in path_df.columns:
        result["track"] = {
            "distance": path_df["distance"].round(1).tolist(),
            "x": path_df["x"].round(1).tolist(),
            "y": path_df["y"].round(1).tolist(),
        }
    return result
