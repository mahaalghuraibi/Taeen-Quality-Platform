"""
People-counting inference service using the pretrained YOLOv8n COCO model.

No custom training required — the model is downloaded once from Ultralytics Hub
(~6 MB) and cached locally.  If yolov8n.pt is already present at
backend/ml/models/yolov8n.pt (placed there by the monitoring setup) it is
used directly with no network access.

COCO class 0 = "person".  All other classes are ignored.

Configuration (env vars, all optional)
---------------------------------------
PEOPLE_DETECT_CONF   float  0.28   Minimum confidence to count a person box.
PEOPLE_NMS_IOU       float  0.45   NMS IoU threshold.
PEOPLE_MAX_ALLOWED   int    5      Crowd-limit threshold that triggers a violation.
"""
from __future__ import annotations

import io
import logging
import os
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Model resolution ────────────────────────────────────────────────────────────
# Priority:
#   1) env PEOPLE_MODEL_PATH  (absolute or relative to backend/)
#   2) backend/ml/models/yolov8n.pt  (already present from monitoring setup)
#   3) backend/app/ml/models/yolov8n.pt
#   4) "yolov8n.pt" → Ultralytics auto-download on first use
_BACKEND_DIR = Path(__file__).resolve().parents[2]   # backend/
_DEFAULT_MODEL_PATH = _BACKEND_DIR / "ml" / "models" / "yolov8n.pt"

COCO_PERSON_CLASS_ID: int = 0

# ── Tunable parameters (env-overridable) ─────────────────────────────────────────
DETECT_CONF: float = float(os.getenv("PEOPLE_DETECT_CONF", "0.28"))
NMS_IOU: float = float(os.getenv("PEOPLE_NMS_IOU", "0.45"))
MAX_ALLOWED: int = int(os.getenv("PEOPLE_MAX_ALLOWED", "5"))

# ── Inference slot — one frame at a time ─────────────────────────────────────────
_slot = threading.Semaphore(1)
PEOPLE_BUSY_MESSAGE = "people_counter_busy"

# ── Thread-safe lazy model cache ──────────────────────────────────────────────────
_model_lock = threading.Lock()
_cached_model: Any = None


def _resolve_model_path() -> str:
    """Return absolute path to yolov8n.pt, falling back to hub id for auto-download."""
    configured = os.getenv("PEOPLE_MODEL_PATH", "").strip()
    if configured:
        p = Path(configured).expanduser()
        if not p.is_absolute():
            p = (_BACKEND_DIR / p).resolve()
        if p.is_file():
            return p.as_posix()
        logger.warning("PEOPLE_MODEL_PATH not found: %s — using default", configured)

    if _DEFAULT_MODEL_PATH.is_file():
        return _DEFAULT_MODEL_PATH.as_posix()

    alt = _BACKEND_DIR / "app" / "ml" / "models" / "yolov8n.pt"
    if alt.is_file():
        return alt.as_posix()

    # Ultralytics auto-download (~6 MB, cached in ~/.cache/ultralytics)
    return "yolov8n.pt"


def _load_model() -> Any:
    """Load and cache the YOLO model on first call (double-checked locking)."""
    global _cached_model
    if _cached_model is not None:
        return _cached_model
    with _model_lock:
        if _cached_model is not None:
            return _cached_model
        from ultralytics import YOLO

        model_path = _resolve_model_path()
        logger.info("Loading people-count model: %s", model_path)
        _cached_model = YOLO(model_path)
        logger.info(
            "People-count model ready — conf=%.2f nms_iou=%.2f max_allowed=%d",
            DETECT_CONF,
            NMS_IOU,
            MAX_ALLOWED,
        )
    return _cached_model


def _decode_image(image_bytes: bytes):  # type: ignore[return]
    """
    Decode raw image bytes to (H, W, 3) RGB numpy array.

    Uses cv2 to bypass ultralytics' PIL.Image.open monkey-patch.
    Falls back to PIL for formats cv2 cannot handle.
    """
    import numpy as np
    import cv2

    nparr = np.frombuffer(image_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is not None:
        return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    import importlib

    pil_mod = importlib.import_module("PIL.Image")
    _open = getattr(pil_mod, "_original_open", pil_mod.open)
    img_pil = _open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(img_pil)


def count_people(
    image_bytes: bytes,
    *,
    max_allowed: int | None = None,
    wait_for_slot: bool = True,
) -> dict[str, Any]:
    """
    Detect and count persons in *image_bytes*.

    Parameters
    ----------
    image_bytes  : Raw image content (JPEG / PNG / WEBP / BMP …)
    max_allowed  : Override the env-default crowd limit for this call.
    wait_for_slot: False → return {"skipped": True} immediately when busy
                   (for live CCTV frames that should be dropped, not queued).

    Return shape
    ------------
    {
        "skipped":      bool,
        "people_count": int,
        "violation":    bool,         # people_count > max_allowed
        "max_allowed":  int,
        "message":      str,          # human-readable Arabic summary
        "boxes": [
            {
                "confidence": float,
                "x1": float, "y1": float,
                "x2": float, "y2": float,
            },
            …
        ],
        "model_info": {"conf": float, "nms_iou": float},
    }
    """
    limit = max_allowed if max_allowed is not None else MAX_ALLOWED

    acquired = _slot.acquire(blocking=wait_for_slot)
    if not acquired:
        return {
            "skipped": True,
            "people_count": 0,
            "violation": False,
            "max_allowed": limit,
            "message": "تم تخطي الإطار — المعالجة السابقة لم تنته بعد.",
            "boxes": [],
            "model_info": {"conf": DETECT_CONF, "nms_iou": NMS_IOU},
        }

    try:
        model = _load_model()
        img_array = _decode_image(image_bytes)

        results = model(
            img_array,
            verbose=False,
            conf=DETECT_CONF,
            iou=NMS_IOU,
            classes=[COCO_PERSON_CLASS_ID],  # only detect persons
        )

        boxes_out: list[dict[str, Any]] = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                if int(box.cls[0]) != COCO_PERSON_CLASS_ID:
                    continue
                conf = float(box.conf[0])
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                boxes_out.append(
                    {
                        "confidence": round(conf, 4),
                        "x1": round(x1, 2),
                        "y1": round(y1, 2),
                        "x2": round(x2, 2),
                        "y2": round(y2, 2),
                    }
                )

        count = len(boxes_out)
        violation = count > limit

        if count == 0:
            message = "لم يتم رصد أشخاص في الصورة."
        elif violation:
            message = f"تجاوز الحد المسموح — تم رصد {count} شخصاً (الحد الأقصى {limit})."
        else:
            message = f"تم رصد {count} شخص/أشخاص ضمن الحد المسموح ({limit})."

        return {
            "skipped": False,
            "people_count": count,
            "violation": violation,
            "max_allowed": limit,
            "message": message,
            "boxes": boxes_out,
            "model_info": {"conf": DETECT_CONF, "nms_iou": NMS_IOU},
        }
    finally:
        _slot.release()
