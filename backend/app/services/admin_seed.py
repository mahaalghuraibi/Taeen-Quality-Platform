"""Idempotent platform admin bootstrap (SQLite + PostgreSQL)."""
from __future__ import annotations

import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User
from app.services.auth_service import hash_password, normalize_email, normalize_username, verify_password

logger = logging.getLogger(__name__)


def ensure_platform_admin(db: Session, *, email: str, password: str) -> bool:
    """Create or update admin user. Returns True if user exists/created."""
    safe_email = normalize_email(email)
    safe_password = (password or "").strip()
    if not safe_email or not safe_password:
        return False

    existing = db.query(User).filter(func.lower(User.email) == safe_email.lower()).first()
    if existing is None:
        base = normalize_username(safe_email.split("@")[0]) or "admin"
        username = base
        i = 2
        while db.query(User).filter(func.lower(User.username) == username.lower()).first() is not None:
            suffix = f"_{i}"
            username = f"{base[: max(1, 64 - len(suffix))]}{suffix}"
            i += 1
        db.add(
            User(
                email=safe_email,
                username=username,
                password=hash_password(safe_password),
                is_admin=True,
                role="admin",
                tenant_id=1,
                branch_id=1,
                branch_name="فرع تجريبي",
            )
        )
        db.commit()
        logger.info("Admin created: %s", safe_email)
        return True

    changed = False
    if existing.role != "admin":
        existing.role = "admin"
        changed = True
    if not existing.is_admin:
        existing.is_admin = True
        changed = True
    if existing.tenant_id is None:
        existing.tenant_id = 1
        changed = True
    if existing.branch_id is None:
        existing.branch_id = 1
        changed = True
    if not (existing.branch_name or "").strip():
        existing.branch_name = "فرع تجريبي"
        changed = True
    if not verify_password(safe_password, existing.password):
        existing.password = hash_password(safe_password)
        changed = True
    if changed:
        db.add(existing)
        db.commit()
        logger.info("Admin updated: %s", safe_email)
    return True


def ensure_seeded_admin_from_env() -> None:
    """Run on startup when SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are configured."""
    if settings.DATABASE_URL.startswith("sqlite"):
        return
    email = normalize_email(settings.SEED_ADMIN_EMAIL)
    password = (settings.SEED_ADMIN_PASSWORD or "").strip()
    if not email or not password:
        logger.warning("SEED_ADMIN_EMAIL/PASSWORD not set — skipping admin bootstrap")
        return

    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        ensure_platform_admin(db, email=email, password=password)
    finally:
        db.close()
