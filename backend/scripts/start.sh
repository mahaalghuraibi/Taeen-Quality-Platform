#!/usr/bin/env bash
# Universal start script — works on Railway, Render, and plain Docker.
# PORT is injected by Railway (auto) and Render (env var); falls back to 8000 for local runs.
set -e

export MALLOC_TRIM_THRESHOLD_=65536
export OMP_NUM_THREADS=1
export MKL_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1

# Seed admin/supervisor on every start (idempotent — skips if already exists).
echo "[start.sh] Running create_admin.py..."
python scripts/create_admin.py || echo "[start.sh] create_admin.py exited non-zero (ignored — admin may already exist)"

echo "[start.sh] Starting uvicorn on port ${PORT:-8000}..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers 1 \
  --log-level info \
  --timeout-keep-alive 5 \
  --backlog 64 \
  --limit-concurrency 20
