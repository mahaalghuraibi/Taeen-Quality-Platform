from collections.abc import Generator
import logging
import time

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import (
    database_host_from_url,
    is_supabase_url,
    sanitize_database_url_for_log,
    settings,
    supabase_bootstrap_url_candidates,
)

logger = logging.getLogger(__name__)

_bootstrap_engine = None
_bootstrap_session_factory = None


def _engine_kwargs(*, sslmode: str = "require", url: str | None = None) -> dict:
    db_url = url or settings.DATABASE_URL
    kwargs: dict = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }
    if db_url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    elif db_url.startswith("postgresql"):
        host_part = db_url.split("@", 1)[-1] if "@" in db_url else db_url
        is_local = any(x in host_part for x in ("localhost", "127.0.0.1"))
        connect_args: dict = {
            "connect_timeout": 20,
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 5,
        }
        if not is_local:
            connect_args["sslmode"] = sslmode
        kwargs["connect_args"] = connect_args
        if is_supabase_url(db_url):
            kwargs["poolclass"] = NullPool
        else:
            kwargs["pool_size"] = 5
            kwargs["max_overflow"] = 10
    return kwargs


def _rebuild_engine(*, sslmode: str = "require", url: str | None = None) -> None:
    global engine, SessionLocal
    # Runtime engine MUST always use settings.DATABASE_URL — never bootstrap/direct host.
    db_url = settings.DATABASE_URL if url is None else url
    if url is not None and url != settings.DATABASE_URL:
        logger.warning(
            "Ignoring non-runtime DB URL for engine rebuild; using DATABASE_URL host=%s",
            database_host_from_url(settings.DATABASE_URL),
        )
        db_url = settings.DATABASE_URL
    try:
        engine.dispose()
    except Exception:
        pass
    engine = create_engine(db_url, **_engine_kwargs(sslmode=sslmode, url=db_url))
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _get_bootstrap_engine(url: str | None = None):
    global _bootstrap_engine, _bootstrap_session_factory
    bootstrap_url = url or settings.DATABASE_BOOTSTRAP_URL
    if _bootstrap_engine is not None and url is None:
        return _bootstrap_engine, _bootstrap_session_factory
    if _bootstrap_engine is not None and url is not None:
        try:
            _bootstrap_engine.dispose()
        except Exception:
            pass
        _bootstrap_engine = None
        _bootstrap_session_factory = None
    logger.info(
        "Creating bootstrap DB engine for %s",
        sanitize_database_url_for_log(bootstrap_url),
    )
    _bootstrap_engine = create_engine(
        bootstrap_url,
        **_engine_kwargs(sslmode="require", url=bootstrap_url),
    )
    _bootstrap_session_factory = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=_bootstrap_engine,
    )
    return _bootstrap_engine, _bootstrap_session_factory


def _bootstrap_session() -> Session:
    _, factory = _get_bootstrap_engine()
    return factory()


_rebuild_engine(sslmode="require")
_runtime_log = sanitize_database_url_for_log(settings.DATABASE_URL)
_bootstrap_log = sanitize_database_url_for_log(settings.DATABASE_BOOTSTRAP_URL)
print(f"DATABASE_URL = {_runtime_log}", flush=True)
print(f"BOOTSTRAP_URL = {_bootstrap_log}", flush=True)
logger.info("Runtime DB target: %s", _runtime_log)
logger.info("Bootstrap DB target: %s", _bootstrap_log)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_database_connection() -> None:
    """Lightweight connectivity check — raises on failure."""
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        db.commit()
    finally:
        db.close()


def init_db() -> None:
    # Import models here to avoid circular imports during module initialization.
    from app.models import (  # noqa: F401
        admin_request,
        ai_inference_log,
        audit_log,
        branch,
        branch_request,
        camera,
        dish_record,
        meal_type,
        monitoring_alert,
        monitoring_zone_config,
        system_setting,
        tenant,
        user,
    )
    from app.db.base import Base

    bootstrap_engine, _ = _get_bootstrap_engine()
    Base.metadata.create_all(bind=bootstrap_engine)
    logger.info("Schema create_all completed on %s", sanitize_database_url_for_log(settings.DATABASE_BOOTSTRAP_URL))

    global SessionLocal
    _orig_session_local = SessionLocal

    def _session_for_migrations() -> Session:
        if settings.DATABASE_URL.startswith("sqlite"):
            return _orig_session_local()
        return _bootstrap_session()

    # Temporarily route migration helpers through bootstrap connection on Postgres/Supabase.
    SessionLocal = _session_for_migrations  # type: ignore[assignment]
    try:
        _drop_legacy_monitoring_tables()
        _ensure_camera_monitoring_columns()
        _ensure_user_is_admin_column()
        _ensure_user_profile_columns()
        _ensure_user_username_column()
        _ensure_user_assignment_columns()
        _ensure_dish_review_columns()
        _ensure_default_tenant()
        _seed_default_branches()
        _seed_meal_types()
        _seed_dev_admin_if_empty()
        _seed_default_supervisor()
        _ensure_required_login_accounts()
        from app.services.admin_seed import ensure_seeded_admin_from_env

        ensure_seeded_admin_from_env()
    finally:
        SessionLocal = _orig_session_local


