"""Export: CSV zip structure and PDF generation from a real scored lap."""
import io
import zipfile

from app.export.report import build_csv_zip, build_pdf, event_channel_stats
from app.ml.anomaly_detector import AnomalyDetector, extract_events


def _prepared(baseline_lap, comparison_lap):
    det = AnomalyDetector().fit(baseline_lap)
    scored = det.score(comparison_lap, baseline_lap)
    scored["delta"] = (scored["time_s"].to_numpy()
                       - baseline_lap["time_s"].to_numpy()[:len(scored)])
    events = extract_events(scored, "TST")
    meta = {"mode": "replay", "baseline_mode": "session_optimal",
            "baseline_owner": "TST", "baseline_lap_time": "1:23.456",
            "drivers": {"TST": {"lap_number": 1, "lap_time": "1:23.500",
                                "baseline_driver": "TST",
                                "baseline_lap_time": "1:23.456"}},
            "events": events,
            "validation": {"TST": {"ml_flagged": 10, "rules_flagged": 8,
                                   "agreement": 6,
                                   "precision_vs_rules": 0.6,
                                   "recall_vs_rules": 0.75}}}
    return meta, {"TST": scored}


def test_event_channel_stats_capture_lockup(baseline_lap, comparison_lap):
    meta, laps = _prepared(baseline_lap, comparison_lap)
    lockup = next(e for e in meta["events"]
                  if "lock" in e["label"].lower())
    stats = event_channel_stats(laps["TST"], lockup)
    # the dip happens INSIDE the range - min must sit well below entry
    assert stats["speed"]["min"] < stats["speed"]["entry"] - 20
    assert stats["brake"]["max"] >= 50         # heavy braking in range


def test_csv_zip_contains_both_files(baseline_lap, comparison_lap):
    meta, laps = _prepared(baseline_lap, comparison_lap)
    blob = build_csv_zip(meta, laps)
    z = zipfile.ZipFile(io.BytesIO(blob))
    assert set(z.namelist()) == {"telemetry.csv", "events.csv"}
    telemetry = z.read("telemetry.csv").decode()
    head = telemetry.splitlines()[0]
    assert "TST_speed" in head and "TST_delta" in head
    events_csv = z.read("events.csv").decode()
    assert "speed_entry" in events_csv.splitlines()[0]
    assert len(events_csv.splitlines()) == len(meta["events"]) + 1


def test_pdf_generates_valid_bytes(baseline_lap, comparison_lap):
    meta, laps = _prepared(baseline_lap, comparison_lap)
    blob = build_pdf(meta, laps)
    assert blob[:5] == b"%PDF-"
    assert len(blob) > 2000
