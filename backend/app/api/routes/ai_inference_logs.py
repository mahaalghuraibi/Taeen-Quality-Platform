"""
Read-only persistent AI inference log endpoint.

Confirmed-alert events are written to `ai_inference_logs` (one row per
*confirmed* violation, not per frame). Used for monthly accuracy reports
and dataset drift detection.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.db.session import get_db
from app.models.ai_inference_log import AIInferenceLog
from app.models.user import User

router = APIRouter(
    prefix="/admin/ai-logs",
    tags=["admin-ai-logs"],
    dependencies=[Depends(require_roles("admin", "supervisor"))],
)


@router.get("")
def list_ai_inference_logs(
    limit: int = Query(default=100, ge=1, le=500),
    days: int = Query(default=30, ge=1, le=365),
    violation_type: str | None = Query(default=None),
    camera_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    since = datetime.utcnow() - timedelta(days=days)
    q = (
        db.query(AIInferenceLog)
        .filter(AIInferenceLog.tenant_id == current_user.tenant_id)
        .filter(AIInferenceLog.created_at >= since)
    )
    if current_user.role == "supervisor" and current_user.branch_id is not None:
        q = q.filter(AIInferenceLog.branch_id == current_user.branch_id)
    if violation_type:
        q = q.filter(AIInferenceLog.violation_type == violation_type.strip()[:64])
    if camera_id is not None:
        q = q.filter(AIInferenceLog.camera_id == camera_id)
    rows = q.order_by(AIInferenceLog.id.desc()).limit(limit).all()
    return {
        "count": len(rows),
        "items": [
            {
                "id": r.id,
                "camera_id": r.camera_id,
                "camera_name": r.camera_name,
                "model_name": r.model_name,
                "model_version": r.model_version,
                "violation_type": r.violation_type,
                "person_index": r.person_index,
                "confidence": r.confidence,
                "smoothed_confidence": r.smoothed_confidence,
                "inference_latency_ms": r.inference_latency_ms,
                "priority": r.priority,
                "outcome": r.outcome,
                "alert_id": r.alert_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }
