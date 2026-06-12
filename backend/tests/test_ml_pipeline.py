"""End-to-end Isolation Forest pipeline on synthetic laps with known faults.
The acceptance bar: both injected faults detected, correctly labeled, and
clean stretches mostly unflagged."""
from app import config
from app.ml.anomaly_detector import (AnomalyDetector, extract_events,
                                     score_rules_only)


def test_injected_faults_detected_and_labeled(baseline_lap, comparison_lap):
    det = AnomalyDetector().fit(baseline_lap)
    scored = det.score(comparison_lap, baseline_lap)
    events = extract_events(scored, "TST")

    assert any(1950 <= e["start_distance"] <= 2100
               and "lock" in e["label"].lower() for e in events), \
        f"lock-up missed: {events}"
    assert any(3400 <= e["start_distance"] <= 3600
               and ("traction" in e["label"].lower()
                    or "wheelspin" in e["label"].lower()) for e in events), \
        f"wheelspin missed: {events}"


def test_false_positive_rate_bounded(baseline_lap, comparison_lap):
    det = AnomalyDetector().fit(baseline_lap)
    scored = det.score(comparison_lap, baseline_lap)
    clean = scored.iloc[:390]                 # before the first injection
    assert clean["anomaly"].mean() < 0.06, \
        f"too many false flags on clean data: {clean['anomaly'].mean():.1%}"


def test_scores_bounded_zero_one(baseline_lap, comparison_lap):
    det = AnomalyDetector().fit(baseline_lap)
    scored = det.score(comparison_lap, baseline_lap)
    assert scored["anomaly_score"].between(0, 1).all()


def test_events_merge_within_gap(baseline_lap, comparison_lap):
    det = AnomalyDetector().fit(baseline_lap)
    scored = det.score(comparison_lap, baseline_lap)
    events = sorted(extract_events(scored, "TST"),
                    key=lambda e: e["start_distance"])
    for a, b in zip(events, events[1:]):
        assert b["start_distance"] - a["end_distance"] > 30.0, \
            "two events closer than the 30 m merge gap survived"


def test_event_minimum_length(baseline_lap, comparison_lap):
    det = AnomalyDetector().fit(baseline_lap)
    scored = det.score(comparison_lap, baseline_lap)
    for e in extract_events(scored, "TST"):
        assert (e["end_distance"] - e["start_distance"]
                >= 2 * config.DISTANCE_STEP_M)


def test_rules_only_mode_needs_no_baseline(comparison_lap):
    scored = score_rules_only(comparison_lap)
    events = extract_events(scored, "TST")
    assert any("lock" in e["label"].lower() for e in events)
    assert "anomaly_score" in scored.columns
