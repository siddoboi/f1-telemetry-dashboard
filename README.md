# F1 Real-Time Telemetry & Driver Consistency Dashboard

A full-stack application that replays real Formula 1 telemetry as a simulated
real-time stream, compares each driver against a baseline lap **indexed by
track distance**, and uses an unsupervised **Isolation Forest** to flag driving
anomalies (lock-ups, wheelspin, throttle instability, mid-corner snaps) with
automated text diagnoses.

```
FastF1 (historical data)
   └─> Distance-grid alignment (5 m steps)        backend/app/data/fastf1_loader.py
        └─> Isolation Forest scoring + physics    backend/app/ml/
             rule validation
             └─> Replay engine @ 10 Hz            backend/app/replay/replay_engine.py
                  └─> FastAPI WebSocket           backend/app/main.py
                       └─> React + Recharts UI    frontend/src/
                            └─> MongoDB time-series persistence (optional)
```

**Honest framing:** there is no public live F1 feed outside of ~24 race
weekends a year, so this system uses *historical replay through a real-time
processing architecture*. The backend pipeline (WebSocket streaming, per-frame
ML scoring, live charts) is identical to what a true live feed would require —
only the data source is a replay engine with a configurable tick rate.

---

## 1. Prerequisites

You need four things: **Python 3.11+**, **Node.js 18+ (LTS)**, **Git**, and
optionally **MongoDB Community Server** (the app runs without it; you only
lose lap-history persistence).

### Windows

1. **Python** — download from https://www.python.org/downloads/ (3.11 or 3.12).
   During install, tick **"Add python.exe to PATH"**. Verify:
   ```
   python --version
   ```
2. **Node.js** — download the LTS installer from https://nodejs.org/. Verify:
   ```
   node --version
   npm --version
   ```
3. **Git** — https://git-scm.com/download/win, default options. Verify:
   ```
   git --version
   ```
4. **MongoDB (optional)** — https://www.mongodb.com/try/download/community
   → Windows MSI → "Complete" → keep **"Install MongoDB as a Service"**
   checked. It then runs automatically on `mongodb://localhost:27017`.

### macOS

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install python@3.12 node git
brew tap mongodb/brew && brew install mongodb-community   # optional
brew services start mongodb-community                      # optional
```

### Ubuntu / Debian Linux

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nodejs npm git
# MongoDB (optional): follow https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/
```

---

## 2. Project setup

### 2.1 Backend

```bash
cd backend

# create + activate a virtual environment
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt

# optional: copy env template (defaults work out of the box)
copy .env.example .env        # Windows
cp .env.example .env          # macOS/Linux

# run the API
uvicorn app.main:app --reload --port 8000
```

You should see `Uvicorn running on http://127.0.0.1:8000`. Open
http://localhost:8000/api/health — it returns
`{"status":"ok","mongo":true|false}`.

> **First-load warning:** the first time you open a session, FastF1 downloads
> hundreds of MB of telemetry from the F1 servers. This takes **2–10 minutes**
> depending on your connection. It is cached in `backend/ff1_cache/` and is
> near-instant afterwards. Pre-warm the cache before any demo.

### 2.2 Frontend

