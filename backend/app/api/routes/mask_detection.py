"""
POST /api/v1/analyze-mask

Accepts an uploaded image and runs the custom mask_best.pt YOLO model on it.
Returns detected bounding boxes with class names (mask / no_mask) and confidence.
Boxes where class_name == "no_mask" are listed under "violations".

Model must be present at: backend/app/ml/models/mask_best.pt
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.core.limiter import limiter
from app.models.user import User

router = APIRouter(tags=["mask-detection"])
logger = logging.getLogger(__name__)

_MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB


class MaskDetectionBox(BaseModel):
    class_name: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float


class MaskDetectionResponse(BaseModel):
    detected: bool
    violations: list[str]
    boxes: list[MaskDetectionBox]


@router.post(
    "/analyze-mask",
    response_model=MaskDetectionResponse,
    dependencies=[Depends(require_roles("admin", "supervisor", "staff"))],
)
@limiter.limit("60/minute")
async def analyze_mask(
    request: Request,
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> MaskDetectionResponse:
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="يرجى رفع ملف صورة صالح.")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="الصورة فارغة.")
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="حجم الصورة يتجاوز الحد المسموح (8 MB).")

    try:
        # YOLO inference is CPU-bound — run in a thread to avoid blocking the event loop.
        from app.services.mask_detection_service import run_mask_detection

        result = await asyncio.to_thread(run_mask_detection, image_bytes)
    except FileNotFoundError as exc:
        logger.error("analyze-mask: model file missing — %s", exc)
        raise HTTPException(
            status_code=503,
            detail=(
                "نموذج الكشف غير موجود على الخادم. "
                "ضع mask_best.pt في backend/app/ml/models/ وأعد تشغيل الخادم."
            ),
        ) from exc
    except Exception as exc:
        logger.exception("analyze-mask: inference error")
        raise HTTPException(
            status_code=500,
            detail="فشل تحليل الصورة. راجع سجلات الخادم.",
        ) from exc

    logger.info(
        "analyze-mask user=%s detected=%s violations=%s boxes=%d",
        current_user.id,
        result["detected"],
        result["violations"],
        len(result["boxes"]),
    )
    return MaskDetectionResponse(**result)
