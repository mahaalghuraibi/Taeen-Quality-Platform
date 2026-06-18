#!/usr/bin/env bash
set -e

# Render free tier: single worker, tight keep-alive, low backlog to avoid OOM.
export MALLOC_TRIM_THRESHOLD_=65536
export OMP_NUM_THREADS=1
export MKL_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1

echo "[start_render.sh] Bootstrapping database schema + admin..."
python scripts/bootstrap_db.py || echo "[start_render.sh] bootstrap_db failed — API will retry on first request"

echo "[start_render.sh] Running create_admin.py..."
python scripts/create_admin.py || echo "[start_render.sh] create_admin skipped (admin may already exist)"

echo "[start_render.sh] Starting uvicorn on port ${PORT:-10000}..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-10000}" \
  --workers 1 \
  --log-level info \
  --timeout-keep-alive 5 \
  --backlog 64 \
  --limit-concurrency 20
