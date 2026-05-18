#!/usr/bin/env bash
set -e

# Render free tier: single worker, tight keep-alive, low backlog to avoid OOM.
# MALLOC_TRIM_THRESHOLD_ helps the Python allocator return freed heap to the OS after GC.
export MALLOC_TRIM_THRESHOLD_=65536

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-10000}" \
  --workers 1 \
  --log-level info \
  --timeout-keep-alive 5 \
  --backlog 64 \
  --limit-concurrency 20
