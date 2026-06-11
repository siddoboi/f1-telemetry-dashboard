# Setup — from absolute zero

Four things needed: **Python 3.11+**, **Node.js 18+ (LTS)**, **Git**, and
optionally **MongoDB Community Server** (without it the app still runs; you
only lose lap-history persistence and the History tab).

## Windows

1. **Python** — https://www.python.org/downloads/ (3.11/3.12). During install
   tick **"Add python.exe to PATH"**. Verify: `python --version`
2. **Node.js** — LTS installer from https://nodejs.org/. Verify: `node --version`
3. **Git** — https://git-scm.com/download/win, default options.
4. **MongoDB (optional)** — https://www.mongodb.com/try/download/community →
   Windows MSI → "Complete" → keep **"Install MongoDB as a Service"** checked.
   Runs automatically on `mongodb://localhost:27017`.

> **Windows tip:** use **Command Prompt (cmd)** or set
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
> in an admin PowerShell once — otherwise PowerShell blocks `npm` and the
> venv `activate` script.

## macOS

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install python@3.12 node git
brew tap mongodb/brew && brew install mongodb-community   # optional
brew services start mongodb-community                      # optional
```

## Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nodejs npm git
# MongoDB (optional): https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/
```

## Backend

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # Windows: copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

Check http://localhost:8000/api/health → `{"status":"ok","mongo":true|false}`.

> **First session load downloads ~200 MB+** of telemetry from F1's servers and
> takes 2–10 minutes. It is cached in `backend/ff1_cache/` and near-instant
> afterwards. **Pre-warm the cache before any demo.**

## Frontend

Second terminal:

```bash
cd frontend
npm install
npm run dev          # → http://localhost:5173
```

The Vite dev server proxies `/api` and `/ws` to the backend — no CORS config
needed in development.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `uvicorn` not recognised | venv not activated, or run `python -m uvicorn app.main:app --reload --port 8000` |
| `ModuleNotFoundError: No module named 'app'` | uvicorn started from the wrong directory — run it from `backend/` |
| npm "running scripts is disabled" | PowerShell policy — use cmd, or `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` as admin |
| "Loading drivers..." hangs minutes | Normal on first session load; watch the backend terminal for FastF1 progress |
| `mongo: false` in /api/health | MongoDB not running; app works, persistence skipped |
| WebSocket error in UI | Backend not running on :8000 |
| Dashboard shows stale behaviour after edits | Restart uvicorn — module-level threshold changes need a fresh process |
| Charts feel laggy | Lower replay speed, or set `DISTANCE_STEP_M=10` in `.env` |
| 2026 sessions missing | Only completed sessions have telemetry; use 2024/2025 for development |