def init_db_with_retry(*, max_attempts: int = 4, delay_sec: float = 2.0) -> None:
    """Retry schema bootstrap on bootstrap URL(s); runtime engine always stays on DATABASE_URL."""
    ssl_modes = ["require", "prefer"]
    bootstrap_urls = supabase_bootstrap_url_candidates(settings.DATABASE_URL)
    last_exc: Exception | None = None
    attempt = 0
    for bootstrap_url in bootstrap_urls:
        for sslmode in ssl_modes:
            attempt += 1
            global _bootstrap_engine, _bootstrap_session_factory
            _bootstrap_engine = None
            _bootstrap_session_factory = None
            try:
                _get_bootstrap_engine(bootstrap_url)
                init_db()
                # Verify connectivity on the RUNTIME pooler engine — never bootstrap/direct.
                _rebuild_engine(sslmode=sslmode)
                verify_database_connection()
                logger.info(
                    "init_db succeeded (bootstrap=%s runtime=%s sslmode=%s)",
                    sanitize_database_url_for_log(bootstrap_url),
                    sanitize_database_url_for_log(settings.DATABASE_URL),
                    sslmode,
                )
                return
            except Exception as exc:
                last_exc = exc
                logger.error(
                    "init_db failed (bootstrap=%s runtime=%s sslmode=%s): %s: %s",
                    sanitize_database_url_for_log(bootstrap_url),
                    sanitize_database_url_for_log(settings.DATABASE_URL),
                    sslmode,
                    type(exc).__name__,
                    exc,
                )
                if attempt < max_attempts * len(bootstrap_urls):
                    time.sleep(delay_sec)
    assert last_exc is not None
    raise last_exc
def _ensure_camera_monitoring_columns() -> None:
    """Add ai_enabled / last_analysis_at for camera 24/7 prep (SQLite-safe)."""
    if not settings.DATABASE_URL.startswith("sqlite"):
        return
    db = SessionLocal()
    try:
        cols = db.execute(text("PRAGMA table_info(cameras)")).all()
        col_names = {str(row[1]) for row in cols if len(row) > 1}
        if "ai_enabled" not in col_names:
            db.execute(text("ALTER TABLE cameras ADD COLUMN ai_enabled BOOLEAN NOT NULL DEFAULT 0"))
        if "last_analysis_at" not in col_names:
            db.execute(text("ALTER TABLE cameras ADD COLUMN last_analysis_at DATETIME"))
        db.commit()
    finally:
        db.close()


def _drop_legacy_monitoring_tables() -> None:
    """Remove obsolete monitoring AI tables if they exist (model layer no longer uses them)."""
    legacy = ("violations", "camera_alerts", "monitoring_logs")
    db = SessionLocal()
    try:
        for name in legacy:
            if settings.DATABASE_URL.startswith("sqlite"):
                db.execute(text(f"DROP TABLE IF EXISTS {name}"))
            else:
                db.execute(text(f"DROP TABLE IF EXISTS {name} CASCADE"))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("legacy table cleanup skipped: %s", exc)
    finally:
        db.close()


def _ensure_user_is_admin_column() -> None:
    """
    Lightweight SQLite-safe migration to add users.is_admin for existing local DBs.
    """
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    db = SessionLocal()
    try:
        cols = db.execute(text("PRAGMA table_info(users)")).all()
        col_names = {str(row[1]) for row in cols if len(row) > 1}
        if "is_admin" in col_names:
            return
        db.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"))
        db.commit()
    finally:
        db.close()


