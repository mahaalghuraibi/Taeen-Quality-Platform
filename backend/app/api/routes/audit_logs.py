"""
Read-only audit log endpoint (admin only).

Append-only writes happen via `app.services.audit_service.record_audit()`
called from any privileged handler. This route only exposes the trail.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.db.session import get_db
from app.models.audit_log import AuditLog
from app.models.user import User

router = APIRouter(
    prefix="/admin/audit",
    tags=["admin-audit"],
    dependencies=[Depends(require_roles("admin"))],
)


@router.get("/logs")
def list_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    days: int = Query(default=30, ge=1, le=365),
    action: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    since = datetime.utcnow() - timedelta(days=days)
    q = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == current_user.tenant_id)
        .filter(AuditLog.created_at >= since)
    )
    if action:
        q = q.filter(AuditLog.action == action.strip()[:96])
    rows = q.order_by(AuditLog.id.desc()).limit(limit).all()
    return {
        "count": len(rows),
        "items": [
            {
                "id": r.id,
                "action": r.action,
                "actor_email": r.actor_email,
                "actor_role": r.actor_role,
                "resource_type": r.resource_type,
                "resource_id": r.resource_id,
                "status": r.status,
                "ip_address": r.ip_address,
                "metadata": r.metadata_json,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }
