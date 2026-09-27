#!/usr/bin/env bash
# Starts the FastAPI backend (port 8000) and the Vite frontend (port 5173) together.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"

(cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --reload --port "$PORT") &
BACK=$!
(cd "$ROOT/frontend" && GRIDTWIN_API="http://localhost:$PORT" npm run dev) &
FRONT=$!

trap 'kill $BACK $FRONT 2>/dev/null' EXIT INT TERM
echo "Backend  → http://localhost:$PORT  (API docs at /docs)"
echo "Frontend → http://localhost:5173"
wait