def _ensure_user_profile_columns() -> None:
    """Add full_name and avatar_url for staff profile (SQLite-safe)."""
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    db = SessionLocal()
    try:
        cols = db.execute(text("PRAGMA table_info(users)")).all()
        col_names = {str(row[1]) for row in cols if len(row) > 1}
        if "full_name" not in col_names:
            db.execute(text("ALTER TABLE users ADD COLUMN full_name VARCHAR(255)"))
        if "avatar_url" not in col_names:
            db.execute(text("ALTER TABLE users ADD COLUMN avatar_url TEXT"))
        db.commit()
    finally:
        db.close()


def _normalize_username(value: str) -> str:
    return value.strip().lower()


def _username_from_email(email: str) -> str:
    local = email.strip().lower().split("@")[0].strip()
    return local or "user"


def _ensure_user_username_column() -> None:
    """Add username and backfill existing rows from email prefix."""
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    db = SessionLocal()
    try:
        cols = db.execute(text("PRAGMA table_info(users)")).all()
        col_names = {str(row[1]) for row in cols if len(row) > 1}
        if "username" not in col_names:
            db.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR(64)"))
            db.commit()

        rows = db.execute(text("SELECT id, email, COALESCE(username, '') AS username FROM users ORDER BY id ASC")).all()
        used: set[str] = set()
        updates: list[tuple[str, int]] = []
        for row in rows:
            user_id = int(row[0])
            email = str(row[1] or "")
            raw_existing = _normalize_username(str(row[2] or ""))
            raw = raw_existing or _username_from_email(email)
            base = (raw or "user")[:64]
            candidate = base
            i = 2
            while candidate in used:
                suffix = f"_{i}"
                candidate = f"{base[: max(1, 64 - len(suffix))]}{suffix}"
                i += 1
            used.add(candidate)
            if raw_existing != candidate:
                updates.append((candidate, user_id))
        for uname, user_id in updates:
            db.execute(text("UPDATE users SET username = :uname WHERE id = :uid"), {"uname": uname, "uid": user_id})
        if updates:
            db.commit()
        db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users(username)"))
        db.commit()
    finally:
        db.close()


def _ensure_dish_review_columns() -> None:
    """Add supervisor review lifecycle fields to dish_records (SQLite-safe)."""
    if not settings.DATABASE_URL.startswith("sqlite"):
        return
    db = SessionLocal()
    try:
        cols = db.execute(text("PRAGMA table_info(dish_records)")).all()
        col_names = {str(row[1]) for row in cols if len(row) > 1}
        if "needs_review" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT 0"))
        if "status" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending_review'"))
        if "reviewed_by_id" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN reviewed_by_id INTEGER"))
        if "reviewed_by_name" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN reviewed_by_name VARCHAR(255)"))
        if "reviewed_at" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN reviewed_at DATETIME"))
        if "rejected_reason" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN rejected_reason TEXT"))
        if "supervisor_notes" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN supervisor_notes TEXT"))
        if "ai_suggestions" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN ai_suggestions TEXT"))
        if "ai_confidence" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN ai_confidence FLOAT"))
        if "employee_id" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN employee_id INTEGER"))
        if "employee_name" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN employee_name VARCHAR(255)"))
        if "employee_email" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN employee_email VARCHAR(255)"))
        if "branch_id" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN branch_id INTEGER"))
        if "branch_name" not in col_names:
            db.execute(text("ALTER TABLE dish_records ADD COLUMN branch_name VARCHAR(255)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_dish_records_status ON dish_records(status)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_dish_records_reviewed_by_id ON dish_records(reviewed_by_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_dish_records_employee_id ON dish_records(employee_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_dish_records_branch_id ON dish_records(branch_id)"))
        db.execute(
            text(
                "UPDATE dish_records "
                "SET employee_id = COALESCE(employee_id, user_id), "
                "employee_name = COALESCE(NULLIF(employee_name, ''), "
                "(SELECT COALESCE(NULLIF(u.full_name, ''), NULLIF(u.username, ''), u.email) FROM users u WHERE u.id = dish_records.user_id)), "
                "employee_email = COALESCE(NULLIF(employee_email, ''), "
                "(SELECT u.email FROM users u WHERE u.id = dish_records.user_id)), "
                "branch_id = COALESCE(branch_id, (SELECT u.branch_id FROM users u WHERE u.id = dish_records.user_id), 1), "
                "branch_name = COALESCE(NULLIF(branch_name, ''), "
                "(SELECT COALESCE(NULLIF(u.branch_name, ''), 'فرع تجريبي') FROM users u WHERE u.id = dish_records.user_id), 'فرع تجريبي')"
            )
        )
        db.commit()
    finally:
        db.close()


