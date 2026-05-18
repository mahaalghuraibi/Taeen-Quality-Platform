#!/usr/bin/env bash
# Render production: ensure PPE weights exist before accepting traffic.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[start] Ensuring YOLO PPE model in ml/models/ ..."
if ! python ml/download_ppe_model.py --fallback-only; then
  echo "[start] download script failed — trying resolver fallback download"
  python -c "from app.services.yolo_model_resolver import _download_fallback_ppe_model; p=_download_fallback_ppe_model(); import sys; sys.exit(0 if p else 1)"
fi

echo "[start] Starting uvicorn on port ${PORT:-8000}"
exec uvicorn app.main:app --host 0.0.0.0 --port="${PORT:-8000}"
