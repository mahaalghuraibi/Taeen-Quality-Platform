"""
Create or update the platform admin user.

Usage (local / CI):
  python scripts/create_admin.py admin@example.com yourpassword

Render / env-only (uses app.core.config → SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD):
  python scripts/create_admin.py

Run from the `backend/` directory (Render rootDir should be `backend`).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import settings
from app.db.session import SessionLocal, init_db_with_retry
from app.services.admin_seed import ensure_platform_admin
from app.services.auth_service import normalize_email


def _resolve_credentials() -> tuple[str, str]:
    if len(sys.argv) >= 3:
        return normalize_email(sys.argv[1]), str(sys.argv[2])
    email = normalize_email(settings.SEED_ADMIN_EMAIL)
    password = (settings.SEED_ADMIN_PASSWORD or "").strip()
    if not email or not password:
        print(
            "Missing credentials: set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in the environment, "
            "or pass: python scripts/create_admin.py <email> <password>",
            file=sys.stderr,
        )
        return "", ""
    return email, password


def main() -> int:
    email, password = _resolve_credentials()
    if not email or not password:
        return 1

    init_db_with_retry(max_attempts=4, delay_sec=3.0)

    db = SessionLocal()
    try:
        ensure_platform_admin(db, email=email, password=password)
        print(f"User updated to admin successfully: {email}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
