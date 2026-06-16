"""
Phase 3 - history re-serve.

Takes lap frames already loaded from MongoDB and rebuilds everything the
dashboard needs - baseline selection, anomaly events, chart traces - with
ZERO FastF1 involvement.

Design decisions (documented, deliberate):
* All selected laps must come from the same (year, round): mixing circuits
  would make distance-aligned comparison meaningless.
* The fastest selected lap becomes the on-the-fly baseline. The original
  session-optimal lap isn't stored, so it can't be the baseline here.
* Stored anomaly_score values are reused as-is (they were produced against
  the original baseline); events are re-extracted from them, and physics
  rules are re-applied to recover labels - rules only need the stored
  channels, no baseline required.
* Saved laps carry no GPS, so meta["track"] is None and the Track Map view
  shows its empty state.
"""
import numpy as np
import pandas as pd

from app import config
from app.data.team_colors import color_for
from app.ml import physics_rules
from app.ml.anomaly_detector import extract_events


def _fmt(seconds: float) -> str:
    m = int(seconds // 60)
    return f"{m}:{seconds % 60:06.3f}"


def build_history_comparison(lap_requests: list[dict],
                             frames_by_lap: list[list[dict]]) -> dict:
    """
    lap_requests: [{year, round, session, driver, lap}, ...] (validated)
    frames_by_lap: matching list of Mongo frame docs per request.
    Returns {"meta": <ws meta message>, "scored_laps": {key: DataFrame}}.
    """
    circuits = {(r["year"], r["round"]) for r in lap_requests}
    if len(circuits) > 1:
        raise ValueError("Selected laps span different events - pick laps "
                         "from the same Grand Prix for a valid comparison.")

    # unique chart key per lap: driver code, or VER·L67 when one driver
    # appears more than once in the selection
    counts: dict[str, int] = {}
    for r in lap_requests:
        counts[r["driver"]] = counts.get(r["driver"], 0) + 1

    laps: dict[str, dict] = {}
    for req, frames in zip(lap_requests, frames_by_lap):
        if not frames:
            raise ValueError(
                f"{req['driver']} lap {req['lap']} of {req['year']} "
                f"R{req['round']} {req['session']} is not in the database.")
        drv = req["driver"]
        key = drv if counts[drv] == 1 else \
            f"{drv}·L{req['lap'] if req['lap'] != -1 else 'fast'}"
        df = pd.DataFrame(frames).sort_values("distance")
        df = df.reset_index(drop=True)
        laps[key] = {"req": req, "df": df,
                     "lap_time_s": float(df["time_s"].iloc[-1])}

    baseline_key = min(laps, key=lambda k: laps[k]["lap_time_s"])
    base_df = laps[baseline_key]["df"]

    meta = {"type": "meta", "mode": "history",
            "baseline_mode": "fastest_selected",
            "baseline_owner": baseline_key,
            "baseline_lap_time": _fmt(laps[baseline_key]["lap_time_s"]),
            "track": None, "drivers": {}, "events": [], "validation": {}}
    scored_laps: dict[str, pd.DataFrame] = {}

    for key, info in laps.items():
        df = info["df"].copy()
        # recover flags from stored scores
        df["anomaly"] = df["anomaly_score"] >= config.ANOMALY_THRESHOLD
        # v2 laps already carry anomaly_label; only re-derive it for v1 laps
        # (or rows where it is missing/blank) via the physics rules
        needs_labels = ("anomaly_label" not in df.columns
                        or df["anomaly_label"].isna().all())
        if needs_labels:
            df = physics_rules.apply_rules(df)
            dilated = df["rule_label"].ffill(limit=3).bfill(limit=3)
            df["anomaly_label"] = np.where(
                df["anomaly"], dilated.fillna("Atypical telemetry pattern"),
                None)
        # delta-time vs the fastest selected lap
        base_t = base_df["time_s"].to_numpy()
        n = min(len(df), len(base_t))
        df = df.iloc[:n].copy()
        df["delta"] = (df["time_s"].to_numpy()[:n] - base_t[:n]).round(3)
        scored_laps[key] = df
        meta["events"].extend(extract_events(df, key))

        req = info["req"]
        meta["drivers"][key] = {
            "meta": {"code": key, "color": color_for(req["driver"]),
                     "name": req["driver"],
                     "team": f'{req["year"]} R{req["round"]} '
                             f'{req["session"]}'},
            "lap_number": req["lap"],
            "lap_time": _fmt(info["lap_time_s"]),
            "baseline_driver": baseline_key,
            "baseline_lap_time": meta["baseline_lap_time"],
            "baseline": {},
        }

    meta["events"].sort(key=lambda e: e["start_distance"])

    # v2: if the baseline lap carries stored GPS, the Track Map can render in
    # history mode. v1 laps have no x/y, so track stays None (empty state).
    if {"x", "y"}.issubset(base_df.columns) and base_df["x"].notna().any():
        meta["track"] = {
            "distance": base_df["distance"].round(1).tolist(),
            "x": base_df["x"].round(1).tolist(),
            "y": base_df["y"].round(1).tolist(),
        }

    return {"meta": meta, "scored_laps": scored_laps}
