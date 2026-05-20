"""
Mask detection endpoints.

POST /api/v1/analyze-mask
    Upload a single image for manual analysis.
    Blocks until inference completes (up to 60 s timeout).
    Returns detected bounding boxes, violation flags, and model diagnostics.

POST /api/v1/mask-live-frame
    Lightweight live/CCTV variant.
    Drops the frame silently when the model is already busy processing
    the previous one — no queue, no error shown to the user.
    Designed to be called on a timer (e.g. every 5–10 s from the frontend).

Model must be present at: backend/app/ml/models/mask_best.pt
Environment variables (optional):
    MASK_CONF_MASK    default 0.50 — confidence floor for "mask present"
    MASK_CONF_NO_MASK default 0.55 — confidence floor for "no_mask" violation
    MASK_NMS_IOU      default 0.45 — NMS IoU threshold
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

router = APIRouter(tags=["mask-detection"])
logger = logging.getLogger(__name__)

_MAX_IMAGE_BYTES = 8 * 1024 * 1024   # 8 MB
_INFERENCE_TIMEOUT = 60               # seconds — covers cold-start model load


# ── Response models ─────────────────────────────────────────────────────────────

class MaskDetectionBox(BaseModel):
    class_name: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float


class MaskModelInfo(BaseModel):
    conf_mask: float
    conf_no_mask: float
    nms_iou: float


class MaskDetectionResponse(BaseModel):
    ok: bool
    status: str                       # "ok" | "skipped_busy"
    detected: bool
    violations: list[str]
    boxes: list[MaskDetectionBox]
    model_info: MaskModelInfo | None = None


# ── Shared helpers ───────────────────────────────────────────────────────────────

def _skipped_busy_response() -> MaskDetectionResponse:
    """Live mode: previous frame still running — drop without error."""
    return MaskDetectionResponse(
        ok=True,
        status="skipped_busy",
        detected=False,
        violations=[],
        boxes=[],
    )


async def _run_inference(image_bytes: bytes, *, wait_for_slot: bool) -> dict:
    """Run mask detection in a thread with a 60-second timeout."""
    from app.services.mask_detection_service import run_mask_detection

    return await asyncio.wait_for(
        asyncio.to_thread(run_mask_detection, image_bytes, wait_for_slot=wait_for_slot),
        timeout=_INFERENCE_TIMEOUT,
    )


def _read_and_validate_upload(image_bytes: bytes, content_type: str | None) -> None:
    if not content_type or not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="يرجى رفع ملف صورة صالح.")
    if not image_bytes:
        raise HTTPException(status_code=400, detail="الصورة فارغة.")
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="حجم الصورة يتجاوز الحد المسموح (8 MB).")


def _build_response(result: dict) -> MaskDetectionResponse:
    mi = result.get("model_info")
    return MaskDetectionResponse(
        ok=True,
        status="ok",
        detected=bool(result.get("detected")),
        violations=result.get("violations") or [],
        boxes=[MaskDetectionBox(**b) for b in (result.get("boxes") or [])],
        model_info=MaskModelInfo(**mi) if mi else None,
    )


# ── Manual upload endpoint ───────────────────────────────────────────────────────

@router.post(
    "/analyze-mask",
    response_model=MaskDetectionResponse,
    dependencies=[Depends(require_roles("admin", "supervisor", "staff"))],
    summary="Analyze a single uploaded image for mask compliance",
)
@limiter.limit("60/minute")
async def analyze_mask(
    request: Request,
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> MaskDetectionResponse:
    image_bytes = await image.read()
    _read_and_validate_upload(image_bytes, image.content_type)

    try:
        result = await _run_inference(image_bytes, wait_for_slot=True)
    except asyncio.TimeoutError:
        logger.error("analyze-mask: inference timeout after %ds", _INFERENCE_TIMEOUT)
        raise HTTPException(
            status_code=503,
            detail="انتهت مهلة التحليل. أعد المحاولة بعد لحظة.",
        ) from None
    except FileNotFoundError as exc:
        logger.error("analyze-mask: model missing — %s", exc)
        raise HTTPException(
            status_code=503,
            detail="نموذج الكشف غير موجود. ضع mask_best.pt في backend/app/ml/models/.",
        ) from exc
    except Exception:
        logger.exception("analyze-mask: inference error")
        raise HTTPException(status_code=500, detail="فشل تحليل الصورة. راجع سجلات الخادم.") from None

    logger.info(
        "analyze-mask user=%s detected=%s violations=%s boxes=%d",
        current_user.id,
        result.get("detected"),
        result.get("violations"),
        len(result.get("boxes") or []),
    )
    return _build_response(result)


# ── Live / CCTV frame endpoint ───────────────────────────────────────────────────

@router.post(
    "/mask-live-frame",
    response_model=MaskDetectionResponse,
    dependencies=[Depends(require_roles("admin", "supervisor", "staff"))],
    summary="Submit a live CCTV frame — dropped silently when model is busy",
)
@limiter.limit("72/minute")
async def mask_live_frame(
    request: Request,
    image: UploadFile = File(...),
    camera_id: int | None = Form(None),
    camera_name: str | None = Form(None),
    current_user: User = Depends(get_current_user),
) -> MaskDetectionResponse:
    """
    Intended for periodic timer calls from a webcam / CCTV feed.

    - If the model is still processing the previous frame, returns
      status="skipped_busy" (ok=True) without blocking.
    - 60-second hard timeout covers cold-start model load.
    - Does NOT persist alerts — use /analyze-mask for that.
    """
    image_bytes = await image.read()
    _read_and_validate_upload(image_bytes, image.content_type)

    try:
        result = await _run_inference(image_bytes, wait_for_slot=False)
    except asyncio.TimeoutError:
        logger.error(
            "mask-live-frame: timeout camera=%s user=%s",
            camera_name or camera_id,
            current_user.id,
        )
        raise HTTPException(status_code=503, detail="انتهت مهلة التحليل.") from None
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail="نموذج الكشف غير موجود. ضع mask_best.pt في backend/app/ml/models/.",
        ) from exc
    except Exception:
        logger.exception("mask-live-frame: inference error")
        raise HTTPException(status_code=500, detail="فشل تحليل الإطار.") from None

    if result.get("skipped"):
        return _skipped_busy_response()

    logger.info(
        "mask-live-frame camera=%s user=%s detected=%s violations=%s",
        camera_name or camera_id,
        current_user.id,
        result.get("detected"),
        result.get("violations"),
    )
    return _build_response(result)
