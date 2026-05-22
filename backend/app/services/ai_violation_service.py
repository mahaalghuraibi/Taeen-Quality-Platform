"""
YOLO-based violation detection for gloves and hairnet PPE.
Models are lazy-loaded on first call and shared across requests.
"""
from __future__ import annotations

import base64
import logging
import threading
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parents[2] / "ml" / "models"

_glove_model = None
_hairnet_model = None
_mask_model = None
_glove_lock = threading.Lock()
_hairnet_lock = threading.Lock()
_mask_lock = threading.Lock()

GLOVE_CLASS_NAMES = {0: "no_gloves", 1: "gloves"}
GLOVE_VIOLATION_CLASS_IDS = {0}
# Temporary workaround: current model tops out at ~0.54 confidence (5 epochs, not converged).
# Lowered from 0.55 so glove detections pass through at 35-54% — these surface as
# "needs_review" in the UI (conf < DB threshold) until the model is retrained.
GLOVE_CONF = 0.35
GLOVE_IOU = 0.45

HAIRNET_CLASS_NAMES = {0: "hairnet", 1: "no_hairnet"}
HAIRNET_VIOLATION_CLASS_IDS = {1}
# Temporary workaround: hairnet model fires at 0.26–0.52. Lowered from 0.55.
CONF_HAIRNET = 0.30
CONF_NO_HAIRNET = 0.30
HAIRNET_IOU = 0.45

MASK_CLASS_NAMES = {0: "mask", 1: "no_mask"}
MASK_VIOLATION_CLASS_IDS = {1}
# Temporary workaround: mask model max confidence is 0.28 (5 epochs, broken).
# Lowered from 0.60 so any detection is at least visible in logs/UI.
CONF_MASK = 0.25
CONF_NO_MASK = 0.25
MASK_IOU = 0.45


def _load_glove_model():
    global _glove_model
    if _glove_model is None:
        with _glove_lock:
            if _glove_model is None:
                from ultralytics import YOLO
                _glove_model = YOLO(str(_MODELS_DIR / "glove_best.pt"))
    return _glove_model


def _load_hairnet_model():
    global _hairnet_model
    if _hairnet_model is None:
        with _hairnet_lock:
            if _hairnet_model is None:
                from ultralytics import YOLO
                _hairnet_model = YOLO(str(_MODELS_DIR / "hairnet_best.pt"))
    return _hairnet_model


def _load_mask_model():
    global _mask_model
    if _mask_model is None:
        with _mask_lock:
            if _mask_model is None:
                from ultralytics import YOLO
                _mask_model = YOLO(str(_MODELS_DIR / "mask_best.pt"))
    return _mask_model


