"""
People-counting endpoints.

POST /api/v1/analyze-people-count
    Upload a single image.  Returns how many persons were detected,
    whether the count exceeds the allowed limit, and individual bounding boxes.

POST /api/v1/people-count-live-frame
    Lightweight live/CCTV variant — drops the frame silently when the model
    is busy, instead of queuing and lagging behind the feed.

Environment variables (optional):
    PEOPLE_DETECT_CONF    default 0.28
    PEOPLE_NMS_IOU        default 0.45
    PEOPLE_MAX_ALLOWED    default 5
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.core.limiter import limiter
from app.models.user import User

router = APIRouter(tags=["people-count"])
logger = logging.getLogger(__name__)

_MAX_IMAGE_BYTES = 8 * 1024 * 1024
_INFERENCE_TIMEOUT = 60


# ── Response models ─────────────────────────────────────────────────────────────

class PersonBox(BaseModel):
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float


class PeopleModelInfo(BaseModel):
    conf: float
    nms_iou: float


class PeopleCountResponse(BaseModel):
    ok: bool
    status: str                        # "ok" | "skipped_busy"
    people_count: int
    max_allowed: int
    violation: bool
    message: str
    boxes: list[PersonBox]
    model_info: PeopleModelInfo | None = None


# ── Shared helpers ───────────────────────────────────────────────────────────────

def _skipped_busy() -> PeopleCountResponse:
    return PeopleCountResponse(
        ok=True,
        status="skipped_busy",
        people_count=0,
        max_allowed=0,
        violation=False,
        message="تم تخطي الإطار — المعالجة السابقة لم تنته بعد.",
        boxes=[],
    )


async def _run_inference(
    image_bytes: bytes,
    *,
    max_allowed: int | None,
    wait_for_slot: bool,
) -> dict:
    from app.services.people_count_service import count_people

    return await asyncio.wait_for(
        asyncio.to_thread(
            count_people,
            image_bytes,
            max_allowed=max_allowed,
            wait_for_slot=wait_for_slot,
        ),
        timeout=_INFERENCE_TIMEOUT,
    )


def _validate_upload(image_bytes: bytes, content_type: str | None) -> None:
    if not content_type or not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="يرجى رفع ملف صورة صالح.")
    if not image_bytes:
        raise HTTPException(status_code=400, detail="الصورة فارغة.")
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="حجم الصورة يتجاوز الحد المسموح (8 MB).")


def _build_response(result: dict) -> PeopleCountResponse:
    mi = result.get("model_info")
    return PeopleCountResponse(
        ok=True,
        status="ok",
        people_count=int(result.get("people_count", 0)),
        max_allowed=int(result.get("max_allowed", 0)),
        violation=bool(result.get("violation")),
        message=str(result.get("message", "")),
        boxes=[PersonBox(**b) for b in (result.get("boxes") or [])],
        model_info=PeopleModelInfo(**mi) if mi else None,
    )


# ── Manual upload endpoint ───────────────────────────────────────────────────────

@router.post(
    "/analyze-people-count",
    response_model=PeopleCountResponse,
    dependencies=[Depends(require_roles("admin", "supervisor", "staff"))],
    summary="Count persons in an uploaded image",
)
@limiter.limit("60/minute")
async def analyze_people_count(
    request: Request,
    image: UploadFile = File(...),
    max_allowed: int | None = Form(None, description="Override crowd limit for this call (default from PEOPLE_MAX_ALLOWED env)"),
    current_user: User = Depends(get_current_user),
) -> PeopleCountResponse:
    image_bytes = await image.read()
    _validate_upload(image_bytes, image.content_type)

    try:
        result = await _run_inference(image_bytes, max_allowed=max_allowed, wait_for_slot=True)
    except asyncio.TimeoutError:
        logger.error("analyze-people-count: timeout after %ds user=%s", _INFERENCE_TIMEOUT, current_user.id)
        raise HTTPException(status_code=503, detail="انتهت مهلة التحليل. أعد المحاولة.") from None
    except Exception:
        logger.exception("analyze-people-count: inference error")
        raise HTTPException(status_code=500, detail="فشل تحليل الصورة. راجع سجلات الخادم.") from None

    logger.info(
        "analyze-people-count user=%s count=%d violation=%s",
        current_user.id,
        result.get("people_count", 0),
        result.get("violation"),
    )
    return _build_response(result)


# ── Live / CCTV frame endpoint ───────────────────────────────────────────────────

@router.post(
    "/people-count-live-frame",
    response_model=PeopleCountResponse,
    dependencies=[Depends(require_roles("admin", "supervisor", "staff"))],
    summary="Submit a live CCTV frame for people counting — drops frame when busy",
)
@limiter.limit("72/minute")
async def people_count_live_frame(
    request: Request,
    image: UploadFile = File(...),
    camera_id: int | None = Form(None),
    camera_name: str | None = Form(None),
    max_allowed: int | None = Form(None),
    current_user: User = Depends(get_current_user),
) -> PeopleCountResponse:
    image_bytes = await image.read()
    _validate_upload(image_bytes, image.content_type)

    try:
        result = await _run_inference(image_bytes, max_allowed=max_allowed, wait_for_slot=False)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="انتهت مهلة التحليل.") from None
    except Exception:
        logger.exception("people-count-live-frame: inference error")
        raise HTTPException(status_code=500, detail="فشل تحليل الإطار.") from None

    if result.get("skipped"):
        return _skipped_busy()

    logger.info(
        "people-count-live-frame camera=%s user=%s count=%d violation=%s",
        camera_name or camera_id,
        current_user.id,
        result.get("people_count", 0),
        result.get("violation"),
    )
    return _build_response(result)
