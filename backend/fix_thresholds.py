from pathlib import Path

# Fix 1: raise throttle oscillation threshold 28 -> 38
rules = Path("app/ml/physics_rules.py")
content = rules.read_text()

if "THROTTLE_OSC_STD = 38.0" in content:
    print("Throttle fix already applied.")
elif "THROTTLE_OSC_STD = 28.0" in content:
    content = content.replace(
        "THROTTLE_OSC_STD = 28.0",
        "THROTTLE_OSC_STD = 38.0"
    )
    rules.write_text(content)
    print("Fix 1 applied: THROTTLE_OSC_STD -> 38.0")
else:
    print("ERROR: THROTTLE_OSC_STD line not found at expected value.")
    import re
    match = re.search(r"THROTTLE_OSC_STD\s*=\s*[\d.]+", content)
    print("Found:", match.group() if match else "NOT FOUND")

# Fix 2: increase event merge gap in anomaly_detector.py
# Currently events < 2 steps (10 m) apart are kept separate → raise to 6 steps (30 m)
detector = Path("app/ml/anomaly_detector.py")
content = detector.read_text()

old = "    return [e for e in events if e[\"end_distance\"] - e[\"start_distance\"]\n            >= 2 * config.DISTANCE_STEP_M]"
new = "    return [e for e in events if e[\"end_distance\"] - e[\"start_distance\"]\n            >= 2 * config.DISTANCE_STEP_M]\n\n\ndef _merge_nearby(events, gap_m=30.0):\n    \"\"\"Merge events within gap_m metres of each other (same driver).\"\"\"\n    if not events:\n        return []\n    merged, current = [], events[0].copy()\n    for ev in events[1:]:\n        if (ev[\"driver\"] == current[\"driver\"]\n                and ev[\"start_distance\"] - current[\"end_distance\"] <= gap_m):\n            current[\"end_distance\"] = ev[\"end_distance\"]\n            current[\"peak_score\"] = max(current[\"peak_score\"], ev[\"peak_score\"])\n            # keep the more specific label\n            if ev[\"label\"] != \"Atypical telemetry pattern\":\n                current[\"label\"] = ev[\"label\"]\n                current[\"diagnosis\"] = ev[\"diagnosis\"]\n        else:\n            merged.append(current)\n            current = ev.copy()\n    merged.append(current)\n    return merged"

if "_merge_nearby" in content:
    print("Merge fix already applied.")
else:
    content = content.replace(old, new)
    if "_merge_nearby" in content:
        detector.write_text(content)
        print("Fix 2 applied: _merge_nearby() added to anomaly_detector.py")
    else:
        print("ERROR: could not find target block in anomaly_detector.py")