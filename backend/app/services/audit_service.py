"""
Append-only audit log writer.

Use `record_audit()` from any handler that performs a privileged action.
Failures are swallowed (logged) so audit failures never break business flow.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.user import User

logger = logging.getLogger(__name__)


def record_audit(
    db: Session,
    *,
    actor: User | None,
    action: str,
    tenant_id: int | None = None,
    resource_type: str | None = None,
    resource_id: str | int | None = None,
    status: str = "success",
    ip_address: str | None = None,
    user_agent: str | None = None,
    metadata: dict[str, Any] | None = None,
    commit: bool = True,
) -> None:
    """Persist a single audit row.

    Returns silently on any DB error to avoid breaking the calling handler;
    the failure is still emitted to the application logger.
    """
    try:
        meta_json: str | None = None
        if metadata:
            try:
                meta_json = json.dumps(metadata, ensure_ascii=False, default=str)
            except (TypeError, ValueError):
                meta_json = None
        row = AuditLog(
            tenant_id=tenant_id if tenant_id is not None else (actor.tenant_id if actor else None),
            actor_user_id=actor.id if actor else None,
            actor_email=(actor.email if actor else None),
            actor_role=(actor.role if actor else None),
            action=str(action)[:96],
            resource_type=(str(resource_type)[:96] if resource_type else None),
            resource_id=(str(resource_id)[:96] if resource_id is not None else None),
            status=str(status)[:32],
            ip_address=(str(ip_address)[:64] if ip_address else None),
            user_agent=(str(user_agent)[:255] if user_agent else None),
            metadata_json=meta_json,
            created_at=datetime.utcnow(),
        )
        db.add(row)
        if commit:
            db.commit()
    except SQLAlchemyError:
        logger.exception("audit_log write failed action=%s", action)
        try:
            db.rollback()
        except Exception:
            pass
    except Exception:
        logger.exception("audit_log unexpected error action=%s", action)
