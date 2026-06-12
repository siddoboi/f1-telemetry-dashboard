"""History re-serve (Phase 3): pure logic tests against fake Mongo docs."""
import pytest

from app.replay.history_serve import build_history_comparison
from tests.conftest import make_mongo_lap

REQ = {"year": 2024, "round": 21, "session": "R", "driver": "VER", "lap": 67}


def test_fastest_lap_becomes_baseline():
    reqs = [dict(REQ), {**REQ, "driver": "PER", "lap": 69}]
    out = build_history_comparison(
        reqs, [make_mongo_lap(), make_mongo_lap(slow=3.0)])
    assert out["meta"]["baseline_owner"] == "VER"


def test_stored_scores_become_events():
    out = build_history_comparison(
        [dict(REQ)], [make_mongo_lap(spike_at=900)])
    assert any(850 <= e["start_distance"] <= 950
               for e in out["meta"]["events"])


def test_duplicate_driver_gets_unique_keys():
    reqs = [dict(REQ), {**REQ, "lap": 69}]
    out = build_history_comparison(
        reqs, [make_mongo_lap(), make_mongo_lap(slow=2.0)])
    assert set(out["meta"]["drivers"]) == {"VER·L67", "VER·L69"}


def test_cross_circuit_selection_rejected():
    reqs = [dict(REQ), {**REQ, "driver": "PER", "round": 1}]
    with pytest.raises(ValueError, match="same Grand Prix"):
        build_history_comparison(reqs, [make_mongo_lap(), make_mongo_lap()])


def test_missing_lap_rejected_with_clear_message():
    with pytest.raises(ValueError, match="not in the database"):
        build_history_comparison([dict(REQ)], [[]])


def test_delta_sign_convention():
    reqs = [dict(REQ), {**REQ, "driver": "PER", "lap": 69}]
    out = build_history_comparison(
        reqs, [make_mongo_lap(), make_mongo_lap(slow=3.0)])
    assert abs(out["scored_laps"]["VER"]["delta"].iloc[-1]) < 1e-6
    assert out["scored_laps"]["PER"]["delta"].iloc[-1] > 0


def test_track_is_none_and_mode_history():
    out = build_history_comparison([dict(REQ)], [make_mongo_lap()])
    assert out["meta"]["track"] is None
    assert out["meta"]["mode"] == "history"
