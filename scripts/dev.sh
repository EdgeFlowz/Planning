#!/usr/bin/env bash
# Runs the API (:8000), worker and frontend (:5173) together in one terminal.
# Ctrl+C stops all three. Postgres/Redis must already be reachable (see backend/.env).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Ctrl+C stops every process started here; they share this script's process group.
trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT

(cd "$ROOT/backend" && uv run uvicorn app.main:app --reload --port 8000) &
(cd "$ROOT/backend" && PYTHONUNBUFFERED=1 uv run python -m worker.main) &
(cd "$ROOT/frontend" && npm run dev) &

wait
