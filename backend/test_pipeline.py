import sys, numpy as np, pandas as pd
sys.path.insert(0, '.')
from app.ml.anomaly_detector import AnomalyDetector, extract_events
from app.ml.physics_rules import apply_rules, agreement_report

rng = np.random.default_rng(42)
n = 1000
dist = np.arange(n) * 5.0

def make_lap(noise=0.5):
    speed    = 200 + 80*np.sin(dist/400) + rng.normal(0, noise, n)
    throttle = np.clip(60 + 40*np.sin(dist/400) + rng.normal(0, 2, n), 0, 100)
    brake    = (np.sin(dist/400) < -0.6).astype(float) * 100
    rpm      = speed * 55 + rng.normal(0, 60, n)
    gear     = np.clip((speed // 40).astype(int), 1, 8)
    return pd.DataFrame({"distance": dist, "speed": speed, "rpm": rpm,
                         "gear": gear, "throttle": throttle,
                         "brake": brake, "drs": 0, "time_s": dist/60})

baseline = make_lap()
comparison = make_lap()

# inject lock-up at ~2000 m
i = 400
comparison.loc[i:i+6, "brake"]  = 100
comparison.loc[i:i+6, "speed"] -= np.linspace(0, 65, 7)

# inject wheelspin at ~3500 m
j = 700
comparison.loc[j:j+5, "rpm"]      += np.linspace(0, 2800, 6)
comparison.loc[j:j+5, "throttle"]  = 95

print("Fitting Isolation Forest on baseline lap...")
det = AnomalyDetector().fit(baseline)

print("Scoring comparison lap...")
scored = det.score(comparison, baseline)

flagged = int(scored["anomaly"].sum())
events  = extract_events(scored, "TST")
report  = agreement_report(scored, scored["anomaly"].to_numpy())

print(f"\nResults:")
print(f"  Frames scored  : {len(scored)}")
print(f"  Frames flagged : {flagged}")
print(f"\nEvents detected:")
for e in events:
    print(f"  {e['start_distance']:.0f}-{e['end_distance']:.0f} m  |  "
          f"{e['label']}  |  peak score {e['peak_score']:.3f}")

print(f"\nML vs physics-rules validation:")
print(f"  ML flagged     : {report['ml_flagged']}")
print(f"  Rules flagged  : {report['rules_flagged']}")
print(f"  Agreement      : {report['agreement']}")
prec = report['precision_vs_rules']
rec  = report['recall_vs_rules']
print(f"  Precision      : {f'{prec*100:.0f}%' if prec else '-'}")
print(f"  Recall         : {f'{rec*100:.0f}%' if rec  else '-'}")

# assertions
assert flagged > 0, "FAIL: nothing flagged"
assert any(1950 <= e["start_distance"] <= 2100
           and "lock" in e["label"].lower() for e in events), \
    "FAIL: lock-up not detected"
assert any(3400 <= e["start_distance"] <= 3700
           and ("wheelspin" in e["label"].lower()
                or "traction" in e["label"].lower()) for e in events), \
    "FAIL: wheelspin not detected"

print("\nPIPELINE TEST: PASS")