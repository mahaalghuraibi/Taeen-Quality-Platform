#!/usr/bin/env python3
"""Run at deploy/start: create schema, seed admin, verify DB connectivity."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import sanitize_database_url_for_log, settings
from app.db.session import init_db_with_retry, verify_database_connection
from app.services.admin_seed import ensure_seeded_admin_from_env


def main() -> int:
    print(f"[bootstrap_db] runtime={sanitize_database_url_for_log(settings.DATABASE_URL)}")
    print(f"[bootstrap_db] bootstrap={sanitize_database_url_for_log(settings.DATABASE_BOOTSTRAP_URL)}")
    print(f"[bootstrap_db] seed_admin={settings.SEED_ADMIN_EMAIL}")
    try:
        init_db_with_retry(max_attempts=4, delay_sec=2.0)
        verify_database_connection()
        ensure_seeded_admin_from_env()
        print("[bootstrap_db] OK — schema ready, admin seeded")
        return 0
    except Exception as exc:
        print(f"[bootstrap_db] FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
