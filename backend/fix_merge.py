from pathlib import Path

detector = Path("app/ml/anomaly_detector.py")
content = detector.read_text()

old = '    # discard one-step blips (a single 5 m flag is usually noise)\n    return [e for e in events if e["end_distance"] - e["start_distance"]\n            >= 2 * config.DISTANCE_STEP_M]'

new = '    # discard one-step blips (a single 5 m flag is usually noise)\n    events = [e for e in events if e["end_distance"] - e["start_distance"]\n              >= 2 * config.DISTANCE_STEP_M]\n    # merge events within 30 m of each other (same driver, same braking zone)\n    return _merge_nearby(events, gap_m=30.0)'

if "_merge_nearby(events" in content:
    print("Wire-up already applied.")
elif old in content:
    content = content.replace(old, new)
    detector.write_text(content)
    print("Fix applied: extract_events now calls _merge_nearby()")
else:
    print("ERROR: target block not found.")
    print("Check extract_events() return statement manually.")