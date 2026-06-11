"""
Isolation Forest anomaly engine.

Training strategy
-----------------
The baseline lap is assumed to be (mostly) nominal driving. We fit the forest
on baseline-lap feature vectors, then score the comparison lap. Points that
look unlike anything in the clean lap receive low decision scores, which we
convert to a 0..1 "anomaly probability score".

Feature vector per distance step
--------------------------------
speed_delta        comparison speed minus baseline speed at same distance
throttle, brake    raw pedal state
d_speed, d_rpm,
d_throttle         first derivatives along distance (how violently things change)
gear_delta         gear difference vs baseline at same distance
"""
import logging

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from app import config
from app.ml import physics_rules

log = logging.getLogger(__name__)

FEATURES = ["speed_delta", "throttle", "brake",
            "d_speed", "d_rpm", "d_throttle", "gear_delta"]


def _features(df: pd.DataFrame, base: pd.DataFrame) -> pd.DataFrame:
    """Build the feature matrix. Both frames share the same distance grid,
    but may differ in length (different lap lengths) - clip to overlap."""
    n = min(len(df), len(base))
    df, base = df.iloc[:n].copy(), base.iloc[:n]
    df["speed_delta"] = df["speed"].to_numpy() - base["speed"].to_numpy()
    df["gear_delta"] = df["gear"].to_numpy() - base["gear"].to_numpy()
    df["d_speed"] = np.gradient(df["speed"].to_numpy())
    df["d_rpm"] = np.gradient(df["rpm"].to_numpy())
    df["d_throttle"] = np.gradient(df["throttle"].to_numpy())
    return df


class AnomalyDetector:
    """One detector per (driver, baseline) pair."""

    def __init__(self):
        self.scaler = StandardScaler()
        self.model = IsolationForest(
            n_estimators=config.IF_N_ESTIMATORS,
            contamination=config.IF_CONTAMINATION,
            random_state=42,
        )
        self._score_min = None
        self._score_max = None

    def fit(self, baseline_df: pd.DataFrame) -> "AnomalyDetector":
        feats = _features(baseline_df, baseline_df)   # delta vs itself = 0
        X = self.scaler.fit_transform(feats[FEATURES])
        self.model.fit(X)
        s = self.model.decision_function(X)
        # calibration range so comparison-lap scores map sensibly to 0..1
        self._score_min, self._score_max = float(s.min()), float(s.max())
        # flag threshold: "more anomalous than 99% of baseline driving"
        self._flag_raw = float(np.quantile(s, 0.01))
        return self

    def score(self, comparison_df: pd.DataFrame,
              baseline_df: pd.DataFrame) -> pd.DataFrame:
        feats = _features(comparison_df, baseline_df)
        X = self.scaler.transform(feats[FEATURES])
        raw = self.model.decision_function(X)         # higher = more normal
        lo, hi = self._score_min, self._score_max
        span = (hi - lo) or 1.0
        prob = np.clip((hi - raw) / span, 0.0, 1.0)   # 0..1, higher = worse
        feats["anomaly_score"] = prob
        # flag if rarer than 99% of baseline OR above the probability cutoff
        feats["anomaly"] = ((raw < self._flag_raw)
                            | (prob >= config.ANOMALY_THRESHOLD))
        feats = physics_rules.apply_rules(feats)
        # dilate rule labels by 3 steps (15 m) so labels survive the slight
        # positional offset that distance-gradients introduce
        dilated = (feats["rule_label"].ffill(limit=3).bfill(limit=3))
        feats["anomaly_label"] = np.where(
            feats["anomaly"],
            dilated.fillna("Atypical telemetry pattern"),
            None,
        )
        return feats


def extract_events(scored: pd.DataFrame, driver: str) -> list[dict]:
    """Merge consecutive anomalous steps into events for the sidebar log."""
    events, in_evt = [], False
    start = peak = 0.0
    labels: list[str] = []
    for _, row in scored.iterrows():
        if row["anomaly"] and not in_evt:
            in_evt, start, peak, labels = True, row["distance"], 0.0, []
        if in_evt:
            peak = max(peak, float(row["anomaly_score"]))
            if row["anomaly_label"]:
                labels.append(row["anomaly_label"])
            if not row["anomaly"]:
                events.append(_event(driver, start, row["distance"],
                                     peak, labels))
                in_evt = False
    if in_evt:
        events.append(_event(driver, start,
                             float(scored.iloc[-1]["distance"]), peak, labels))
    # discard one-step blips (a single 5 m flag is usually noise)
    return [e for e in events if e["end_distance"] - e["start_distance"]
            >= 2 * config.DISTANCE_STEP_M]


def _event(driver, start, end, peak, labels) -> dict:
    label = max(set(labels), key=labels.count) if labels \
        else "Atypical telemetry pattern"
    return {
        "driver": driver,
        "start_distance": float(start),
        "end_distance": float(end),
        "peak_score": round(float(peak), 3),
        "label": label,
        "diagnosis": _diagnose(label, start, end, peak),
    }


def _diagnose(label: str, start: float, end: float, peak: float) -> str:
    where = f"between {start:.0f} m and {end:.0f} m"
    texts = {
        "Possible lock-up":
            f"Heavy braking with an abnormal speed drop {where}. "
            f"Pattern consistent with a tyre lock-up (peak score {peak:.2f}).",
        "Traction loss / wheelspin":
            f"Engine revs spiked without matching acceleration {where}. "
            f"Pattern consistent with wheelspin on corner exit "
            f"(peak score {peak:.2f}).",
        "Throttle instability":
            f"Oscillating throttle application {where}, suggesting a "
            f"confidence or balance issue (peak score {peak:.2f}).",
        "Mid-corner stability loss":
            f"Sudden throttle lift at partial throttle {where}, consistent "
            f"with a mid-corner snap or correction (peak score {peak:.2f}).",
    }
    return texts.get(label,
                     f"Telemetry deviates strongly from the baseline {where} "
                     f"(peak score {peak:.2f}).")
