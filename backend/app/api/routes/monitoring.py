import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.core.config import settings
from app.core.limiter import limiter
from app.db.session import get_db
from app.models.camera import Camera
from app.models.monitoring_alert import MonitoringAlert
from app.models.user import User
from app.schemas.monitoring import MonitoringAnalyzeResponse, MonitoringCheckOut, MonitoringViolationOut
from app.services.monitoring_ai_service import analyze_monitoring_frame, monitoring_image_snapshot
from app.services.yolo_monitoring_service import YOLO_BUSY_MESSAGE

router = APIRouter(
    prefix="/monitoring",
    tags=["monitoring"],
    dependencies=[Depends(require_roles("supervisor", "admin"))],
)

logger = logging.getLogger(__name__)

# Observational violation types that inform the UI but should not create DB alert rows.
_NO_ALERT_TYPES: frozenset[str] = frozenset({"no_person_in_zone", "unclear_camera_angle"})


def _skipped_busy_response() -> MonitoringAnalyzeResponse:
    """Live mode: previous frame still running — drop this frame without error UI."""
    return MonitoringAnalyzeResponse(
        ok=True,
        status="skipped_busy",
        provider="yolo",
        checks=[],
        violations=[],
        alerts_created=0,
        summary="تم تخطي الإطار — التحليل السابق ما زال قيد المعالجة.",
    )


def _ensure_supervisor_branch(current_user: User) -> None:
    if current_user.role == "supervisor" and current_user.branch_id is None:
        raise HTTPException(status_code=400, detail="لم يتم تحديد الفرع لهذا الحساب")


def _has_recent_duplicate(
    db: Session,
    *,
    tenant_id: int,
    camera_id: int | None,
    violation_type: str,
    since: datetime,
) -> bool:
    q = (
        db.query(MonitoringAlert.id)
        .filter(
            MonitoringAlert.tenant_id == tenant_id,
            MonitoringAlert.violation_type == violation_type,
            MonitoringAlert.created_at >= since,
        )
    )
    if camera_id is not None:
        q = q.filter(MonitoringAlert.camera_id == camera_id)
    else:
        q = q.filter(MonitoringAlert.camera_id.is_(None))
    return q.first() is not None


