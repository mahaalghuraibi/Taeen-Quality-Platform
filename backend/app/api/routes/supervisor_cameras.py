from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.db.session import get_db
from app.models.camera import Camera
from app.models.monitoring_alert import MonitoringAlert
from app.models.user import User
from app.security.stream_url import validate_camera_stream_url
from app.schemas.supervisor_camera import (
    SupervisorAlertOut,
    SupervisorCameraCreate,
    SupervisorCameraOut,
    SupervisorCameraUpdate,
)

router = APIRouter(
    prefix="/supervisor",
    tags=["supervisor-cameras"],
    dependencies=[Depends(require_roles("supervisor", "admin"))],
)

_RIYADH = ZoneInfo("Asia/Riyadh")


def _riyadh_day_start_utc(d: date) -> datetime:
    start_local = datetime.combine(d, time.min, tzinfo=_RIYADH)
    return start_local.astimezone(timezone.utc).replace(tzinfo=None)


def _riyadh_day_end_exclusive_utc(d: date) -> datetime:
    return _riyadh_day_start_utc(d + timedelta(days=1))


def _ensure_supervisor_branch(current_user: User) -> None:
    if current_user.role == "supervisor" and current_user.branch_id is None:
        raise HTTPException(status_code=400, detail="لم يتم تحديد الفرع لهذا الحساب")


def _camera_to_out(camera: Camera) -> SupervisorCameraOut:
    return SupervisorCameraOut(
        id=camera.id,
        name=camera.name,
        location=camera.location,
        stream_url=camera.stream_url,
        is_connected=bool(camera.is_active),
        ai_enabled=bool(getattr(camera, "ai_enabled", False)),
        tenant_id=camera.tenant_id,
        last_analysis_at=getattr(camera, "last_analysis_at", None),
        analysis_mode="basic",
    )


def _alert_to_out(row: MonitoringAlert) -> SupervisorAlertOut:
    return SupervisorAlertOut(
        id=row.id,
        type=row.violation_type,
        label_ar=row.label_ar,
        details=row.reason_ar,
        branch=row.branch_name,
        location=row.location,
        camera_id=row.camera_id,
        camera_name=row.camera_name,
        confidence=float(row.confidence),
        created_at=row.created_at,
        status=row.status,
        resolved_at=row.resolved_at,
        resolved_by=row.resolved_by_name,
        image_data_url=row.image_data_url,
    )


@router.get("/cameras", response_model=list[SupervisorCameraOut])
def list_supervisor_cameras(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SupervisorCameraOut]:
    _ensure_supervisor_branch(current_user)
    rows = db.query(Camera).filter(Camera.tenant_id == current_user.tenant_id).order_by(Camera.id.desc()).all()
    return [_camera_to_out(c) for c in rows]


@router.post("/cameras", response_model=SupervisorCameraOut, status_code=status.HTTP_201_CREATED)
def create_supervisor_camera(
    payload: SupervisorCameraCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SupervisorCameraOut:
    _ensure_supervisor_branch(current_user)
    cam = Camera(
        name=payload.name.strip(),
        location=payload.location.strip(),
        stream_url=validate_camera_stream_url(payload.stream_url),
        is_active=bool(payload.is_connected),
        ai_enabled=bool(payload.ai_enabled),
        tenant_id=current_user.tenant_id,
    )
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return _camera_to_out(cam)


@router.patch("/cameras/{camera_id}", response_model=SupervisorCameraOut)
def update_supervisor_camera(
    camera_id: int,
    payload: SupervisorCameraUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SupervisorCameraOut:
    _ensure_supervisor_branch(current_user)
    cam = db.query(Camera).filter(Camera.id == camera_id, Camera.tenant_id == current_user.tenant_id).first()
    if cam is None:
        raise HTTPException(status_code=404, detail="الكاميرا غير موجودة")
    if payload.name is not None:
        cam.name = payload.name.strip()
    if payload.location is not None:
        cam.location = payload.location.strip()
    if payload.stream_url is not None:
        cam.stream_url = validate_camera_stream_url(payload.stream_url)
    if payload.is_connected is not None:
        cam.is_active = bool(payload.is_connected)
    if payload.ai_enabled is not None:
        cam.ai_enabled = bool(payload.ai_enabled)
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return _camera_to_out(cam)


@router.get("/alerts", response_model=list[SupervisorAlertOut])
def list_supervisor_alerts(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    limit: int = Query(default=80, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SupervisorAlertOut]:
    _ensure_supervisor_branch(current_user)
    q = (
        db.query(MonitoringAlert)
        .filter(MonitoringAlert.tenant_id == current_user.tenant_id)
        .order_by(MonitoringAlert.id.desc())
    )
    if current_user.role == "supervisor":
        q = q.filter(MonitoringAlert.branch_id == current_user.branch_id)
    if date_from is not None:
        q = q.filter(MonitoringAlert.created_at >= _riyadh_day_start_utc(date_from))
    if date_to is not None:
        q = q.filter(MonitoringAlert.created_at < _riyadh_day_end_exclusive_utc(date_to))
    rows = q.limit(limit).all()
    return [_alert_to_out(r) for r in rows]


_ALLOWED_STATUSES = {"open", "under_review", "resolved"}


@router.patch("/alerts/{alert_id}/status", response_model=SupervisorAlertOut)
def update_supervisor_alert_status(
    alert_id: int,
    new_status: str = Body(..., embed=True, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SupervisorAlertOut:
    """Set alert status to open / under_review / resolved."""
    _ensure_supervisor_branch(current_user)
    if new_status not in _ALLOWED_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"الحالة غير صالحة. القيم المسموحة: {', '.join(sorted(_ALLOWED_STATUSES))}",
        )
    row = (
        db.query(MonitoringAlert)
        .filter(MonitoringAlert.id == alert_id, MonitoringAlert.tenant_id == current_user.tenant_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="التنبيه غير موجود")
    if current_user.role == "supervisor" and row.branch_id != current_user.branch_id:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية لهذا التنبيه")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    row.status = new_status
    if new_status == "resolved":
        row.resolved_at = now
        row.resolved_by_id = current_user.id
        row.resolved_by_name = current_user.full_name or current_user.username or current_user.email
    elif new_status != "resolved":
        row.resolved_at = None
        row.resolved_by_id = None
        row.resolved_by_name = None
    db.add(row)
    db.commit()
    db.refresh(row)
    return _alert_to_out(row)


@router.patch("/alerts/{alert_id}/resolve", response_model=SupervisorAlertOut)
def resolve_supervisor_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SupervisorAlertOut:
    _ensure_supervisor_branch(current_user)
    row = (
        db.query(MonitoringAlert)
        .filter(MonitoringAlert.id == alert_id, MonitoringAlert.tenant_id == current_user.tenant_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="التنبيه غير موجود")
    if current_user.role == "supervisor" and row.branch_id != current_user.branch_id:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية لهذا التنبيه")
    if row.status != "open":
        return _alert_to_out(row)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    row.status = "resolved"
    row.resolved_at = now
    row.resolved_by_id = current_user.id
    row.resolved_by_name = current_user.full_name or current_user.username or current_user.email
    db.add(row)
    db.commit()
    db.refresh(row)
    return _alert_to_out(row)