def _decode_image(image_bytes: bytes):
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("الصورة غير صالحة أو تالفة.")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def _annotate_and_encode(image_rgb, detections: list[dict]) -> str:
    bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
    for d in detections:
        box = d["box"]
        color = (0, 0, 200) if d["is_violation"] else (0, 180, 0)
        cv2.rectangle(bgr, (box["x1"], box["y1"]), (box["x2"], box["y2"]), color, 2)
        label = f"{d['class_name']} {d['confidence'] * 100:.0f}%"
        cv2.putText(bgr, label, (box["x1"], box["y1"] - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1, cv2.LINE_AA)
    _, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _run_glove_detection(image_rgb) -> list[dict]:
    model = _load_glove_model()
    results = model(image_rgb, verbose=False, conf=GLOVE_CONF, iou=GLOVE_IOU)
    detections = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            confidence = float(box.conf[0])
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
            detections.append({
                "class_id": cls_id,
                "class_name": GLOVE_CLASS_NAMES.get(cls_id, f"class_{cls_id}"),
                "confidence": round(confidence, 4),
                "is_violation": cls_id in GLOVE_VIOLATION_CLASS_IDS,
                "box": {"x1": round(x1), "y1": round(y1), "x2": round(x2), "y2": round(y2)},
            })
    return detections


def _run_hairnet_detection(image_rgb) -> list[dict]:
    model = _load_hairnet_model()
    raw_conf = min(CONF_HAIRNET, CONF_NO_HAIRNET)
    results = model(image_rgb, verbose=False, conf=raw_conf, iou=HAIRNET_IOU)
    detections = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            confidence = float(box.conf[0])
            threshold = CONF_NO_HAIRNET if cls_id == 1 else CONF_HAIRNET
            if confidence < threshold:
                continue
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
            detections.append({
                "class_id": cls_id,
                "class_name": HAIRNET_CLASS_NAMES.get(cls_id, f"class_{cls_id}"),
                "confidence": round(confidence, 4),
                "is_violation": cls_id in HAIRNET_VIOLATION_CLASS_IDS,
                "box": {"x1": round(x1), "y1": round(y1), "x2": round(x2), "y2": round(y2)},
            })
    return detections


def _run_mask_detection(image_rgb) -> list[dict]:
    model = _load_mask_model()
    raw_conf = min(CONF_MASK, CONF_NO_MASK)
    results = model(image_rgb, verbose=False, conf=raw_conf, iou=MASK_IOU)
    detections = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            confidence = float(box.conf[0])
            threshold = CONF_NO_MASK if cls_id in MASK_VIOLATION_CLASS_IDS else CONF_MASK
            if confidence < threshold:
                continue
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
            detections.append({
                "class_id": cls_id,
                "class_name": MASK_CLASS_NAMES.get(cls_id, f"class_{cls_id}"),
                "confidence": round(confidence, 4),
                "is_violation": cls_id in MASK_VIOLATION_CLASS_IDS,
                "box": {"x1": round(x1), "y1": round(y1), "x2": round(x2), "y2": round(y2)},
            })
    return detections


def _build_status_message(detections: list[dict], violation_type: str) -> str:
    if not detections:
        return "لم يتم الكشف عن أشخاص في الصورة."
    violations = [d for d in detections if d["is_violation"]]
    compliant = [d for d in detections if not d["is_violation"]]
    if violation_type == "no_gloves":
        if violations and compliant:
            return f"{len(violations)} شخص بدون قفازات — {len(compliant)} ملتزم."
        if violations:
            return f"{len(violations)} شخص بدون قفازات — مخالفة."
        return f"جميع الأشخاص ({len(compliant)}) يرتدون القفازات — ملتزم."
    elif violation_type == "no_mask":
        if violations and compliant:
            return f"{len(violations)} شخص بدون كمامة — {len(compliant)} ملتزم."
        if violations:
            return f"{len(violations)} شخص بدون كمامة — مخالفة."
        return f"جميع الأشخاص ({len(compliant)}) يرتدون الكمامة — ملتزم."
    else:  # no_headcover
        if violations and compliant:
            return f"{len(violations)} شخص بدون غطاء رأس — {len(compliant)} ملتزم."
        if violations:
            return f"{len(violations)} شخص بدون غطاء رأس — مخالفة."
        return f"جميع الأشخاص ({len(compliant)}) يرتدون غطاء الرأس — ملتزم."


SUPPORTED_TYPES = {"no_gloves", "no_headcover", "no_mask"}


def detect_violation(image_bytes: bytes, violation_type: str) -> dict:
    """
    Run YOLO detection for the given violation type.
    Returns: violation_detected, detection_count, detections, annotated_image, confidence, status_message
    """
    if violation_type not in SUPPORTED_TYPES:
        raise ValueError(f"نوع المخالفة غير مدعوم: {violation_type}")

    image_rgb = _decode_image(image_bytes)

    if violation_type == "no_gloves":
        detections = _run_glove_detection(image_rgb)
    elif violation_type == "no_mask":
        detections = _run_mask_detection(image_rgb)
    else:
        detections = _run_hairnet_detection(image_rgb)

    violations = [d for d in detections if d["is_violation"]]
    violation_detected = len(violations) > 0

    if violations:
        confidence = max(int(d["confidence"] * 100) for d in violations)
    elif detections:
        confidence = max(int(d["confidence"] * 100) for d in detections)
    else:
        confidence = 0

    annotated_image = _annotate_and_encode(image_rgb, detections)
    status_message = _build_status_message(detections, violation_type)

    logger.info(
        "detect_violation type=%s total=%d violations=%d conf=%d",
        violation_type, len(detections), len(violations), confidence,
    )

    return {
        "violation_detected": violation_detected,
        "detection_count": len(detections),
        "detections": detections,
        "annotated_image": annotated_image,
        "confidence": confidence,
        "status_message": status_message,
    }
