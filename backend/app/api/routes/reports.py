"""Reporting API — aggregates real supervisor/monitoring data (no mock payloads)."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.core.limiter import limiter
from app.db.session import get_db
from app.models.monitoring_alert import MonitoringAlert
from app.models.user import User

router = APIRouter(
    prefix="/reports",
    tags=["reports"],
    dependencies=[Depends(require_roles("supervisor", "admin"))],
)

_RIYADH = ZoneInfo("Asia/Riyadh")


def _riyadh_day_window_utc() -> tuple[datetime, datetime]:
    now_riyadh = datetime.now(_RIYADH)
    day_start = now_riyadh.replace(hour=0, minute=0, second=0, microsecond=0)
    next_day = day_start + timedelta(days=1)
    return (
        day_start.astimezone(timezone.utc).replace(tzinfo=None),
        next_day.astimezone(timezone.utc).replace(tzinfo=None),
    )


@router.get("/quality-summary")
@limiter.limit("120/minute")
def quality_summary(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Executive KPI snapshot from real monitoring alerts (tenant-scoped)."""
    tenant_id = current_user.tenant_id
    day_start_utc, next_day_utc = _riyadh_day_window_utc()

    alert_q = db.query(MonitoringAlert).filter(MonitoringAlert.tenant_id == tenant_id)
    if current_user.role == "supervisor" and current_user.branch_id is not None:
        alert_q = alert_q.filter(MonitoringAlert.branch_id == current_user.branch_id)

    open_violations = alert_q.filter(MonitoringAlert.status != "resolved").count()
    alerts_today = alert_q.filter(
        MonitoringAlert.created_at >= day_start_utc,
        MonitoringAlert.created_at < next_day_utc,
    ).count()

    top_type_row = (
        db.query(MonitoringAlert.violation_type, func.count(MonitoringAlert.id).label("cnt"))
        .filter(MonitoringAlert.tenant_id == tenant_id)
        .group_by(MonitoringAlert.violation_type)
        .order_by(func.count(MonitoringAlert.id).desc())
        .first()
    )

    return {
        "compliance_rate": None,
        "open_violations": open_violations,
        "alerts_count": open_violations,
        "alerts_today": alerts_today,
        "most_repeated_violation": top_type_row[0] if top_type_row else None,
        "branch_name": current_user.branch_name,
        "is_mock": False,
        "timezone": "Asia/Riyadh",
    }


@router.get("/violations-summary")
@limiter.limit("60/minute")
def violations_summary(
    request: Request,
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Violation counts grouped by type for the reports hub (real DB only)."""
    tenant_id = current_user.tenant_id
    q = db.query(MonitoringAlert).filter(MonitoringAlert.tenant_id == tenant_id)
    if current_user.role == "supervisor" and current_user.branch_id is not None:
        q = q.filter(MonitoringAlert.branch_id == current_user.branch_id)

    rows = (
        db.query(MonitoringAlert.violation_type, func.count(MonitoringAlert.id))
        .filter(MonitoringAlert.tenant_id == tenant_id)
        .group_by(MonitoringAlert.violation_type)
        .all()
    )
    by_type = {str(t or "unknown"): int(c) for t, c in rows}
    total = sum(by_type.values())
    return {
        "total": total,
        "by_type": by_type,
        "date_from": date_from,
        "date_to": date_to,
        "is_mock": False,
    }
