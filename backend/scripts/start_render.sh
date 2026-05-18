#!/usr/bin/env bash
# Render production: start API only. YOLO weights download lazily on first analyze-frame.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[start] Starting uvicorn (YOLO lazy-load at runtime, no preload)"
exec uvicorn app.main:app --host 0.0.0.0 --port="${PORT:-8000}"
