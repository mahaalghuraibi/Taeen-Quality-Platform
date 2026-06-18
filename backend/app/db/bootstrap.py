"""Database readiness for Render cold starts and transient SSL failures."""
from __future__ import annotations

import logging

from fastapi import HTTPException, Request, status

from app.core.config import sanitize_database_url_for_log, settings

logger = logging.getLogger(__name__)
_last_bootstrap_error: str | None = None


def bootstrap_database(app) -> bool:
    global _last_bootstrap_error
    if getattr(app.state, "db_ready", False):
        return True
    from app.db.session import init_db_with_retry

    try:
        init_db_with_retry(max_attempts=3, delay_sec=2.0)
        app.state.db_ready = True
        _last_bootstrap_error = None
        logger.info(
            "database bootstrap complete (runtime=%s bootstrap=%s)",
            sanitize_database_url_for_log(settings.DATABASE_URL),
            sanitize_database_url_for_log(settings.DATABASE_BOOTSTRAP_URL),
        )
        return True
    except Exception as exc:
        app.state.db_ready = False
        _last_bootstrap_error = f"{type(exc).__name__}: {exc}"
        app.state.db_last_error = _last_bootstrap_error
        logger.exception(
            "database bootstrap failed runtime=%s bootstrap=%s: %s",
            sanitize_database_url_for_log(settings.DATABASE_URL),
            sanitize_database_url_for_log(settings.DATABASE_BOOTSTRAP_URL),
            exc,
        )
        return False


def require_db_ready(request: Request) -> None:
    if bootstrap_database(request.app):
        return
    logger.error("login blocked — database not ready: %s", _last_bootstrap_error or "unknown")
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="قاعدة البيانات غير متاحة مؤقتاً. حاول بعد لحظات.",
    )
