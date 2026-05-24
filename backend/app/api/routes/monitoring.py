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
from app.services.violation_tracker import default_tracker as violation_tracker
from app.services.yolo_monitoring_service import YOLO_BUSY_MESSAGE

router = APIRouter(
    prefix="/monitoring",
    tags=["monitoring"],
    dependencies=[Depends(require_roles("supervisor", "admin"))],
)

logger = logging.getLogger(__name__)

# Observational violation types that inform the UI but should not create DB alert rows.
_NO_ALERT_TYPES: frozenset[str] = frozenset({"no_person_in_zone", "unclear_camera_angle"})

# Multi-frame confirmation + cooldown live in `violation_tracker` (per camera + type + person).
# DB-level dedup window mirrors tracker cooldown so a process restart never produces a flood.
_DB_DEDUP_SECONDS = violation_tracker.cooldown_seconds

# Per-type minimum confidence (0–100 int) required to write a DB alert row.
# Violations below this threshold are surfaced to the operator UI as "needs_review"
# but do NOT create a persistent alert in the database.
#
# Tuned for production webcams: real kitchens give 40–55% confidence routinely.
# Multi-frame confirmation (streak_required=2) + per-person cooldown still prevents
# flicker false positives, so we can keep these thresholds reasonable.
_CONFIRMED_CONF_THRESHOLDS: dict[str, int] = {
    # Headcover: model fires at 26–52%; alert at 35%+ (will create some alerts)
    "no_headcover":     35,
    # Mask: model max ~28% (5 epochs, broken); rarely creates alerts but floor is now 22
    "no_mask":          38,
    # Gloves: OPTIONAL CHECK — threshold set above model max (54%) so no DB alerts are
    # created until the gloves model is retrained and _GLOVES_OPTIONAL set to False.
    # Violations still appear in the UI as "needs_review" (ppe_region_pipeline.py).
    "no_gloves":        90,
    "improper_uniform": 42,
    "trash_on_floor":   42,
    "improper_waste_area": 42,
    "trash_wrong_location": 42,
    "wet_floor":        42,
}
_CONFIRMED_CONF_DEFAULT: int = 38