@router.post("/analyze-frame", response_model=MonitoringAnalyzeResponse)
@limiter.limit("72/minute")
async def analyze_frame(
    request: Request,
    image: UploadFile = File(...),
    camera_id: int | None = Form(None),
    camera_name: str | None = Form(None),
    location: str | None = Form(None),
    analysis_mode: str = Form("manual"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MonitoringAnalyzeResponse:
    _ensure_supervisor_branch(current_user)
    image_bytes = await image.read()
    max_b = int(getattr(settings, "MONITORING_UPLOAD_MAX_BYTES", 8 * 1024 * 1024) or 8 * 1024 * 1024)
    if len(image_bytes) > max_b:
        raise HTTPException(
            status_code=413,
            detail="حجم الملف يتجاوز الحد المسموح للتحليل.",
        )
    mode = (analysis_mode or "manual").strip().lower()
    live_mode = mode == "live"
    try:
        # YOLO inference + model download are CPU/IO heavy — never block the asyncio event loop.
        # 300-second outer timeout covers cold-start model download (~3 min) plus inference.
        payload = await asyncio.wait_for(
            asyncio.to_thread(
                analyze_monitoring_frame,
                image_bytes=image_bytes,
                content_type=image.content_type,
                camera_name=(camera_name or "").strip() or None,
                location=(location or "").strip() or None,
                wait_for_slot=not live_mode,
            ),
            timeout=300,
        )
    except asyncio.TimeoutError:
        logger.error("monitoring analyze timeout: exceeded 300s camera=%s", camera_name)
        raise HTTPException(
            status_code=503,
            detail="انتهت مهلة التحليل. حاول مرة أخرى — قد يكون النموذج ما زال يُحمَّل.",
        ) from None
    except ValueError as exc:
        msg = str(exc)
        if msg == YOLO_BUSY_MESSAGE and live_mode:
            return _skipped_busy_response()
        if "الصورة غير صالحة" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        # YOLO / dependency / configuration failures → 503 with the Arabic detail.
        raise HTTPException(status_code=503, detail=msg) from exc
    except Exception:
        logger.exception("monitoring analyze unexpected error")
        raise HTTPException(
            status_code=500,
            detail="فشل تحليل الصورة. تحقق من إعدادات الذكاء الاصطناعي.",
        ) from None

    logger.info(
        "monitoring parsed provider=%s checks=%s violations=%s",
        payload.get("provider"),
        len(payload.get("checks") or []),
        len(payload.get("violations") or []),
    )

    cam: Camera | None = None
    if camera_id is not None:
        cam = (
            db.query(Camera)
            .filter(Camera.id == camera_id, Camera.tenant_id == current_user.tenant_id)
            .first()
        )
        if cam is None:
            raise HTTPException(status_code=400, detail="الكاميرا غير موجودة")

    eff_name = (camera_name or "").strip() or (cam.name if cam else None)
    eff_location = (location or "").strip() or (cam.location if cam else None)

    payload["camera_name"] = eff_name
    payload["location"] = eff_location

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    snapshot = monitoring_image_snapshot(image_bytes)
    alerts_created = 0
    # Shorter window so successive snapshots / video frames can register distinct alerts without changing AI output.
    cutoff = now - timedelta(seconds=14)
    inserted_keys: set[tuple[str, int | None]] = set()
    persist_alerts = not settings.MONITORING_AI_DEMO_MODE and str(payload.get("provider") or "") != "demo"

    for v in (payload.get("violations") or []) if persist_alerts else []:
        if not isinstance(v, dict):
            continue
        if v.get("alias_of"):
            continue
        vtype = str(v.get("type", "")).strip()
        vconf = int(v.get("confidence", 0) or 0)
        pin = v.get("person_index")
        try:
            pin_int = int(pin) if pin is not None else None
        except (TypeError, ValueError):
            pin_int = None
        dedupe_key = (vtype, pin_int)
        # Observational types inform the UI only — do not create alert rows.
        if vtype in _NO_ALERT_TYPES:
            continue
        # Finalize_payload already applies per-type thresholds; this is only a hard junk floor (noise < ~37%).
        if not vtype or vconf < 32:
            continue
        if dedupe_key in inserted_keys:
            continue
        inserted_keys.add(dedupe_key)
        if _has_recent_duplicate(
            db,
            tenant_id=current_user.tenant_id,
            camera_id=camera_id,
            violation_type=vtype,
            since=cutoff,
        ):
            continue
        row = MonitoringAlert(
            tenant_id=current_user.tenant_id,
            branch_id=current_user.branch_id,
            branch_name=current_user.branch_name,
            camera_id=camera_id,
            camera_name=eff_name,
            location=eff_location,
            violation_type=vtype,
            label_ar=str(v.get("label_ar", "")).strip() or vtype,
            confidence=vconf,
            reason_ar=str(v.get("reason_ar", "")).strip() or "—",
            image_data_url=snapshot,
            status="open",
            created_at=now,
        )
        db.add(row)
        alerts_created += 1

    if cam is not None:
        cam.last_analysis_at = now
        db.add(cam)

    db.commit()

    return MonitoringAnalyzeResponse(
        ok=bool(payload.get("ok", True)),
        status=str(payload.get("status", "ok")),
        provider=str(payload.get("provider", "")),
        camera_name=payload.get("camera_name"),
        location=payload.get("location"),
        people_count=int(payload.get("people_count", 0) or 0),
        overall_confidence=int(payload.get("overall_confidence", 0) or 0),
        needs_review=bool(payload.get("needs_review")),
        checks=[MonitoringCheckOut(**c) for c in (payload.get("checks") or [])],
        violations=[
            MonitoringViolationOut(
                type=str(v.get("type", "")),
                label_ar=str(v.get("label_ar", "")),
                confidence=int(v.get("confidence", 0) or 0),
                reason_ar=str(v.get("reason_ar", "")),
                description=str(v.get("description", "") or v.get("reason_ar", "")),
                status=str(v.get("status", "new") or "new"),
                person_index=v.get("person_index"),
                alias_of=v.get("alias_of"),
                severity=str(v.get("severity", "medium") or "medium"),
                category=str(v.get("category", "PPE") or "PPE"),
                suggested_action=str(v.get("suggested_action", "") or ""),
            )
            for v in (payload.get("violations") or [])
            if isinstance(v, dict)
        ],
        alerts_created=alerts_created,
        summary=str(payload.get("summary", "")),
        frame_report=payload.get("frame_report"),
        quality_pct=int(payload.get("quality_pct", 100) or 100),
        violation_count=int(payload.get("violation_count", 0) or 0),
        overall_status=str(payload.get("overall_status", "clean") or "clean"),
    )