def _ensure_user_assignment_columns() -> None:
    """Add organization/branch/supervisor columns and backfill defaults."""
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    from app.models.user import User

    db = SessionLocal()
    try:
        cols = db.execute(text("PRAGMA table_info(users)")).all()
        col_names = {str(row[1]) for row in cols if len(row) > 1}
        if "organization_name" not in col_names:
            db.execute(text("ALTER TABLE users ADD COLUMN organization_name VARCHAR(255)"))
        if "branch_id" not in col_names:
            db.execute(text("ALTER TABLE users ADD COLUMN branch_id INTEGER"))
        if "branch_name" not in col_names:
            db.execute(text("ALTER TABLE users ADD COLUMN branch_name VARCHAR(255)"))
        if "supervisor_id" not in col_names:
            db.execute(text("ALTER TABLE users ADD COLUMN supervisor_id INTEGER"))
        if "supervisor_name" not in col_names:
            db.execute(text("ALTER TABLE users ADD COLUMN supervisor_name VARCHAR(255)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_users_supervisor_id ON users(supervisor_id)"))
        db.commit()

        default_supervisor = db.query(User).filter(User.role == "supervisor").order_by(User.id.asc()).first()
        users = db.query(User).order_by(User.id.asc()).all()
        changed = False
        for u in users:
            if u.branch_id is None:
                u.branch_id = 1
                changed = True
            if not (u.branch_name or "").strip():
                u.branch_name = "فرع تجريبي"
                changed = True
            if u.role == "staff" and u.supervisor_id is None:
                same_branch_supervisor = (
                    db.query(User)
                    .filter(
                        User.role == "supervisor",
                        User.tenant_id == u.tenant_id,
                        User.branch_id == u.branch_id,
                    )
                    .order_by(User.id.asc())
                    .first()
                )
                chosen_supervisor = same_branch_supervisor or default_supervisor
                if chosen_supervisor is not None:
                    u.supervisor_id = chosen_supervisor.id
                    u.supervisor_name = (
                        chosen_supervisor.full_name or chosen_supervisor.username or chosen_supervisor.email
                    )
                    changed = True
            if u.role in {"supervisor", "admin"} and u.supervisor_id is not None:
                u.supervisor_id = None
                changed = True
            if u.role == "staff" and not (u.supervisor_name or "").strip() and u.supervisor_id is not None:
                sup = db.query(User).filter(User.id == u.supervisor_id).first()
                if sup is not None:
                    u.supervisor_name = sup.full_name or sup.username or sup.email
                    changed = True
        if changed:
            db.add_all(users)
            db.commit()
    finally:
        db.close()


def _seed_default_branches() -> None:
    """Seed initial branches matching the legacy hardcoded list (id 1/2/3).

    Idempotent on every startup — runs on both SQLite (dev) and PostgreSQL (prod).
    Existing rows with the same id are left untouched so admin edits persist.
    """
    from app.models.branch import Branch

    defaults = [
        (1, "فرع تجريبي", "الرياض"),
        (2, "فرع الرياض", "الرياض"),
        (3, "فرع جدة", "جدة"),
    ]

    db = SessionLocal()
    try:
        for branch_id, name, city in defaults:
            existing = db.query(Branch).filter(Branch.id == branch_id).first()
            if existing is not None:
                continue
            # Skip if a branch with the same name already exists under another id.
            if db.query(Branch).filter(Branch.branch_name == name).first() is not None:
                continue
            db.add(
                Branch(
                    id=branch_id,
                    tenant_id=1,
                    branch_name=name,
                    city=city,
                    is_active=True,
                    created_by_name="system",
                )
            )
        db.commit()
        _sync_branches_id_sequence(db)
    finally:
        db.close()


def _sync_branches_id_sequence(db: Session) -> None:
    """After seeding explicit branch ids (1/2/3), bump the PostgreSQL sequence.

    Without this, the next INSERT without an explicit id can reuse id=1 and raise
    IntegrityError — the approval endpoint then returns 500 even though the
  request row may look stuck in pending.
    """
    if settings.DATABASE_URL.startswith("sqlite"):
        return
    try:
        db.execute(
            text(
                "SELECT setval("
                "pg_get_serial_sequence('branches', 'id'), "
                "COALESCE((SELECT MAX(id) FROM branches), 1), "
                "true)"
            )
        )
        db.commit()
    except Exception:
        db.rollback()


