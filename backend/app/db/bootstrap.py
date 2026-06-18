"""Database readiness for Render cold starts and transient SSL failures."""
from __future__ import annotations

import logging

from fastapi import HTTPException, Request, status

logger = logging.getLogger(__name__)


def bootstrap_database(app) -> bool:
    if getattr(app.state, "db_ready", False):
        return True
    from app.db.session import init_db_with_retry

    try:
        init_db_with_retry()
        app.state.db_ready = True
        logger.info("database bootstrap complete")
        return True
    except Exception as exc:
        app.state.db_ready = False
        logger.exception("database bootstrap failed: %s", exc)
        return False


def require_db_ready(request: Request) -> None:
    if bootstrap_database(request.app):
        return
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="قاعدة البيانات غير متاحة مؤقتاً. حاول بعد لحظات.",
    )
