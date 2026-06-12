"""Real-data validation against 2024 Bahrain GP Qualifying (VER vs LEC).
Downloads ~200 MB on first run - explicitly opt-in:  pytest -m slow"""
import pytest

fastf1 = pytest.importorskip("fastf1")

pytestmark = pytest.mark.slow


def test_bahrain_ver_vs_lec_detection():
    from app.data.fastf1_loader import (load_session, lap_to_distance_grid,
                                        session_optimal_lap)
    from app.ml.anomaly_detector import AnomalyDetector, extract_events

    ses = load_session(2024, 1, "Q")
    drv = ses.laps.pick_drivers("VER").pick_fastest()
    base = session_optimal_lap(ses)
    base_df = lap_to_distance_grid(base)
    comp_df = lap_to_distance_grid(drv)

    assert base_df["brake"].max() > 1.0, "brake not normalized to 0-100"
    assert 300 < comp_df["speed"].max() < 360

    scored = AnomalyDetector().fit(base_df).score(comp_df, base_df)
    events = extract_events(scored, "VER")

    assert 10 <= len(events) <= 22, f"event count drifted: {len(events)}"
    assert scored["anomaly"].mean() < 0.12
    assert any(600 <= e["start_distance"] <= 850
               and "lock" in e["label"].lower() for e in events), \
        "the known T4 lock-up signature disappeared"