def _ensure_default_tenant() -> None:
    """Ensure tenant id=1 exists so local bootstrap (admin + tenant_id=1) works."""
    from app.models.tenant import Tenant

    db = SessionLocal()
    try:
        if db.query(Tenant).filter(Tenant.id == 1).first() is not None:
            return
        name = "Default Tenant"
        if db.query(Tenant).filter(Tenant.name == name).first() is not None:
            name = "SKA Default Tenant (id=1)"
        db.add(Tenant(id=1, name=name))
        db.commit()
    finally:
        db.close()


def _seed_dev_admin_if_empty() -> None:
    if not settings.DATABASE_URL.startswith("sqlite") or not settings.SEED_DEV_ADMIN:
        return

    from app.models.tenant import Tenant
    from app.models.user import User
    from app.services.auth_service import hash_password, normalize_email, normalize_username, verify_password

    db = SessionLocal()
    try:
        if db.query(Tenant).filter(Tenant.id == 1).first() is None:
            return
        email = normalize_email(settings.SEED_ADMIN_EMAIL)
        existing = db.query(User).filter(User.email == email).first()
        if existing is None:
            base = normalize_username(email.split("@")[0]) or "admin"
            username = base
            i = 2
            while db.query(User).filter(User.username == username).first() is not None:
                suffix = f"_{i}"
                username = f"{base[: max(1, 64 - len(suffix))]}{suffix}"
                i += 1
            db.add(
                User(
                    email=email,
                    username=username,
                    password=hash_password(settings.SEED_ADMIN_PASSWORD),
                    is_admin=True,
                    role="admin",
                    tenant_id=1,
                    branch_id=1,
                    branch_name="فرع تجريبي",
                )
            )
            db.commit()
            return
        changed = False
        if existing.role != "admin":
            existing.role = "admin"
            changed = True
        if not existing.is_admin:
            existing.is_admin = True
            changed = True
        if not (existing.branch_name or "").strip():
            existing.branch_name = "فرع تجريبي"
            changed = True
        if existing.branch_id is None:
            existing.branch_id = 1
            changed = True
        # Keep dev credentials predictable for recovery.
        if not verify_password(settings.SEED_ADMIN_PASSWORD, existing.password):
            existing.password = hash_password(settings.SEED_ADMIN_PASSWORD)
            changed = True
        if changed:
            db.add(existing)
            db.commit()
    finally:
        db.close()


def _seed_default_supervisor() -> None:
    """Ensure a default supervisor exists for local/dev login checks."""
    if not settings.DATABASE_URL.startswith("sqlite") or not settings.SEED_DEV_SUPERVISOR:
        return

    from app.models.tenant import Tenant
    from app.models.user import User
    from app.services.auth_service import hash_password, normalize_email, normalize_username, verify_password

    db = SessionLocal()
    try:
        if db.query(Tenant).filter(Tenant.id == 1).first() is None:
            return

        def ensure_supervisor(email_raw: str, preferred_username: str) -> None:
            email = normalize_email(email_raw)
            if not email:
                return
            existing = db.query(User).filter(User.email == email).first()
            if existing is not None:
                changed = False
                if existing.role != "supervisor":
                    existing.role = "supervisor"
                    changed = True
                if not existing.username:
                    existing.username = normalize_username(preferred_username) or email.split("@")[0]
                    changed = True
                if not (existing.branch_name or "").strip():
                    existing.branch_name = "فرع تجريبي"
                    changed = True
                if existing.branch_id is None:
                    existing.branch_id = 1
                    changed = True
                if not verify_password(settings.SEED_SUPERVISOR_PASSWORD, existing.password):
                    existing.password = hash_password(settings.SEED_SUPERVISOR_PASSWORD)
                    changed = True
                if changed:
                    db.add(existing)
                    db.commit()
                return

            username_base = normalize_username(preferred_username) or email.split("@")[0]
            username = username_base
            i = 2
            while db.query(User).filter(User.username == username).first() is not None:
                suffix = f"_{i}"
                username = f"{username_base[: max(1, 64 - len(suffix))]}{suffix}"
                i += 1
            db.add(
                User(
                    email=email,
                    username=username,
                    password=hash_password(settings.SEED_SUPERVISOR_PASSWORD),
                    is_admin=False,
                    role="supervisor",
                    tenant_id=1,
                    full_name="Supervisor",
                    branch_id=1,
                    branch_name="فرع تجريبي",
                )
            )
            db.commit()

        ensure_supervisor(settings.SEED_SUPERVISOR_EMAIL, settings.SEED_SUPERVISOR_USERNAME)
        ensure_supervisor(settings.SEED_SUPERVISOR_EMAIL_ALT, settings.SEED_SUPERVISOR_USERNAME)
        ensure_supervisor(settings.SEED_SUPERVISOR_EMAIL_ALT2, settings.SEED_SUPERVISOR_USERNAME)

        default_supervisor = db.query(User).filter(User.role == "supervisor").order_by(User.id.asc()).first()
        if default_supervisor is not None:
            staff_without_supervisor = (
                db.query(User)
                .filter(User.role == "staff", User.supervisor_id.is_(None))
                .all()
            )
            changed = False
            for staff in staff_without_supervisor:
                staff.supervisor_id = default_supervisor.id
                staff.supervisor_name = default_supervisor.full_name or default_supervisor.username or default_supervisor.email
                if staff.branch_id is None:
                    staff.branch_id = 1
                if not (staff.branch_name or "").strip():
                    staff.branch_name = "فرع تجريبي"
                changed = True
            if changed:
                db.add_all(staff_without_supervisor)
                db.commit()
    finally:
        db.close()


