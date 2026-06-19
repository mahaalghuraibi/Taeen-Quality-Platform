"""Idempotent platform admin bootstrap (SQLite + PostgreSQL)."""
from __future__ import annotations

import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User
from app.services.auth_service import hash_password, normalize_email, normalize_username, verify_password

logger = logging.getLogger(__name__)


def _ensure_tenant_and_branch(db: Session) -> None:
    from app.models.branch import Branch
    from app.models.tenant import Tenant

    if db.query(Tenant).filter(Tenant.id == 1).first() is None:
        db.add(Tenant(id=1, name="Default Tenant"))
        db.commit()
    if db.query(Branch).filter(Branch.id == 1).first() is None:
        if db.query(Branch).filter(Branch.branch_name == "فرع تجريبي").first() is None:
            db.add(
                Branch(
                    id=1,
                    tenant_id=1,
                    branch_name="فرع تجريبي",
                    city="الرياض",
                    is_active=True,
                    created_by_name="system",
                )
            )
            db.commit()


def ensure_platform_admin(
    db: Session,
    *,
    email: str,
    password: str,
    force_password_sync: bool = False,
) -> bool:
    """Create or update admin user. Returns True if user exists/created."""
    safe_email = normalize_email(email)
    safe_password = (password or "").strip()
    if not safe_email or not safe_password:
        return False

    _ensure_tenant_and_branch(db)

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
        logger.info("Admin created: %s (username=%s)", safe_email, username)
        print(f"[seed_admin] created admin {safe_email} username={username}", flush=True)
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
    password_mismatch = not verify_password(safe_password, existing.password)
    if force_password_sync or password_mismatch:
        existing.password = hash_password(safe_password)
        changed = True
        if force_password_sync:
            logger.info("Admin password synced from SEED_ADMIN_PASSWORD: %s", safe_email)
            print(f"[seed_admin] password synced for {safe_email}", flush=True)
    if changed:
        db.add(existing)
        db.commit()
        logger.info("Admin updated: %s", safe_email)
        print(f"[seed_admin] updated admin {safe_email}", flush=True)
    else:
        logger.info("Admin already up to date: %s", safe_email)
        print(f"[seed_admin] admin ok {safe_email}", flush=True)
    return True


def seed_production_admin(*, force_password_sync: bool | None = None) -> bool:
    """
    Seed/update platform admin using the runtime DB connection (Supabase pooler).
    Called after schema bootstrap on startup and before auth.
    """
    if settings.DATABASE_URL.startswith("sqlite"):
        return False

    email = normalize_email(settings.SEED_ADMIN_EMAIL)
    password = (settings.SEED_ADMIN_PASSWORD or "").strip()
    if not email or not password:
        logger.error("SEED_ADMIN_EMAIL/PASSWORD not set — cannot seed admin")
        print("[seed_admin] SKIP — SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD missing", flush=True)
        return False

    sync = settings.is_production if force_password_sync is None else force_password_sync
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        ok = ensure_platform_admin(
            db,
            email=email,
            password=password,
            force_password_sync=sync,
        )
        return ok
    except Exception:
        logger.exception("seed_production_admin failed for %s", email)
        print(f"[seed_admin] FAILED for {email}", flush=True)
        raise
    finally:
        db.close()


def ensure_seeded_admin_from_env() -> None:
    """Backward-compatible alias — always uses runtime connection."""
    seed_production_admin()
