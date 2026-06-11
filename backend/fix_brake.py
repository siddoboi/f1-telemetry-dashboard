from pathlib import Path

path = Path("app/data/fastf1_loader.py")
content = path.read_text()

# find the target line and inject the fix after it
target = '    df["ngear"] = df["ngear"].round().astype(int)'
fix = '\n    # Normalize brake: FastF1 returns 0/1 boolean in some sessions\n    if df["brake"].max() <= 1.0:\n        df["brake"] = df["brake"] * 100'

if fix in content:
    print("Fix already present — nothing to do.")
elif target in content:
    content = content.replace(target, target + fix)
    path.write_text(content)
    print("Fix applied successfully.")
else:
    print("ERROR: target line not found. Print the file and check manually.")
    print("Looking for:", repr(target))