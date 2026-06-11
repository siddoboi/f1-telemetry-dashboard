from pathlib import Path

detector = Path("app/ml/anomaly_detector.py")
content = detector.read_text()

old = '''    # discard one-step blips (a single 5 m flag is usually noise)
    return [e for e in events if e["end_distance"] - e["start_distance"]
            >= 2 * config.DISTANCE_STEP_M]'''

new = '''    # discard one-step blips (a single 5 m flag is usually noise)
    events = [e for e in events if e["end_distance"] - e["start_distance"]
              >= 2 * config.DISTANCE_STEP_M]
    # merge events within 30 m of each other into one (same braking zone)
    return _merge_nearby(events, gap_m=30.0)'''

if "return _merge_nearby" in content:
    print("Already wired — nothing to do.")
elif old in content:
    content = content.replace(old, new)
    detector.write_text(content)
    print("Wired successfully.")
else:
    # show what's actually there so we can match it exactly
    import re
    match = re.search(r'# discard one-step.*?return \[.*?\]', content,
                      re.DOTALL)
    print("ERROR: target not found. Actual text:")
    print(repr(match.group()) if match else "block not found at all")