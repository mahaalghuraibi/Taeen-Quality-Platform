"""
Mask detection inference using a custom-trained YOLOv8 model.

Model location:  backend/app/ml/models/mask_best.pt
                 Copy your trained mask_best.pt into that directory and restart.

Classes (must match training order):
  0: mask     — worker wearing a face mask (compliant)
  1: no_mask  — worker without a face mask (violation)

Confidence thresholds are tuned per-class to reduce false positives:
  MASK_CONF_MASK    — minimum score to report a "mask present" box
  MASK_CONF_NO_MASK — minimum score to report a "no_mask" violation
                      (higher than mask to reduce spurious alarms)

Live / CCTV mode:
  Pass wait_for_slot=False to skip inference when the model is already busy
  processing another frame.  The caller receives {"skipped": True} and
  should silently drop the frame rather than showing an error.
"""
from __future__ import annotations

import io
import logging
import os
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Model path ──────────────────────────────────────────────────────────────────
# parents[1] of this file = backend/app/ → backend/app/ml/models/mask_best.pt
_APP_DIR = Path(__file__).resolve().parents[1]
MASK_MODELS_DIR = _APP_DIR / "ml" / "models"
MASK_MODEL_PATH = MASK_MODELS_DIR / "mask_best.pt"

# ── Class registry ──────────────────────────────────────────────────────────────
_CLASS_NAMES: dict[int, str] = {0: "mask", 1: "no_mask"}
_VIOLATION_CLASSES: frozenset[str] = frozenset({"no_mask"})

# ── Per-class confidence thresholds (env-overridable) ──────────────────────────
# Higher no_mask threshold = fewer false positives when someone is partially masked
# or the camera angle is poor. Tune after evaluating your validation set.
CONF_MASK: float = float(os.getenv("MASK_CONF_MASK", "0.50"))
CONF_NO_MASK: float = float(os.getenv("MASK_CONF_NO_MASK", "0.55"))

_PER_CLASS_CONF: dict[str, float] = {
    "mask": CONF_MASK,
    "no_mask": CONF_NO_MASK,
}

# NMS IoU threshold — lower = more aggressive suppression (fewer overlapping boxes)
NMS_IOU: float = float(os.getenv("MASK_NMS_IOU", "0.45"))

# ── Inference slot (live/CCTV mode) ─────────────────────────────────────────────
# Only one inference runs at a time.  In live mode callers use wait_for_slot=False
# so busy frames are dropped instead of queuing and lagging.
_slot = threading.Semaphore(1)

MASK_BUSY_MESSAGE = "mask_detector_busy"

# ── Thread-safe lazy model cache ────────────────────────────────────────────────
_model_lock = threading.Lock()
_cached_model: Any = None


def _load_model() -> Any:
    """Load and cache the YOLOv8 model on first call (double-checked locking)."""
    global _cached_model
    if _cached_model is not None:
        return _cached_model
    with _model_lock:
        if _cached_model is not None:
            return _cached_model
        if not MASK_MODEL_PATH.is_file():
            raise FileNotFoundError(
                f"Mask model not found: {MASK_MODEL_PATH}\n"
                "Copy mask_best.pt into backend/app/ml/models/ and restart the server."
            )
        from ultralytics import YOLO

        logger.info("Loading mask detection model: %s", MASK_MODEL_PATH)
        _cached_model = YOLO(str(MASK_MODEL_PATH))
        logger.info(
            "Mask detection model loaded — conf_mask=%.2f conf_no_mask=%.2f nms_iou=%.2f",
            CONF_MASK,
            CONF_NO_MASK,
            NMS_IOU,
        )
    return _cached_model


def _decode_image(image_bytes: bytes):  # type: ignore[return]
    """
    Decode raw image bytes → (H, W, 3) RGB numpy array.

    Uses cv2 to bypass the PIL.Image.open monkey-patch that ultralytics
    installs after YOLO is loaded.  Falls back to PIL for rare formats
    (HEIC, TIFF, …) that cv2 cannot handle.
    """
    import numpy as np
    import cv2

    nparr = np.frombuffer(image_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is not None:
        return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    # Fallback: PIL with importlib to avoid ultralytics' patched open
    import importlib

    pil_mod = importlib.import_module("PIL.Image")
    _open = getattr(pil_mod, "_original_open", pil_mod.open)
    img_pil = _open(io.BytesIO(image_bytes)).convert("RGB")
    import numpy as np  # noqa: F811 — re-import in fallback path is intentional

    return np.array(img_pil)


def run_mask_detection(
    image_bytes: bytes,
    *,
    wait_for_slot: bool = True,
) -> dict[str, Any]:
    """
    Run YOLO inference on *image_bytes*.

    Parameters
    ----------
    image_bytes   : Raw image file content (JPEG / PNG / WEBP / BMP …)
    wait_for_slot : True  → block until the inference slot is free (manual uploads).
                    False → return immediately with {"skipped": True} when busy
                            (live CCTV frames — drop rather than queue).

    Return shape
    ------------
    {
        "skipped":    bool,           # True only when wait_for_slot=False and busy
        "detected":   bool,
        "violations": list[str],      # e.g. ["no_mask"]
        "boxes": [
            {
                "class_name": str,
                "confidence": float,  # 0.0–1.0 (filtered by per-class threshold)
                "x1": float, "y1": float,   # top-left  (pixels)
                "x2": float, "y2": float,   # bot-right (pixels)
            },
            …
        ],
        "model_info": {"conf_mask": float, "conf_no_mask": float, "nms_iou": float},
    }
    """
    acquired = _slot.acquire(blocking=wait_for_slot)
    if not acquired:
        # Live mode — frame skipped, not an error
        return {
            "skipped": True,
            "detected": False,
            "violations": [],
            "boxes": [],
            "model_info": {
                "conf_mask": CONF_MASK,
                "conf_no_mask": CONF_NO_MASK,
                "nms_iou": NMS_IOU,
            },
        }

    try:
        model = _load_model()
        img_array = _decode_image(image_bytes)

        # Run inference with NMS IoU set explicitly; use the lower of the two
        # per-class thresholds so YOLO doesn't drop boxes we want to evaluate.
        raw_conf = min(CONF_MASK, CONF_NO_MASK)
        results = model(img_array, verbose=False, conf=raw_conf, iou=NMS_IOU)

        boxes_out: list[dict[str, Any]] = []
        violations: set[str] = set()

        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                class_name = _CLASS_NAMES.get(cls_id, f"class_{cls_id}")

                # Apply per-class threshold (filter out low-conf no_mask to
                # avoid false positives from partial-face angles)
                threshold = _PER_CLASS_CONF.get(class_name, raw_conf)
                if conf < threshold:
                    continue

                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                boxes_out.append(
                    {
                        "class_name": class_name,
                        "confidence": round(conf, 4),
                        "x1": round(x1, 2),
                        "y1": round(y1, 2),
                        "x2": round(x2, 2),
                        "y2": round(y2, 2),
                    }
                )
                if class_name in _VIOLATION_CLASSES:
                    violations.add(class_name)

        return {
            "skipped": False,
            "detected": len(boxes_out) > 0,
            "violations": sorted(violations),
            "boxes": boxes_out,
            "model_info": {
                "conf_mask": CONF_MASK,
                "conf_no_mask": CONF_NO_MASK,
                "nms_iou": NMS_IOU,
            },
        }
    finally:
        _slot.release()
