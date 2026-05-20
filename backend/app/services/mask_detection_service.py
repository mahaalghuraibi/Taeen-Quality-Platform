"""
Mask detection inference using a custom-trained YOLOv8 model.

Model location:  backend/app/ml/models/mask_best.pt
                 Copy your trained mask_best.pt into that directory and restart.

Classes (must match training order):
  0: mask     — worker wearing a face mask (compliant)
  1: no_mask  — worker without a face mask (violation)
"""
from __future__ import annotations

import io
import logging
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Model path ──────────────────────────────────────────────────────────────────
# This file lives at backend/app/services/mask_detection_service.py
# parents[1] → backend/app/  →  backend/app/ml/models/mask_best.pt
_APP_DIR = Path(__file__).resolve().parents[1]
MASK_MODELS_DIR = _APP_DIR / "ml" / "models"
MASK_MODEL_PATH = MASK_MODELS_DIR / "mask_best.pt"

# ── Class registry ──────────────────────────────────────────────────────────────
_CLASS_NAMES: dict[int, str] = {0: "mask", 1: "no_mask"}
_VIOLATION_CLASSES: frozenset[str] = frozenset({"no_mask"})

# ── Thread-safe lazy model cache ────────────────────────────────────────────────
_lock = threading.Lock()
_cached_model: Any = None


def _load_model() -> Any:
    """Load and cache the YOLO model on first call (double-checked locking)."""
    global _cached_model
    if _cached_model is not None:
        return _cached_model
    with _lock:
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
        logger.info("Mask detection model loaded successfully.")
    return _cached_model


def run_mask_detection(image_bytes: bytes) -> dict[str, Any]:
    """
    Run YOLO inference on *image_bytes* and return structured detection results.

    Return shape::

        {
            "detected":   bool,           # True when ≥1 box found
            "violations": list[str],      # class names that are violations e.g. ["no_mask"]
            "boxes": [
                {
                    "class_name": str,
                    "confidence": float,  # 0.0–1.0
                    "x1": float,          # top-left x  (pixels)
                    "y1": float,          # top-left y  (pixels)
                    "x2": float,          # bottom-right x (pixels)
                    "y2": float,          # bottom-right y (pixels)
                },
                ...
            ],
        }
    """
    from PIL import Image as PILImage

    model = _load_model()
    img = PILImage.open(io.BytesIO(image_bytes)).convert("RGB")
    results = model(img, verbose=False)

    boxes_out: list[dict[str, Any]] = []
    violations: set[str] = set()

    for result in results:
        if result.boxes is None:
            continue
        for box in result.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            class_name = _CLASS_NAMES.get(cls_id, f"class_{cls_id}")
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
        "detected": len(boxes_out) > 0,
        "violations": sorted(violations),
        "boxes": boxes_out,
    }
