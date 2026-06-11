# 🏎️ PIT WALL — F1 Real-Time Telemetry & Driver Consistency Dashboard

A full-stack motorsport analytics platform that streams real Formula 1 telemetry —
historical laps replayed through a real-time pipeline, OpenF1's delayed live feed
during race weekends, or instantly from a local database — compares drivers against
a baseline lap **indexed by track distance**, and uses an unsupervised
**Isolation Forest** to flag driving anomalies (tyre lock-ups, wheelspin, throttle
instability, mid-corner snaps) with automated text diagnoses.

**Stack:** FastAPI · WebSockets · scikit-learn · FastF1 · OpenF1 · MongoDB Time Series · React · Recharts · Vite

---

## Why distance, not time?

Comparing two laps by elapsed time is meaningless — a slower driver is at a
*different corner* at the same `t`. Every channel here is resampled onto a uniform
5 m distance grid, so "VER at 1,250 m" and "LEC at 1,250 m" are the same piece of
track. Distance is the X-axis everywhere: charts, anomaly events, zoom, track map.

## Architecture

```
FastF1 (historical)     OpenF1 (live, ~30 s delay)     MongoDB (saved laps)
   │                        │                              │
   ▼                        ▼                              ▼
Distance-grid alignment   Polling client +            history_serve.py
(5 m steps, brake         distance integration        (re-serve, no FastF1)
 normalisation, GPS)          │                            │
   │                          │                            │
   ▼                          ▼                            ▼
Isolation Forest fitted   Incremental physics        Stored scores re-used,
on baseline lap +         rules (no baseline         events re-extracted
physics-rule validation   exists mid-session)
   └──────────────┬───────────┴────────────────────────────┘
                  ▼
        Replay engine (10 Hz, pause/speed) → FastAPI WebSocket
                  ▼
        React dashboard: Telemetry · Track Map · Session · History
```

## Features

**Telemetry analysis**
- Up to **5 drivers** compared simultaneously, distance-synchronized
- Channel views: Speed · Throttle · Brake · RPM · Gear · DRS
- **STACKED** (drivers overlaid) / **SEPARATE** (one chart per driver) toggle
- Baseline modes: **Session optimal** · **Personal best** · **Off** (rules-only anomalies)
- Editing-software **timeline zoom**: minimap scrubber + Ctrl+scroll, synced across all charts

**ML anomaly engine**
- Isolation Forest trained on the baseline lap, scoring the comparison lap on
  baseline-delta + derivative features
- Validated against four independent physics rules (lock-up, wheelspin, throttle
  oscillation, snap lift) — agreement metrics shown in the UI
- Anomaly fragments merged across 30 m, then blip-filtered; events carry
  programmatic text diagnoses
- Tuned on real data (2024 Bahrain GP Qualifying, VER vs LEC)

**Views**
- **Track Map** — SVG circuit from baseline GPS; every driver's dot moves on its
  *own* GPS position; anomaly markers are clickable
- **Session** — lap-time progression chart + clickable lap film strip; click any
  lap to reload the replay with it
- **History** — every completed replay persists to a MongoDB time-series
  collection; select up to 5 saved laps and replay them **instantly, offline,
  without FastF1**
- **Driver profile overlay** — hover a driver chip: headshot, grid/finish,
  fastest lap, top speed, pit stops
- **Live mode** — when a real F1 session is running, stream it via OpenF1
  (~30 s delay, stated honestly in the UI)

## Quick start

Prerequisites: **Python 3.11+**, **Node.js 18+**, optionally **MongoDB Community**
(the app runs without it; you lose lap persistence). Full from-zero install
instructions for Windows / macOS / Linux are in [`docs/SETUP.md`](docs/SETUP.md).

```bash
# Backend (terminal 1)
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (terminal 2)
cd frontend
npm install
npm run dev                      # → http://localhost:5173
```

First session load downloads telemetry from F1's servers (2–10 min) and is cached
in `backend/ff1_cache/` afterwards. Pre-warm the cache before demos.

**First run:** Season `2024` → `R1 Bahrain` → `Q` → pick `VER` + `LEC` →
baseline `Session optimal` → **Start replay**.

## Detection tuning (validated on real data)

| Parameter | Value | Why |
|---|---|---|
| `ANOMALY_THRESHOLD` | 0.72 | Calibrated on 2024 Bahrain Q; 0.65 over-flagged |
| `THROTTLE_OSC_STD` | 38.0 | 16.0 fired on normal driver style differences |
| Brake channel | normalised 0/1 → 0–100 % | FastF1 returns boolean brake in some sessions |
| Event merging | 30 m gap, merge **before** blip filter | Rescues fragmented genuine events |

Result on VER vs LEC (Bahrain Q): 16 merged events, both injected-fault synthetic
tests pass, 7.4 % of frames flagged.

## Honest limitations

- **No true real-time feed exists publicly.** Replay mode is "historical data
  through a real-time architecture"; live mode is OpenF1's ~30 s-delayed feed.
- Live mode scores with physics rules only — the Isolation Forest needs a
  baseline lap, which doesn't exist mid-session.
- History mode: no track map (GPS isn't persisted), baseline = fastest selected
  lap, profile/session views need a FastF1 context.
- Track-map anomaly markers sit on the baseline racing line.

## Project structure

```
backend/app/
├── main.py                 REST + WebSocket (replay · live · history)
├── config.py               all tunables, env-overridable
├── data/                   fastf1_loader · openf1_client · database · team_colors
├── ml/                     anomaly_detector (IF) · physics_rules (validation)
└── replay/                 replay_engine (10 Hz) · history_serve (Mongo)
frontend/src/
├── App.jsx                 state, tabs, zoom domain, overlays
├── api/client.js           REST + WebSocket client
└── components/             TelemetryView · TrackMapView · SessionView ·
                            HistoryView · Minimap · ControlPanel · NavBar ·
                            ProfileOverlay · AnomalySidebar · TelemetryCharts
```

## Roadmap

- [x] Phase 1 — replay pipeline, Isolation Forest, synced charts, event log
- [x] Phase 2 — 5 drivers, nav tabs, zoom minimap, track map, live mode
- [x] Phase 2.5 — session timeline, profile overlay, per-driver GPS, baseline off, real-data tuning
- [x] Phase 3 — instant history re-serve from MongoDB
- [ ] Delta-time chart (time gained/lost vs baseline along distance)
- [ ] Corner segmentation: per-corner anomaly reporting
- [ ] Mongo schema v2: persist GPS + events + baseline
- [ ] Performance optimization pass (profile-first)
- [ ] Second ML method (DTW / autoencoder) vs Isolation Forest — research study
- [ ] Cloud deploy: containerised backend, static frontend, MongoDB Atlas

## Disclaimer

Unofficial project — not associated with Formula 1, the FIA, or any team. Data
accessed via the open-source [FastF1](https://github.com/theOehrly/Fast-F1) and
[OpenF1](https://openf1.org) projects for educational use. F1® is a trademark of
Formula One Licensing B.V.

## License

[MIT](LICENSE)
