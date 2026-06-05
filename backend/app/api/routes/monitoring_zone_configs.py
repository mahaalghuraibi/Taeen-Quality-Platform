"""REST API for per-zone CCTV configuration (PostgreSQL-backed)."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.constants.monitoring_zones import MONITORING_ZONE_IDS
from app.db.session import get_db
from app.models.monitoring_zone_config import MonitoringZoneConfig
from app.models.user import User
from app.schemas.monitoring_zone_config import (
    LegacyZoneImportIn,
    MonitoringZoneConfigListOut,
    MonitoringZoneConfigOut,
    MonitoringZoneConfigUpsert,
    MonitoringZoneConnectionTest,
)
from app.services.monitoring_zone_service import (
    apply_upsert_fields,
    merge_zone_configs,
    resolve_branch_scope,
    zone_row_to_api_dict,
)

router = APIRouter(
    prefix="/supervisor",
    tags=["monitoring-zone-configs"],
    dependencies=[Depends(require_roles("supervisor", "admin"))],
)


def _branch_scope(user: User) -> int:
    if user.role == "supervisor" and user.branch_id is None:
        raise HTTPException(status_code=400, detail="لم يتم تحديد الفرع لهذا الحساب")
    return resolve_branch_scope(user.branch_id)


def _get_zone_row(
    db: Session,
    *,
    tenant_id: int,
    branch_id: int,
    zone_id: str,
) -> MonitoringZoneConfig | None:
    if zone_id not in MONITORING_ZONE_IDS:
        raise HTTPException(status_code=400, detail=f"معرّف المنطقة غير صالح: {zone_id}")
    return (
        db.query(MonitoringZoneConfig)
        .filter(
            MonitoringZoneConfig.tenant_id == tenant_id,
            MonitoringZoneConfig.branch_id == branch_id,
            MonitoringZoneConfig.zone_id == zone_id,
        )
        .first()
    )


@router.get("/zone-configs", response_model=MonitoringZoneConfigListOut)
def list_zone_configs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MonitoringZoneConfigListOut:
    branch_id = _branch_scope(current_user)
    rows = (
        db.query(MonitoringZoneConfig)
        .filter(
            MonitoringZoneConfig.tenant_id == current_user.tenant_id,
            MonitoringZoneConfig.branch_id == branch_id,
        )
        .all()
    )
    zones = [MonitoringZoneConfigOut(**z) for z in merge_zone_configs(rows)]
    return MonitoringZoneConfigListOut(
        tenant_id=current_user.tenant_id,
        branch_id=branch_id,
        zones=zones,
    )


@router.put("/zone-configs/{zone_id}", response_model=MonitoringZoneConfigOut)
def upsert_zone_config(
    zone_id: str,
    payload: MonitoringZoneConfigUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MonitoringZoneConfigOut:
    if zone_id not in MONITORING_ZONE_IDS:
        raise HTTPException(status_code=400, detail=f"معرّف المنطقة غير صالح: {zone_id}")

    branch_id = _branch_scope(current_user)
    now = datetime.utcnow()
    row = _get_zone_row(
        db,
        tenant_id=current_user.tenant_id,
        branch_id=branch_id,
        zone_id=zone_id,
    )

    if row is None:
        row = MonitoringZoneConfig(
            tenant_id=current_user.tenant_id,
            branch_id=branch_id,
            zone_id=zone_id,
            camera_name=payload.camera_name,
            created_at=now,
        )
        db.add(row)

    apply_upsert_fields(
        row,
        camera_name=payload.camera_name,
        connection_type=payload.connection_type,
        ip_address=payload.ip_address,
        port=payload.port,
        username=payload.username,
        password_plain=payload.password,
        clear_password=payload.clear_password,
        stream_path=payload.stream_path,
        rtsp_url_plain=payload.rtsp_url,
        linked_camera_id=payload.linked_camera_id,
        updated_by_id=current_user.id,
        now=now,
    )

    db.commit()
    db.refresh(row)
    return MonitoringZoneConfigOut(**zone_row_to_api_dict(row, zone_id))


@router.patch(
    "/zone-configs/{zone_id}/connection-test",
    response_model=MonitoringZoneConfigOut,
)
def patch_zone_connection_test(
    zone_id: str,
    payload: MonitoringZoneConnectionTest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MonitoringZoneConfigOut:
    branch_id = _branch_scope(current_user)
    row = _get_zone_row(
        db,
        tenant_id=current_user.tenant_id,
        branch_id=branch_id,
        zone_id=zone_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="لم يُحفظ إعداد المنطقة بعد")

    row.last_connection_test_ok = payload.ok
    row.last_connection_test_at = payload.tested_at or datetime.utcnow()
    row.updated_at = datetime.utcnow()
    row.updated_by_id = current_user.id
    db.commit()
    db.refresh(row)
    return MonitoringZoneConfigOut(**zone_row_to_api_dict(row, zone_id))


def _decode_legacy_password(item) -> str | None:
    if item.password and str(item.password).strip():
        return str(item.password).strip()
    enc = getattr(item, "password_enc", None)
    if not enc:
        return None
    try:
        import base64

        return base64.b64decode(str(enc)).decode("utf-8")
    except Exception:
        return None


@router.post("/zone-configs/import-legacy", response_model=MonitoringZoneConfigListOut)
def import_legacy_zone_configs(
    payload: LegacyZoneImportIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MonitoringZoneConfigListOut:
    """One-time import from browser localStorage shape (ska_restaurant_camera_configs_v1)."""
    branch_id = _branch_scope(current_user)
    now = datetime.utcnow()

    for zone_id, item in payload.configs.items():
        if zone_id not in MONITORING_ZONE_IDS:
            continue
        existing = _get_zone_row(
            db,
            tenant_id=current_user.tenant_id,
            branch_id=branch_id,
            zone_id=zone_id,
        )
        if existing is not None:
            continue

        camera_name = (item.camera_name or "").strip()
        if not camera_name:
            continue

        row = MonitoringZoneConfig(
            tenant_id=current_user.tenant_id,
            branch_id=branch_id,
            zone_id=zone_id,
            camera_name=camera_name,
            created_at=now,
        )
        db.add(row)
        apply_upsert_fields(
            row,
            camera_name=camera_name,
            connection_type=item.connection_type or "ip_camera",
            ip_address=item.ip_address,
            port=item.port or 554,
            username=item.username,
            password_plain=_decode_legacy_password(item),
            clear_password=False,
            stream_path=item.stream_path or "/stream1",
            rtsp_url_plain=item.rtsp_url,
            linked_camera_id=None,
            updated_by_id=current_user.id,
            now=now,
        )
    db.commit()
    rows = (
        db.query(MonitoringZoneConfig)
        .filter(
            MonitoringZoneConfig.tenant_id == current_user.tenant_id,
            MonitoringZoneConfig.branch_id == branch_id,
        )
        .all()
    )
    zones = [MonitoringZoneConfigOut(**z) for z in merge_zone_configs(rows)]
    return MonitoringZoneConfigListOut(
        tenant_id=current_user.tenant_id,
        branch_id=branch_id,
        zones=zones,
    )
