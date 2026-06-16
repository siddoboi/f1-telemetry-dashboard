"""Shared fixtures: synthetic laps with known injected faults, and fake
MongoDB documents. Everything here runs offline - no FastF1, no network."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

N_STEPS = 1000          # 5000 m lap at 5 m grid
STEP = 5.0


def _lap(rng, noise=0.5):
    dist = np.arange(N_STEPS) * STEP
    speed = 200 + 80 * np.sin(dist / 400) + rng.normal(0, noise, N_STEPS)
    throttle = np.clip(60 + 40 * np.sin(dist / 400)
                       + rng.normal(0, 2, N_STEPS), 0, 100)
    brake = (np.sin(dist / 400) < -0.6).astype(float) * 100
    rpm = speed * 55 + rng.normal(0, 60, N_STEPS)
    gear = np.clip((speed // 40).astype(int), 1, 8)
    return pd.DataFrame({"distance": dist, "speed": speed, "rpm": rpm,
                         "gear": gear, "throttle": throttle, "brake": brake,
                         "drs": 0, "time_s": dist / 60})


@pytest.fixture
def rng():
    return np.random.default_rng(0)


@pytest.fixture
def baseline_lap(rng):
    return _lap(rng)


@pytest.fixture
def comparison_lap(rng):
    """Same generator stream as baseline (rng is shared), with a lock-up
    injected at ~2000 m and wheelspin at ~3500 m."""
    df = _lap(rng)
    i = 400                                   # lock-up at 2000 m
    df.loc[i:i + 6, "brake"] = 100
    df.loc[i:i + 6, "speed"] -= np.linspace(0, 60, 7)
    j = 700                                   # wheelspin at 3500 m
    df.loc[j:j + 5, "rpm"] += np.linspace(0, 2500, 6)
    df.loc[j:j + 5, "throttle"] = 95
    return df


def make_mongo_lap(n=300, slow=0.0, spike_at=None, gps=False):
    """Fake saved-lap documents shaped exactly like database.save_lap_frames
    writes them (minus ts/meta, which load_lap_frames projects away).
    When gps=True, includes x/y like a v2 lap so the track map can render."""
    docs = []
    for i in range(n):
        d = i * STEP
        speed = 210 + 70 * np.sin(d / 350) - slow
        score = 0.85 if (spike_at and abs(d - spike_at) <= 20) else 0.0
        doc = {"distance": d, "speed": float(speed),
               "rpm": float(speed * 55),
               "gear": int(max(1, min(8, speed // 40))),
               "throttle": 70.0,
               "brake": 100.0 if np.sin(d / 350) < -0.6 else 0.0,
               "drs": 0, "time_s": d / (58.0 - slow),
               "anomaly_score": score}
        if gps:
            doc["x"] = float(np.cos(d / 800) * 500)
            doc["y"] = float(np.sin(d / 800) * 500)
        docs.append(doc)
    return docs
