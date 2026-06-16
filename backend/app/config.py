"""
Central configuration. Every value can be overridden with an environment
variable of the same name (see backend/.env.example).
"""
import os
from pathlib import Path

# ---------------------------------------------------------------- paths ----
BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
FASTF1_CACHE_DIR = Path(os.getenv("FASTF1_CACHE_DIR", BASE_DIR / "ff1_cache"))

# ------------------------------------------------------------- database ----
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "f1_telemetry")
TELEMETRY_COLLECTION = "telemetry_frames"   # MongoDB time-series collection
SESSION_META_COLLECTION = "session_meta"

# --------------------------------------------------------------- replay ----
DEFAULT_TICK_RATE_HZ = float(os.getenv("TICK_RATE_HZ", "30"))   # frames/sec
DISTANCE_STEP_M = float(os.getenv("DISTANCE_STEP_M", "5"))      # resample grid
MAX_DRIVERS = int(os.getenv("MAX_DRIVERS", "5"))                # per comparison

# -------------------------------------------------------------- openf1 ----
OPENF1_BASE = os.getenv("OPENF1_BASE", "https://api.openf1.org/v1")
LIVE_POLL_INTERVAL_S = float(os.getenv("LIVE_POLL_INTERVAL_S", "1.5"))

# ------------------------------------------------------------------- ml ----
IF_N_ESTIMATORS = int(os.getenv("IF_N_ESTIMATORS", "200"))
IF_CONTAMINATION = float(os.getenv("IF_CONTAMINATION", "0.03"))
ANOMALY_THRESHOLD = float(os.getenv("ANOMALY_THRESHOLD", "0.72"))  # 0..1 score

# ----------------------------------------------------------------- cors ----
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
