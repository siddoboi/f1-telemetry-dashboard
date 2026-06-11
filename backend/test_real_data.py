import sys
sys.path.insert(0, '.')

import fastf1
import pandas as pd
from pathlib import Path

from app.ml.anomaly_detector import AnomalyDetector, extract_events
from app.ml.physics_rules import agreement_report
from app.data.fastf1_loader import (
    load_session, lap_to_distance_grid,
    session_optimal_lap, build_comparison
)

# ── config ── change these to any completed 2024/2025 event ──────────────
YEAR    = 2024
ROUND   = 1          # Bahrain GP
SESSION = 'Q'        # Qualifying
DRIVER  = 'VER'      # driver to score
# ─────────────────────────────────────────────────────────────────────────

print(f"Loading {YEAR} Round {ROUND} {SESSION}...")
print("(First run downloads ~200 MB — takes a few minutes. Cached after.)\n")

ses = load_session(YEAR, ROUND, SESSION)

# pick driver's fastest lap and session optimal as baseline
drv_lap  = ses.laps.pick_drivers(DRIVER).pick_fastest()
base_lap = session_optimal_lap(ses)

print(f"Driver lap   : {DRIVER}  lap {int(drv_lap['LapNumber'])}  "
      f"{drv_lap['LapTime']}")
print(f"Baseline lap : {base_lap['Driver']}  lap {int(base_lap['LapNumber'])}  "
      f"{base_lap['LapTime']}\n")

comp_df = lap_to_distance_grid(drv_lap)
base_df = lap_to_distance_grid(base_lap)

print(f"Distance grid: {len(comp_df)} steps  "
      f"({comp_df['distance'].min():.0f} m – {comp_df['distance'].max():.0f} m)\n")

print("Fitting Isolation Forest on baseline lap...")
det = AnomalyDetector().fit(base_df)

print("Scoring comparison lap...")
scored = det.score(comp_df, base_df)

flagged = int(scored['anomaly'].sum())
events  = extract_events(scored, DRIVER)
report  = agreement_report(scored, scored['anomaly'].to_numpy())

print(f"\nResults:")
print(f"  Frames scored  : {len(scored)}")
print(f"  Frames flagged : {flagged}  "
      f"({flagged/len(scored)*100:.1f}% of lap)")

print(f"\nAnomaly events detected ({len(events)} total):")
for e in events:
    print(f"  {e['start_distance']:>6.0f} – {e['end_distance']:<6.0f} m  |  "
          f"{e['label']:<35}  |  peak {e['peak_score']:.3f}")
    print(f"           {e['diagnosis'][:90]}")

print(f"\nML vs physics-rules validation:")
print(f"  ML flagged     : {report['ml_flagged']}")
print(f"  Rules flagged  : {report['rules_flagged']}")
print(f"  Agreement      : {report['agreement']}")
prec = report['precision_vs_rules']
rec  = report['recall_vs_rules']
print(f"  Precision      : {f'{prec*100:.0f}%' if prec is not None else '—'}")
print(f"  Recall         : {f'{rec*100:.0f}%' if rec  is not None else '—'}")

# channel-level stats for a quick sanity check
print(f"\nChannel ranges (comparison lap):")
for ch in ['speed', 'throttle', 'brake', 'rpm']:
    col = scored[ch] if ch in scored.columns else comp_df[ch]
    print(f"  {ch:<10} min={col.min():.1f}  max={col.max():.1f}  "
          f"mean={col.mean():.1f}")

print("\nDone.")