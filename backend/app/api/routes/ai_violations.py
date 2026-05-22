"""
AI violation detection endpoint.
Runs YOLO models for PPE violations and auto-creates MonitoringAlert records.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.db.session import get_db
from app.models.monitoring_alert import MonitoringAlert
from app.models.user import User
from app.services.ai_violation_service import SUPPORTED_TYPES, detect_violation
from app.services.monitoring_ai_service import VIOLATION_TYPE_LABELS, monitoring_image_snapshot

router = APIRouter(
    prefix="/violations",
    tags=["violations"],
    dependencies=[Depends(require_roles("supervisor", "admin"))],
)

logger = logging.getLogger(__name__)

_DEDUP_SECONDS = 14


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


@router.post("/detect")
async def detect_violation_endpoint(
    image: UploadFile = File(...),
    violation_type: str = Form(...),
    camera_id: int | None = Form(None),
    camera_name: str | None = Form(None),
    location: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vtype = (violation_type or "").strip().lower()
    if vtype not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"نوع المخالفة غير مدعوم. الأنواع المدعومة: {', '.join(sorted(SUPPORTED_TYPES))}",
        )

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="الصورة غير صالحة.")
    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="حجم الملف يتجاوز الحد المسموح (8 MB).")

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(detect_violation, image_bytes, vtype),
            timeout=60,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="انتهت مهلة التحليل. حاول مرة أخرى.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        logger.exception("ai_violation detect error type=%s", vtype)
        raise HTTPException(status_code=500, detail="فشل تحليل الصورة.") from None

    alert_id: int | None = None

    if result["violation_detected"]:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        cutoff = now - timedelta(seconds=_DEDUP_SECONDS)

        if not _has_recent_duplicate(
            db,
            tenant_id=current_user.tenant_id,
            camera_id=camera_id,
            violation_type=vtype,
            since=cutoff,
        ):
            snapshot = monitoring_image_snapshot(image_bytes)
            label_ar = VIOLATION_TYPE_LABELS.get(vtype, vtype)
            alert = MonitoringAlert(
                tenant_id=current_user.tenant_id,
                branch_id=current_user.branch_id,
                branch_name=current_user.branch_name,
                camera_id=camera_id,
                camera_name=(camera_name or "").strip() or None,
                location=(location or "").strip() or None,
                violation_type=vtype,
                label_ar=label_ar,
                confidence=result["confidence"],
                reason_ar=result["status_message"],
                image_data_url=snapshot,
                status="open",
                created_at=now,
            )
            db.add(alert)
            db.commit()
            db.refresh(alert)
            alert_id = alert.id
            logger.info(
                "ai_violation alert created id=%d type=%s conf=%d camera=%s",
                alert_id, vtype, result["confidence"], camera_name,
            )

    return {
        "ok": True,
        "violation_detected": result["violation_detected"],
        "detection_count": result["detection_count"],
        "confidence": result["confidence"],
        "status_message": result["status_message"],
        "annotated_image": result["annotated_image"],
        "detections": result["detections"],
        "alert_id": alert_id,
    }


@router.get("/types")
def get_violation_types():
    """List all violation types with active/placeholder status."""
    return {
        "types": [
            {"key": "no_gloves",       "label_ar": "عدم ارتداء القفازات",       "active": True},
            {"key": "no_headcover",    "label_ar": "عدم ارتداء غطاء الرأس",     "active": True},
            {"key": "no_mask",         "label_ar": "عدم ارتداء الكمامة",         "active": False},
            {"key": "improper_uniform","label_ar": "عدم ارتداء الزي الرسمي",     "active": False},
            {"key": "trash_on_floor",  "label_ar": "نفايات على الأرض",           "active": False},
            {"key": "wet_floor",       "label_ar": "أرضية مبللة",               "active": False},
            {"key": "people_counting", "label_ar": "مخالفة عدد الأشخاص",        "active": False},
        ]
    }