def _seed_meal_types() -> None:
    from app.models.meal_type import MealType

    defaults = [
        ("كبسة دجاج", "main", "kabsa chicken, chicken kabsa, كبسة"),
        ("كبسة لحم", "main", "kabsa meat, lamb kabsa"),
        ("مندي", "main", "mandi"),
        ("برياني", "main", "biryani"),
        ("دجاج مشوي", "main", "grilled chicken, roasted chicken"),
        ("مكرونة", "main", "pasta, macaroni"),
        ("رز", "side", "rice, arroz"),
        ("سلطة", "side", "salad, tomato, cucumber, lettuce"),
        ("سلطة فواكه", "side", "fruit salad, banana, apple, orange"),
        ("شوربة", "side", "soup"),
        ("خبز", "side", "bread, naan"),
        ("سمك", "main", "fish, pescado"),
        ("كباب", "main", "kebab, kabab, kofta, مشاوي, كفتة"),
        ("لحم", "main", "meat, lamb, beef, carne"),
        ("دجاج", "main", "chicken, pollo"),
        ("إيدام", "main", "stew, curry, salona, edam, idam, مرق"),
        ("وجبة مختلطة", "main", "mixed meal"),
    ]

    db = SessionLocal()
    try:
        existing = {name for (name,) in db.query(MealType.name_ar).all()}
        to_add = [
            MealType(name_ar=name_ar, category=category, aliases=aliases, is_active=True)
            for (name_ar, category, aliases) in defaults
            if name_ar not in existing
        ]
        if not to_add:
            return
        db.add_all(to_add)
        db.commit()
    finally:
        db.close()


def _ensure_required_login_accounts() -> None:
    """Ensure mandatory recovery/test accounts exist with expected credentials."""
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    from app.models.user import User
    from app.services.auth_service import hash_password, normalize_email, verify_password

    required = [
        ("xhoor2000@outlook.com", "xhoor2000", "supervisor", "123456", False),
        ("xjo21000@gmail.com", "supervisor", "supervisor", "123456", False),
        ("admin@test.com", "admin", "admin", "admin123", True),
    ]

    db = SessionLocal()
    try:
        for email_raw, username_base, role, password, is_admin in required:
            email = normalize_email(email_raw)
            user = db.query(User).filter(User.email == email).first()
            if user is None:
                username = username_base
                i = 2
                while db.query(User).filter(User.username == username).first() is not None:
                    suffix = f"_{i}"
                    username = f"{username_base[: max(1, 64 - len(suffix))]}{suffix}"
                    i += 1
                user = User(
                    email=email,
                    username=username,
                    password=hash_password(password),
                    is_admin=is_admin,
                    role=role,
                    tenant_id=1,
                    full_name="Supervisor" if role == "supervisor" else None,
                    branch_id=1,
                    branch_name="فرع تجريبي",
                )
                db.add(user)
                db.commit()
                continue

            changed = False
            if user.role != role:
                user.role = role
                changed = True
            if bool(user.is_admin) != bool(is_admin):
                user.is_admin = bool(is_admin)
                changed = True
            if user.branch_id is None:
                user.branch_id = 1
                changed = True
            if not (user.branch_name or "").strip():
                user.branch_name = "فرع تجريبي"
                changed = True
            if not verify_password(password, user.password):
                user.password = hash_password(password)
                changed = True
            if changed:
                db.add(user)
                db.commit()
    finally:
        db.close()
