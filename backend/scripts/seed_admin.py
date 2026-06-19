#!/usr/bin/env python3
"""Idempotent admin seed — safe to run on every Render deploy/start."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import settings
from app.db.session import init_db_with_retry, verify_database_connection
from app.services.admin_seed import seed_production_admin


def main() -> int:
    print(f"[seed_admin] email={settings.SEED_ADMIN_EMAIL}", flush=True)
    if not (settings.SEED_ADMIN_PASSWORD or "").strip():
        print("[seed_admin] ERROR — SEED_ADMIN_PASSWORD not set", file=sys.stderr, flush=True)
        return 1
    try:
        init_db_with_retry(max_attempts=4, delay_sec=2.0)
        verify_database_connection()
        seed_production_admin(force_password_sync=True)
        print("[seed_admin] OK", flush=True)
        return 0
    except Exception as exc:
        print(f"[seed_admin] FAILED: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