# Band below _CONFIRMED_CONF_THRESHOLDS but above this floor → "needs_review" in the response.
# Lowered from 30 → 22 so low-confidence mask detections (model max ~28%) appear in UI.
_NEEDS_REVIEW_FLOOR: int = 22


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
    # Prefer the annotated evidence frame (with PPE region boxes drawn) produced
    # by the region pipeline. Fall back to the raw frame if unavailable.
    snapshot = payload.pop("annotated_frame", None) or monitoring_image_snapshot(image_bytes)
    alerts_created = 0
    cutoff = now - timedelta(seconds=_DB_DEDUP_SECONDS)
    inserted_keys: set[tuple[str, int | None]] = set()
    persist_alerts = not settings.MONITORING_AI_DEMO_MODE and str(payload.get("provider") or "") != "demo"

    # Reset streaks for violations absent from this frame (per-camera scope).
    current_vtypes: set[str] = {
        str(v.get("type", "")).strip()
        for v in (payload.get("violations") or [])
        if isinstance(v, dict) and not v.get("alias_of")
    }
    violation_tracker.reset_absent_types(
        current_user.tenant_id, camera_id, current_vtypes,
    )

    # First pass — classify everything for the UI (needs_review vs confirmed).
    for v in (payload.get("violations") or []):
        if not isinstance(v, dict) or v.get("alias_of"):
            continue
        vtype = str(v.get("type", "")).strip()
        vconf = int(v.get("confidence", 0) or 0)
        if vtype in _NO_ALERT_TYPES or not vtype:
            continue
        conf_threshold = _CONFIRMED_CONF_THRESHOLDS.get(vtype, _CONFIRMED_CONF_DEFAULT)
        if vconf < _NEEDS_REVIEW_FLOOR:
            logger.debug("audit skip_junk type=%s conf=%d floor=%d", vtype, vconf, _NEEDS_REVIEW_FLOOR)
            v["status"] = "suppressed"
        elif vconf < conf_threshold:
            logger.info(
                "audit needs_review type=%s conf=%d threshold=%d camera=%s",
                vtype, vconf, conf_threshold, eff_name,
            )
            v["status"] = "needs_review"

    # Second pass — multi-frame confirmation + cooldown before any DB write.
    for v in (payload.get("violations") or []) if persist_alerts else []:
        if not isinstance(v, dict) or v.get("alias_of"):
            continue
        vtype = str(v.get("type", "")).strip()
        vconf = int(v.get("confidence", 0) or 0)
        vstatus = str(v.get("status", "new")).strip()
        pin = v.get("person_index")
        try:
            pin_int = int(pin) if pin is not None else None
        except (TypeError, ValueError):
            pin_int = None

        if vtype in _NO_ALERT_TYPES or not vtype:
            continue
        if vstatus in ("suppressed", "needs_review"):
            logger.debug("audit skip_no_db type=%s conf=%d status=%s", vtype, vconf, vstatus)
            continue
        if vconf < _CONFIRMED_CONF_THRESHOLDS.get(vtype, _CONFIRMED_CONF_DEFAULT):
            continue

        dedupe_key = (vtype, pin_int)
        if dedupe_key in inserted_keys:
            continue

        info = violation_tracker.register_detailed(
            tenant_id=current_user.tenant_id,
            camera_id=camera_id,
            vtype=vtype,
            person_index=pin_int,
            confidence=vconf,
        )
        streak = info["streak"]
        confirmed = info["confirmed"]
        smoothed_conf = int(round(info["smoothed_confidence"]))
        if not confirmed:
            logger.debug(
                "audit streak_building type=%s conf=%d smoothed=%d streak=%d/%d reason=%s camera=%s person=%s",
                vtype, vconf, smoothed_conf, streak,
                violation_tracker.streak_required, info["reason"], eff_name, pin_int,
            )
            continue

        # DB-level dedup as durable backstop (covers process restarts).
        if _has_recent_duplicate(
            db,
            tenant_id=current_user.tenant_id,
            camera_id=camera_id,
            violation_type=vtype,
            since=cutoff,
        ):
            logger.debug(
                "audit db_dedup_skip type=%s conf=%d window=%ds camera=%s",
                vtype, vconf, _DB_DEDUP_SECONDS, eff_name,
            )
            continue

        inserted_keys.add(dedupe_key)
        priority = str(info.get("priority") or "medium")
        offender_count = int(info.get("offender_count") or 0)
        # Propagate smart-priority + offender info onto the live response payload
        # so the UI can render colour, badge, and "repeated offender" hint.
        v["severity"] = priority
        v["priority"] = priority
        v["smoothed_confidence"] = smoothed_conf
        v["offender_count"] = offender_count
        logger.info(
            "audit ALERT_CREATED type=%s conf=%d smoothed=%d streak=%d priority=%s "
            "offender_count=%d camera=%s location=%s person=%s",
            vtype, vconf, smoothed_conf, streak, priority, offender_count,
            eff_name, eff_location, pin_int,
        )
        row = MonitoringAlert(
            tenant_id=current_user.tenant_id,
            branch_id=current_user.branch_id,
            branch_name=current_user.branch_name,
            camera_id=camera_id,
            camera_name=eff_name,
            location=eff_location,
            violation_type=vtype,
            label_ar=str(v.get("label_ar", "")).strip() or vtype,
            # Persist the smoothed confidence (less flicker, more stable historical reporting).
            confidence=max(vconf, smoothed_conf),
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
                smoothed_confidence=int(v.get("smoothed_confidence", 0) or 0),
                offender_count=int(v.get("offender_count", 0) or 0),
                priority=str(v.get("priority") or v.get("severity") or "low"),
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
