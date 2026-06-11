from pathlib import Path

detector = Path("app/ml/anomaly_detector.py")
content = detector.read_text()

# Check current state of extract_events return
import re
match = re.search(r'def extract_events.*?^(?=def |\Z)', content,
                  re.DOTALL | re.MULTILINE)
if match:
    print("Current extract_events:")
    print(match.group()[-300:])
else:
    print("extract_events not found")

# Check _merge_nearby exists
print("\n_merge_nearby present:", "_merge_nearby" in content)
print("_merge_nearby called in extract_events:",
      "return _merge_nearby" in content)