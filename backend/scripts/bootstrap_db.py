#!/usr/bin/env python3
"""Run at deploy/start: create schema, seed admin, verify DB connectivity."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import database_host_from_url, sanitize_database_url_for_log, settings
from app.db.session import init_db_with_retry, verify_database_connection
from app.services.admin_seed import seed_production_admin


def main() -> int:
    print(f"DATABASE_URL = {sanitize_database_url_for_log(settings.DATABASE_URL)}", flush=True)
    print(f"BOOTSTRAP_URL = {sanitize_database_url_for_log(settings.DATABASE_BOOTSTRAP_URL)}", flush=True)
    print(f"runtime_host = {database_host_from_url(settings.DATABASE_URL)}", flush=True)
    print(f"bootstrap_host = {database_host_from_url(settings.DATABASE_BOOTSTRAP_URL)}", flush=True)
    print(f"[bootstrap_db] seed_admin={settings.SEED_ADMIN_EMAIL}", flush=True)
    try:
        init_db_with_retry(max_attempts=4, delay_sec=2.0)
        verify_database_connection()
        seed_production_admin(force_password_sync=True)
        print("[bootstrap_db] OK — schema ready, admin seeded", flush=True)
        return 0
    except Exception as exc:
        print(f"[bootstrap_db] FAILED: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