In a **second terminal**:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` and `/ws` to
the backend, so no CORS or host configuration is needed in development.

### 2.3 First run, end to end

1. Season → `2025`, Grand Prix → any completed event, Session → `Q`
2. Wait for drivers to load (first time = telemetry download)
3. Pick 2 drivers (e.g. teammates), leave laps on "Fastest lap"
4. Baseline → "Session optimal", press **Start replay**
5. Watch the charts draw in at 10 Hz; anomaly bands appear in team colors;
   click a band to open its diagnosis in the right-hand event log.

---

## 3. How the core pieces work

### Distance alignment (`fastf1_loader.py`)
Raw telemetry is irregularly sampled in time. Comparing two laps by time is
meaningless (a slower driver is at a *different corner* at the same t).
`lap_to_distance_grid()` interpolates every channel onto a uniform grid of
one sample every 5 m, so "VER at 1 250 m" and "NOR at 1 250 m" are the same
piece of track. Distance is the X-axis everywhere.

### Anomaly detection (`ml/anomaly_detector.py`)
Unsupervised: an Isolation Forest is fitted on the **baseline lap's** feature
vectors (assumed nominal driving), then scores the comparison lap. Features
combine raw state (throttle, brake), derivatives along distance (how violently
speed/RPM/throttle change), and deltas vs the baseline at the same distance.
The decision score is calibrated to a 0–1 "anomaly probability"; ≥ 0.65 flags.

### Validation (`ml/physics_rules.py`)
The forest has no labels, so we judge it against four independent physics
rules (lock-up, wheelspin, throttle oscillation, snap lift). The sidebar's
"Model validation" panel reports the agreement between ML flags and rule
flags. Rules also supply the human-readable label for each flagged event.

### Replay (`replay/replay_engine.py`)
An async generator emits one multi-driver frame bundle per tick (default
10 Hz, adjustable 0.5×–8× from the UI, with pause/resume). Consumers cannot
tell the data is historical — which is the point.

### Persistence (`data/database.py`)
After a replay completes, frames are written to a MongoDB **time-series
collection** (`timeField: ts`, `metaField: {year, round, session, driver,
lap}`). If MongoDB isn't running the app logs a warning and continues —
persistence is additive, never required.

---

## 4. Project structure

```
f1-telemetry-dashboard/
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   └── app/
│       ├── main.py               FastAPI app: REST + /ws/replay
│       ├── config.py             all tunables, env-overridable
│       ├── models/schemas.py     Pydantic request/response models
│       ├── data/
│       │   ├── fastf1_loader.py  session loading + distance alignment
│       │   └── database.py       MongoDB time-series (optional)
│       ├── ml/
│       │   ├── anomaly_detector.py  Isolation Forest engine
│       │   └── physics_rules.py     rule-based weak labels + validation
│       └── replay/replay_engine.py  10 Hz frame streamer
└── frontend/
    ├── package.json / vite.config.js / index.html
    └── src/
        ├── App.jsx                       state + frame merging
        ├── api/client.js                 REST + ReplayClient (WebSocket)
        ├── components/ControlPanel.jsx   cascading selectors + controls
        ├── components/TelemetryCharts.jsx  synced charts + anomaly bands
        ├── components/AnomalySidebar.jsx   event log + validation panel
        └── styles.css                    pit-wall theme
```

---

## 5. Roadmap (phased)

| Phase | Goal | Status |
|---|---|---|
| 1 | 2-driver replay, IF anomaly engine, synced charts, event log | this repo |
| 2 | Scale `MAX_DRIVERS` to full grid; per-driver worker processes; pagination of charts | next |
| 3 | History browser backed by MongoDB (`/api/history` already exists) | next |
| 4 | Track-map view (GPS X/Y from FastF1 `pos_data`) with anomaly markers | stretch |
| 5 | Cloud deploy: backend on a VM/container (FastF1 cache on a volume), frontend static build, MongoDB Atlas | stretch |

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Loading drivers...` hangs minutes | Normal on first session load (telemetry download). Watch backend terminal for FastF1 progress. |
| `mongo: false` in /api/health | MongoDB not running. App still works; start the MongoDB service to enable persistence. |
| WebSocket error in UI | Backend not running on :8000, or you opened the built frontend without the proxy. Run `uvicorn` first. |
| `rate limit` messages from FastF1 | The underlying API throttles; FastF1 handles waits automatically. Avoid hammering many fresh sessions in a row. |
| Charts feel laggy | Lower replay speed, or raise `DISTANCE_STEP_M` to 10 in `.env` (half the points). |
| 2026 sessions missing | Only completed sessions have telemetry. Use 2024/2025 for development. |

## 7. Disclaimer

Unofficial project, not associated with Formula 1 or the FIA. Data accessed
via the open-source FastF1 library for educational use.
