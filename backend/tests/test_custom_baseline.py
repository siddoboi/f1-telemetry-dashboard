"""Phase 7: custom baseline override routing in build_comparison.

Network-free: we monkeypatch load_session / lap_to_distance_grid / _pick_lap
so the test verifies the *control flow* (that a custom override loads its own
session and becomes the shared baseline) without downloading anything.
"""
import pandas as pd
import pytest

fastf1 = pytest.importorskip("fastf1")  # skip whole module if FastF1 absent

from app.data import fastf1_loader as f1


def _grid(distance_max=1000, step=5, t_scale=1.0):
    import numpy as np
    dist = np.arange(0, distance_max, step, dtype=float)
    return pd.DataFrame({
        "distance": dist, "speed": 200 + 0 * dist, "rpm": 11000 + 0 * dist,
        "gear": 7, "throttle": 80.0, "brake": 0.0, "drs": 0,
        "time_s": dist / 60 * t_scale, "x": dist, "y": dist * 0,
    })


@pytest.fixture
def patched(monkeypatch):
    calls = {"sessions": []}

    class FakeLap(dict):
        def __getitem__(self, k):
            return {"LapTime": pd.Timedelta(seconds=90),
                    "LapNumber": 12, "Driver": "XXX"}.get(k, super().__getitem__(k))

    def fake_load_session(year, rnd, session):
        calls["sessions"].append((year, rnd, session))
        return f"SES-{year}-{rnd}-{session}"

    def fake_pick_lap(ses, driver, lap_number=None):
        return FakeLap()

    def fake_grid(lap):
        return _grid()

    def fake_optimal(ses):
        return FakeLap()

    def fake_drivers(year, rnd, session):
        return [{"code": "VER", "color": "#1e5bc6", "name": "Max",
                 "team": "RB"}]

    monkeypatch.setattr(f1, "load_session", fake_load_session)
    monkeypatch.setattr(f1, "_pick_lap", fake_pick_lap)
    monkeypatch.setattr(f1, "lap_to_distance_grid", fake_grid)
    monkeypatch.setattr(f1, "session_optimal_lap", fake_optimal)
    monkeypatch.setattr(f1, "get_drivers", fake_drivers)
    monkeypatch.setattr(f1, "_fmt_laptime", lambda t: "1:30.000")
    return calls


def test_custom_baseline_loads_separate_session(patched):
    override = {"year": 2023, "round": 9, "session": "Q",
                "driver": "HAM", "lap": 14}
    result = f1.build_comparison(
        2024, 1, "Q", ["VER"], None, "custom", override)

    # both the comparison session AND the baseline session were loaded
    assert (2024, 1, "Q") in patched["sessions"]
    assert (2023, 9, "Q") in patched["sessions"]
    # the baseline owner label reflects the override
    assert "HAM" in result["baseline_owner"]
    assert "2023" in result["baseline_owner"]
    # every driver shares the custom baseline
    assert result["drivers"]["VER"]["baseline"]["driver"] == result["baseline_owner"]


def test_custom_without_override_falls_through(patched):
    # custom mode but no override dict -> no baseline session loaded,
    # shared_baseline stays None (driver baseline is None)
    result = f1.build_comparison(
        2024, 1, "Q", ["VER"], None, "custom", None)
    assert patched["sessions"].count((2024, 1, "Q")) == 1
    assert result["drivers"]["VER"]["baseline"] is None
