"""Ingestion endpoint for the on-prem Local AI Agent (RTSP + YOLO).

The agent runs YOLO inside the restaurant LAN and pushes only structured
alerts + evidence snapshots here. Authentication is a shared secret
(`AGENT_API_KEY`) sent in the `X-Agent-Key` header — no JWT/user session.
RTSP URLs and camera credentials never leave the local network.
"""

from __future__ import annotations

import hmac
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.limiter import limiter
from app.db.session import get_db
from app.models.camera import Camera
from app.models.monitoring_alert import MonitoringAlert
from app.schemas.local_agent import (
    LocalAgentAlertBatch,
    LocalAgentAlertResponse,
    LocalAgentAlertResult,
    LocalAgentPingResponse,
)
from app.services.agent_evidence_storage import store_agent_evidence

router = APIRouter(prefix="/local-agent", tags=["local-agent"])

logger = logging.getLogger(__name__)

# Canonical Arabic labels for both YOLO models (PPE/person + environment/place).
_VIOLATION_LABELS_AR: dict[str, str] = {
    # PPE / person
    "no_gloves": "عدم ارتداء القفازات",
    "no_mask": "عدم ارتداء الكمامة",
    "no_headcover": "عدم ارتداء غطاء الرأس / قبعة الشيف",
    "no_haircover": "عدم ارتداء غطاء الشعر",
    "improper_uniform": "عدم ارتداء الزي الرسمي",
    # Environment / place
    "wet_floor": "أرضية مبللة",
    "trash_on_floor": "نفايات على الأرض",
    "unclean_area": "منطقة غير نظيفة",
    "blocked_path": "ممر مسدود",
    "unsafe_area": "منطقة غير آمنة",
}


def _label_for(violation_type: str, provided: str | None) -> str:
    if provided and provided.strip():
        return provided.strip()
    return _VIOLATION_LABELS_AR.get(violation_type, violation_type)


def require_agent_key(x_agent_key: str | None = Header(default=None)) -> None:
    """Reject any request without a valid agent API key (constant-time compare)."""
    configured = (settings.AGENT_API_KEY or "").strip()
    if not configured:
        # Endpoint is disabled until an AGENT_API_KEY is provisioned on the backend.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="خدمة الوكيل المحلي غير مُفعّلة على الخادم.",
        )
    supplied = (x_agent_key or "").strip()
    if not supplied or not hmac.compare_digest(supplied, configured):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="مفتاح الوكيل غير صالح.",
        )


def _resolve_camera(db: Session, camera_id: int | None) -> Camera | None:
    if camera_id is None:
        return None
    return db.query(Camera).filter(Camera.id == camera_id).first()


def _has_recent_duplicate(
    db: Session,
    *,
    tenant_id: int,
    camera_id: int | None,
    violation_type: str,
    since: datetime,
) -> bool:
    q = db.query(MonitoringAlert.id).filter(
        MonitoringAlert.tenant_id == tenant_id,
        MonitoringAlert.violation_type == violation_type,
        MonitoringAlert.created_at >= since,
    )
    if camera_id is not None:
        q = q.filter(MonitoringAlert.camera_id == camera_id)
    return q.first() is not None


@router.get("/ping", response_model=LocalAgentPingResponse)
def agent_ping(_: None = Depends(require_agent_key)) -> LocalAgentPingResponse:
    """Connectivity + key check for `agent.py --test-backend`."""
    return LocalAgentPingResponse(
        ok=True,
        message="الوكيل المحلي متصل بالخادم بنجاح.",
        server_time=datetime.now(timezone.utc),
    )


@router.post("/alerts", response_model=LocalAgentAlertResponse)
@limiter.limit("120/minute")
def ingest_agent_alerts(
    request: Request,
    payload: LocalAgentAlertBatch,
    db: Session = Depends(get_db),
    _: None = Depends(require_agent_key),
) -> LocalAgentAlertResponse:
    """Store violations detected by the local agent into monitoring_alerts."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    cooldown = int(getattr(settings, "AGENT_ALERT_COOLDOWN_SECONDS", 60) or 60)
    cutoff = now - timedelta(seconds=cooldown)

    results: list[LocalAgentAlertResult] = []
    created = duplicates = rejected = 0
    # Dedup within a single batch as well (same camera+type appearing twice).
    seen_in_batch: set[tuple[str, int | None]] = set()

    for v in payload.violations:
        vtype = (v.violation_type or "").strip()
        cam = _resolve_camera(db, v.camera_id)
        # Tenant is derived server-side from the camera; defaults to the primary tenant.
        tenant_id = cam.tenant_id if cam is not None else 1
        branch_id = v.branch_id if v.branch_id is not None else payload.branch_id
        cam_name = (v.camera_name or "").strip() or (cam.name if cam else None)
        location = (v.location or "").strip() or (cam.location if cam else None)
        if v.zone_id and not location:
            location = v.zone_id

        if not vtype:
            rejected += 1
            results.append(
                LocalAgentAlertResult(
                    violation_type="", camera_id=v.camera_id, zone_id=v.zone_id,
                    accepted=False, reason="نوع المخالفة مفقود",
                )
            )
            continue

        batch_key = (vtype, v.camera_id)
        if batch_key in seen_in_batch:
            duplicates += 1
            results.append(
                LocalAgentAlertResult(
                    violation_type=vtype, camera_id=v.camera_id, zone_id=v.zone_id,
                    accepted=False, reason="مكرر داخل نفس الدفعة",
                )
            )
            continue

        if _has_recent_duplicate(
            db, tenant_id=tenant_id, camera_id=v.camera_id, violation_type=vtype, since=cutoff
        ):
            duplicates += 1
            results.append(
                LocalAgentAlertResult(
                    violation_type=vtype, camera_id=v.camera_id, zone_id=v.zone_id,
                    accepted=False, reason="ضمن فترة التهدئة (cooldown)",
                )
            )
            continue

        try:
            evidence_url = store_agent_evidence(v.evidence_image)
        except HTTPException as exc:
            rejected += 1
            results.append(
                LocalAgentAlertResult(
                    violation_type=vtype, camera_id=v.camera_id, zone_id=v.zone_id,
                    accepted=False, reason=str(exc.detail),
                )
            )
            continue

        confidence_int = max(0, min(100, int(round(float(v.confidence)))))
        created_at = now
        if v.detected_at is not None:
            dt = v.detected_at
            created_at = dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt

        row = MonitoringAlert(
            tenant_id=tenant_id,
            branch_id=branch_id,
            branch_name=None,
            camera_id=v.camera_id if cam is not None else None,
            camera_name=cam_name,
            location=location,
            violation_type=vtype,
            label_ar=_label_for(vtype, v.label_ar),
            confidence=confidence_int,
            reason_ar=(v.reason_ar or "").strip() or "تم الرصد بواسطة الوكيل المحلي (YOLO)",
            image_data_url=evidence_url,
            status="open",
            created_at=created_at,
        )
        db.add(row)
        db.flush()
        seen_in_batch.add(batch_key)
        created += 1
        results.append(
            LocalAgentAlertResult(
                violation_type=vtype, camera_id=v.camera_id, zone_id=v.zone_id,
                accepted=True, alert_id=row.id,
            )
        )

    db.commit()
    logger.info(
        "local-agent alerts: received=%d created=%d duplicates=%d rejected=%d",
        len(payload.violations), created, duplicates, rejected,
    )
    return LocalAgentAlertResponse(
        ok=True,
        received=len(payload.violations),
        created=created,
        duplicates=duplicates,
        rejected=rejected,
        results=results,
    )
