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

from app.services.admin_seed import seed_production_admin


def main() -> int:
    try:
        ok = seed_production_admin(force_password_sync=True)
        return 0 if ok else 1
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
