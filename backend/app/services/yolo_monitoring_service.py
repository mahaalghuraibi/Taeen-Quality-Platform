"""
YOLO-based kitchen safety monitoring (PPE per worker + scene hygiene).
Dish Gemini pipeline is separate — do not mix.

FP control (YOLO path): PPE violations require a confident person box plus geometric visibility
(face / hands / head / upper body) before surfacing mask, glove, helmet, or uniform breaches.
Worker regions default to a standard COCO YOLO person model (PERSON_MODEL_PATH / yolov8n.pt) when
PPE weights do not emit person boxes; PPE weights still perform all PPE and scene classes.
Rejected candidates are listed under frame_report.ppe_rejected_violations with stable reason codes.

Detects:
  Worker checks: no_mask, no_gloves, no_headcover, improper_uniform
  Scene checks: trash_on_floor, improper_waste_area
  Geometry: bins/trash containers overlapping each worker's prep envelope → improper_waste_area;
            standalone bins in central workspace band when no person detected (lower confidence).

Goggles / shoes outputs remain unmapped (no goggles violations).

Features retained:
- Aspect-preserving resize + tiled inference for large frames
- Ultralytics conf ~0.42; recall pass @~0.33 also emits **safe** mask/glove when conf≥26 (dark masks / phone cameras often miss the primary pass).
- Multi-worker via person boxes or spatial clustering of PPE boxes

Head-cover (no_headcover) false-positive control (YOLO path only):
- Vision heuristic uses the **center head band** (not full box width) and skips suppression when side strips are brighter (neighbor chef hats).
- Higher minimum confidence than mask/gloves (see _HEADCOVER_VIOLATION_MIN_CONF_INT).
- Per-camera + per-worker consecutive-frame streak (see _HEADCOVER_STREAK_FRAMES).
- Dark torso gap-fill (see _apply_dark_attire_gap_fill): when mask/glove breach + dark torso, infer missing uniform/helmet rows if the model omitted them.
"""
from __future__ import annotations

import gc
import io
import logging
import math
import os
import threading
from collections import Counter
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from app.core.config import settings

# Force CPU-only for Ultralytics/torch (Render free tier has no GPU).
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")

logger = logging.getLogger(__name__)

YOLO_BUSY_MESSAGE = "التحليل السابق ما زال قيد المعالجة"
_YOLO_BUSY_MESSAGE = YOLO_BUSY_MESSAGE
_YOLO_INFERENCE_LOCK = threading.Lock()
_YOLO_LOCK_WAIT_SEC = max(30, int(os.getenv("YOLO_LOCK_WAIT_SEC", "180")))
_YOLO_LOAD_LOCK = threading.Lock()
_YOLO_LOADED_PATHS: set[str] = set()

_BIN_CANDIDATE_KEY = "bin_candidate"

# ══════════════════════════════════════════════════════════════════════════════
# YOLO class name → (check_key, is_violation)
# Person-cluster checks use keys in _PERSON_CHECK_KEYS. Scene hygiene uses
# trash_floor / waste_area (not assigned per worker box).
# Unlisted classes (e.g. goggles) are skipped.
# ══════════════════════════════════════════════════════════════════════════════
_YOLO_CLASS_MAP: dict[str, tuple[str, bool]] = {
    # Mask
    "no_mask": ("mask", True),
    "no-mask": ("mask", True),
    "without_mask": ("mask", True),
    "mask_off": ("mask", True),
    "unmasked": ("mask", True),
    "face_no_mask": ("mask", True),
    "nomask": ("mask", True),
    "mask": ("mask", False),
    "with_mask": ("mask", False),
    "masked": ("mask", False),
    "face_mask": ("mask", False),
    # Gloves
    "no_glove": ("glove", True),
    "no_gloves": ("glove", True),
    "no-gloves": ("glove", True),
    "without_gloves": ("glove", True),
    "gloves_off": ("glove", True),
    "bare_hands": ("glove", True),
    "without_glove": ("glove", True),
    "noglove": ("glove", True),
    "nogloves": ("glove", True),
    "glove": ("glove", False),
    "gloves": ("glove", False),
    "with_gloves": ("glove", False),
    # Head cover / chef hat / hairnet (helmet check_key → violation type no_headcover)
    "no_helmet": ("helmet", True),
    "no-helmet": ("helmet", True),
    "no_hardhat": ("helmet", True),
    "no-hardhat": ("helmet", True),
    "no_headcover": ("helmet", True),
    "no-headcover": ("helmet", True),
    "no_hat": ("helmet", True),
    "no-hat": ("helmet", True),
    "no_cap": ("helmet", True),
    "no_hairnet": ("helmet", True),
    "nohelmet": ("helmet", True),
    "helmet": ("helmet", False),
    "hardhat": ("helmet", False),
    "headcover": ("helmet", False),
    "hat": ("helmet", False),
    "cap": ("helmet", False),
    "hairnet": ("helmet", False),
    "chef_hat": ("helmet", False),
    "chef-hat": ("helmet", False),
    "toque": ("helmet", False),
    "kitchen_hat": ("helmet", False),
    # Uniform / vest (Hansung NO-Safety Vest etc.)
    "no-safety_vest": ("uniform", True),
    "no_safety_vest": ("uniform", True),
    "no_vest": ("uniform", True),
    "no_uniform": ("uniform", True),
    "uniform_violation": ("uniform", True),
    "without_uniform": ("uniform", True),
    "no-uniform": ("uniform", True),
    "civilian": ("uniform", True),
    "improper_uniform": ("uniform", True),
    "safety_vest": ("uniform", False),
    "vest": ("uniform", False),
    "uniform": ("uniform", False),
    "with_uniform": ("uniform", False),
    "apron": ("uniform", False),
    # ── Scene hygiene (routed to trash_floor / waste_area; aggregated globally)
    "trash": ("trash_floor", True),
    "garbage": ("trash_floor", True),
    "litter": ("trash_floor", True),
    "rubbish": ("trash_floor", True),
    "debris": ("trash_floor", True),
    "food_waste": ("trash_floor", True),
    "plastic_bag": ("trash_floor", True),
    "scrap": ("trash_floor", True),
    "floor_trash": ("trash_floor", True),
    "overflowing_bin": ("waste_area", True),
    "bin_overflow": ("waste_area", True),
    "overflow": ("waste_area", True),
    "full_bin": ("waste_area", True),
    "dirty_bin": ("waste_area", True),
    "wrong_bin_location": ("waste_area", True),
    "trash_near_prep": ("waste_area", True),
    # Containers — violation only when geometry places them in/near worker prep zone
    "bin": (_BIN_CANDIDATE_KEY, False),
    "trash_can": (_BIN_CANDIDATE_KEY, False),
    "garbage_can": (_BIN_CANDIDATE_KEY, False),
    "waste_bin": (_BIN_CANDIDATE_KEY, False),
    "trash_bin": (_BIN_CANDIDATE_KEY, False),
    "garbage_bin": (_BIN_CANDIDATE_KEY, False),
    "recycling_bin": (_BIN_CANDIDATE_KEY, False),
    "wheelie_bin": (_BIN_CANDIDATE_KEY, False),
    "dustbin": (_BIN_CANDIDATE_KEY, False),
    "dumpster": (_BIN_CANDIDATE_KEY, False),
    "wastebasket": (_BIN_CANDIDATE_KEY, False),
    "trashcan": (_BIN_CANDIDATE_KEY, False),
    "rubbish_bin": (_BIN_CANDIDATE_KEY, False),
}

_SCENE_CLUSTER_KEYS: frozenset[str] = frozenset({"trash_floor", "waste_area"})
# Routed to scene_flat but not aggregated as violations until geometry / explicit model class fires.
_SCENE_ROUTING_KEYS: frozenset[str] = frozenset({"trash_floor", "waste_area", _BIN_CANDIDATE_KEY})

_PERSON_CHECK_KEYS: frozenset[str] = frozenset({"mask", "glove", "helmet", "uniform"})

_CHECK_ORDER = ("mask", "glove", "helmet", "uniform")

_PERSON_CLASSES: frozenset[str] = frozenset({
    "person", "worker", "staff", "employee", "human", "people",
})

_REASON_AR: dict[str, dict[str, str]] = {
    "mask": {
        "violation": "عدم ارتداء الكمامة أو تغطية الوجه بشكل مناسب.",
        "safe": "الكمامة أو التغطية واضحة.",
        "uncertain": "لا يمكن التحقق من الكمامة في هذه اللقطة.",
    },
    "glove": {
        "violation": "يدان بدون قفازات أو يد ظاهرة جزئيًا بدون قفاز.",
        "safe": "القفازات ظاهرة على اليدين.",
        "uncertain": "لا يمكن التحقق من القفازات (اليد غير واضحة).",
    },
    "helmet": {
        "violation": "عدم ارتداء غطاء الرأس أو قبعة الشيف / شبكة الشعر.",
        "safe": "غطاء الرأس أو قبعة الشيف أو شبكة الشعر ظاهر.",
        "uncertain": "لا يمكن التحقق من غطاء الرأس.",
    },
    "uniform": {
        "violation": "عدم ارتداء الزي الرسمي المناسب للمطبخ أو غياب سترة العمل.",
        "safe": "الزي الرسمي أو سترة العمل ظاهرة.",
        "uncertain": "لا يمكن التحقق من الزي الرسمي.",
    },
    "trash_floor": {
        "violation": "توجد نفايات أو بقايا ظاهرة على الأرض أو منطقة المشي.",
        "safe": "الأرضية تبدو نظيفة من النفايات المرئية.",
        "uncertain": "لا يمكن تأكيد نظافة الأرض من هذه اللقطة.",
    },
    "waste_area": {
        "violation": "موقع الحاوية أو منطقة جمع النفايات غير ملائم، أو حاوية ممتلئة/متسخة أو قريبة جداً من التحضير.",
        "safe": "منطقة النفايات تبدو ملائمة وبعيدة عن التحضير المباشر.",
        "uncertain": "لا يمكن تقييم موقع الحاويات من هذه اللقطة.",
    },
}

_VIOLATION_TYPES: dict[str, str] = {
    "mask": "no_mask",
    "glove": "no_gloves",
    "helmet": "no_headcover",
    "uniform": "improper_uniform",
}

_LABEL_VIOLATION_AR: dict[str, str] = {
    "no_mask": "عدم ارتداء الكمامة",
    "no_gloves": "عدم ارتداء القفازات",
    "no_headcover": "عدم ارتداء غطاء الرأس / قبعة الشيف",
    "improper_uniform": "عدم ارتداء الزي الرسمي",
    "trash_on_floor": "نفايات على الأرض",
    "improper_waste_area": "موقع النفايات غير ملائم",
}

_YOLO_CONF: float = 0.42
# Second pass: must be low enough that Ultralytics returns weak mask/glove boxes (black masks / phone cam often 30–39%).
_YOLO_CONF_RECALL: float = 0.33
_MIN_BOX_CONF_INT: int = 26
# Recall pass (lower YOLO conf) drops safe boxes by design — except mask/glove safe signals needed for dark masks / dim light.
_MIN_RECALL_SAFE_MASK_GLOVE_CONF_INT: int = 26
# COCO person-only detector (YOLOv8n/s hub or PERSON_MODEL_PATH).
_PERSON_DETECT_CONF_FLOAT: float = 0.28
_COCO_PERSON_CLASS_ID: int = 0

# Person detection must pass before any per-worker PPE violation is surfaced (reduces orphan-PPE false positives).
_MIN_GOOD_PERSON_CONF_INT: int = 38
_MIN_PERSON_BOX_AREA_FRAC: float = 0.0016

# Conservative geometric gates: require enough on-frame resolution before implying mask/gloves/head/uniform breaches.
_VFACE_MIN_AREA_FRAC: float = 0.0026
_VFACE_MIN_BH_FRAC: float = 0.050
# Portrait / phone selfie: person strip can be narrow vs frame width — old 0.024 hid valid faces.
_VFACE_MIN_BW_FRAC: float = 0.017

_VHAND_MIN_AREA_FRAC: float = 0.0030
_VHAND_MIN_BH_FRAC: float = 0.078

_VHEAD_MIN_AREA_FRAC: float = 0.0024
_VHEAD_MIN_BH_FRAC: float = 0.046

_VTORSO_MIN_AREA_FRAC: float = 0.0042
_VTORSO_MIN_BH_FRAC: float = 0.092

# Head-cover: slightly higher bar than mask/gloves for FP control; kept below old 0.62–0.65 to reduce false negatives.
_HEADCOVER_VIOLATION_MIN_CONF_INT: int = 58  # ~0.58; mask/gloves unchanged below
# Require this many consecutive analyzed frames with a pending head-cover breach before surfacing an alert.
_HEADCOVER_STREAK_FRAMES: int = 2
_HAT_HEURISTIC_SAFE_CONF: int = 78
# Inferred PPE rows when the model omits classes but the crop clearly shows dark non-kitchen attire (see _apply_dark_attire_gap_fill).
_DARK_ATTIRE_INFERRED_CONF: int = 58
# Torso band mean luminance below this → likely dark shirt / non-white jacket (kitchen policy gap fill).
_DARK_TORSO_LUM_MAX: float = 132.0

_VIOLATION_THRESHOLDS_INT: dict[str, int] = {
    "no_mask": 40,
    "no_gloves": 38,
    "no_headcover": _HEADCOVER_VIOLATION_MIN_CONF_INT,
    "improper_uniform": 40,
    "trash_on_floor": 38,
    "improper_waste_area": 40,
}

_TILE_SIZE: int = 640
_TILE_OVERLAP: int = 128
_YOLO_MAX_EDGE: int = int(getattr(settings, "YOLO_MAX_EDGE", 640) or 640)
_MIN_CLUSTER_AREA_FRAC: float = 0.00006

_FLOOR_CY_MIN: float = 0.46
_YOLO_CONF_WASTE: float = 0.39

_TRASH_WORD_PARTS: frozenset[str] = frozenset({
    "trash", "garbage", "litter", "rubbish", "waste", "debris", "scrap", "leftover",
})
_BIN_BAD_PARTS: frozenset[str] = frozenset({
    "overflow", "full_bin", "dirty_bin", "wrong_bin", "near_prep", "disposal",
})
# Compound substrings / tails — avoids bare "can" (matches candle/american etc.).
_BIN_LIKE_SUBSTRINGS: tuple[str, ...] = (
    "trash_can",
    "garbage_can",
    "waste_bin",
    "trash_bin",
    "garbage_bin",
    "rubbish_bin",
    "recycling_bin",
    "wheelie_bin",
    "dustbin",
    "dumpster",
    "wastebasket",
    "trashcan",
)

_PREP_ZONE_SIDE_PAD_FRAC: float = 0.38
_PREP_ZONE_DOWN_FRAC: float = 0.42
_PREP_ZONE_TORSO_FRAC: float = 0.32
_GEOM_BIN_IOU_MIN: float = 0.028
_ORPHAN_BIN_NORM_X0: float = 0.18
_ORPHAN_BIN_NORM_X1: float = 0.82
_ORPHAN_BIN_NORM_Y0: float = 0.22
_ORPHAN_BIN_NORM_Y1: float = 0.80
_ORPHAN_BIN_CONF_CAP: int = 58

_YOLO_MODEL_CACHE: dict[str, Any] = {}

# ── Head-cover false-positive filtering (temporal + vision heuristics, in-memory only) ──────────
_headcover_streak_lock = threading.Lock()
# (camera_key, person_index_1based) -> consecutive frame count for pending no_headcover reports
_headcover_streak_by_cam_person: dict[tuple[str, int], int] = {}

# When glove violation competes with glove safe, favour violation if within this gap (recall).
_IMPLICIT_VIOLATION_CONF: int = 40
# Only infer missing mask/glove violations when another PPE breach exists — never helmet/uniform:
# safe hat & jacket are often absent from class lists; filling those causes false alerts.
_IMPLICIT_FILL_CHECKS: frozenset[str] = frozenset({"mask", "glove"})


def _is_bin_like_class(cls_name: str) -> bool:
    """Whether the label likely denotes a bin/container (used when model omits explicit violation classes)."""
    n = cls_name.strip().lower().replace("-", "_")
    if not n:
        return False
    mapped = _YOLO_CLASS_MAP.get(n)
    if mapped is not None:
        return mapped[0] == _BIN_CANDIDATE_KEY
    if any(s in n for s in _BIN_LIKE_SUBSTRINGS):
        return True
    parts = n.split("_")
    return len(parts) >= 2 and parts[-1] == "bin"


def _resolve_person_model_path() -> str | None:
    """
    Absolute/local path or Ultralytics hub weights id (e.g. yolov8n.pt — may auto-download).
    None => skip separate person detector; use PPE-model person classes as today.
    """
    if not settings.YOLO_USE_PERSON_DETECTOR:
        return None
    configured = (settings.PERSON_MODEL_PATH or "").strip()
    backend_root = Path(__file__).resolve().parents[2]
    if configured:
        expanded = Path(configured).expanduser()
        if expanded.is_file():
            return expanded.resolve().as_posix()
        if "/" in configured or "\\" in configured:
            logger.warning("PERSON_MODEL_PATH file not found: %s — person detector skipped.", configured)
            return None
        return configured.strip()
    default_local = backend_root / "ml" / "models" / "yolov8n.pt"
    if default_local.is_file():
        return default_local.resolve().as_posix()
    return "yolov8n.pt"


def _yolo_imgsz_for_image(width: int, height: int) -> int:
    long_edge = min(max(width, height), _YOLO_MAX_EDGE)
    return max(32, int(math.ceil(long_edge / 32.0) * 32))


def _yolo_predict_cpu(model: Any, image: Any, *, conf: float, classes: list[int] | None = None) -> Any:
    w, h = image.size
    kwargs: dict[str, Any] = {
        "verbose": False,
        "conf": conf,
        "device": "cpu",
        "half": False,
        "imgsz": _yolo_imgsz_for_image(w, h),
    }
    if classes is not None:
        kwargs["classes"] = classes
    return model.predict(image, **kwargs)


def _load_yolo(model_path: str) -> Any:
    if model_path in _YOLO_MODEL_CACHE:
        return _YOLO_MODEL_CACHE[model_path]

    with _YOLO_LOAD_LOCK:
        if model_path in _YOLO_MODEL_CACHE:
            return _YOLO_MODEL_CACHE[model_path]

        try:
            from ultralytics import YOLO
        except ImportError:
            raise ValueError(
                "مكتبة ultralytics غير مثبتة. "
                "في مجلد backend نفّذ: pip install ultralytics"
            ) from None

        try:
            model = YOLO(model_path)
            model.to("cpu")
            _YOLO_MODEL_CACHE[model_path] = model
            if model_path not in _YOLO_LOADED_PATHS:
                _YOLO_LOADED_PATHS.add(model_path)
                logger.info("YOLO model loaded successfully path=%s device=cpu", model_path)
            return model
        except FileNotFoundError:
            raise ValueError(
                f"ملف نموذج YOLO غير موجود: {model_path}. "
                "تحقق من مسار الملف في backend/.env"
            ) from None
        except Exception as exc:
            raise ValueError(f"فشل تحميل نموذج YOLO: {exc}") from exc


def _get_yolo_model() -> Any:
    if not settings.YOLO_ENABLED:
        raise ValueError("YOLO is disabled (YOLO_ENABLED=false).")

    from app.services.yolo_model_resolver import missing_model_user_message, resolve_yolo_model_path

    model_path = resolve_yolo_model_path(allow_download=True)
    if not model_path:
        raise ValueError(missing_model_user_message())
    return _load_yolo(model_path)


def _release_yolo_inference_memory() -> None:
    gc.collect()


@contextmanager
def _yolo_analysis_slot(*, wait: bool = True) -> Iterator[None]:
    """
    Serialize YOLO inference (one frame at a time on CPU).
    wait=True: block until slot free (manual / upload analysis).
    wait=False: fail fast when busy (live stream drops frame instead of queueing).
    """
    if wait:
        acquired = _YOLO_INFERENCE_LOCK.acquire(blocking=True, timeout=_YOLO_LOCK_WAIT_SEC)
        if not acquired:
            raise ValueError("انتهت مهلة انتظار التحليل. حاول مرة أخرى بعد قليل.")
    elif not _YOLO_INFERENCE_LOCK.acquire(blocking=False):
        raise ValueError(_YOLO_BUSY_MESSAGE)
    try:
        yield
    finally:
        _release_yolo_inference_memory()
        _YOLO_INFERENCE_LOCK.release()


def _resolve_aux_waste_model_path() -> str:
    raw = (settings.YOLO_WASTE_MODEL_PATH or "").strip()
    if not raw:
        return ""
    p = Path(raw).expanduser().resolve()
    if p.exists() and p.is_file():
        return p.as_posix()
    logger.warning("YOLO_WASTE_MODEL_PATH غير موجود أو غير قابل للقراءة: %s", raw)
    return ""


def _aux_class_to_scene_item(cls_name: str, conf_int: int, gx: list[float], ih: int) -> dict[str, Any] | None:
    """Map auxiliary-model raw class names into trash_floor / waste_area / bin_candidate."""
    if cls_name in _YOLO_CLASS_MAP:
        ck, is_v = _YOLO_CLASS_MAP[cls_name]
        if ck == _BIN_CANDIDATE_KEY:
            return {"class_name": cls_name, "check_key": ck, "is_violation": False, "confidence": conf_int, "xyxy": gx}
        if ck in _SCENE_CLUSTER_KEYS and is_v:
            return {"class_name": cls_name, "check_key": ck, "is_violation": True, "confidence": conf_int, "xyxy": gx}
    if _is_bin_like_class(cls_name):
        return {"class_name": cls_name, "check_key": _BIN_CANDIDATE_KEY, "is_violation": False, "confidence": conf_int, "xyxy": gx}
    cy_n = _center(gx)[1] / max(ih, 1)
    if any(p in cls_name for p in _BIN_BAD_PARTS):
        return {"class_name": cls_name, "check_key": "waste_area", "is_violation": True, "confidence": conf_int, "xyxy": gx}
    if any(p in cls_name for p in _TRASH_WORD_PARTS):
        ck = "trash_floor" if cy_n >= _FLOOR_CY_MIN else "waste_area"
        return {"class_name": cls_name, "check_key": ck, "is_violation": True, "confidence": conf_int, "xyxy": gx}
    return None


def _run_aux_waste_scene_detections(model_path: str, pil_rgb: Any, img_w: int, img_h: int) -> list[dict[str, Any]]:
    model = _load_yolo(model_path)
    out: list[dict[str, Any]] = []
    tiles = _tiles_from_image(pil_rgb, img_w, img_h)
    for tile_img, x_off, y_off, cw, ch in tiles:
        try:
            results = _yolo_predict_cpu(model, tile_img, conf=_YOLO_CONF_WASTE)
        except Exception as exc:
            logger.warning("YOLO waste tile (%d,%d) failed: %s", x_off, y_off, exc)
            continue
        for result in results:
            if result.boxes is None:
                continue
            names = result.names or {}
            for box in result.boxes:
                conf_val = float(box.conf[0]) if box.conf is not None else 0.0
                cls_id = int(box.cls[0]) if box.cls is not None else -1
                raw_name = str(names.get(cls_id, "")).strip()
                cls_name = raw_name.lower().replace(" ", "_").replace("-", "_")
                if not cls_name:
                    continue
                conf_int = int(round(conf_val * 100))
                if conf_int < _MIN_BOX_CONF_INT:
                    continue
                xy = box.xyxy[0].tolist()
                gx = _map_tile_box_to_global([float(xy[0]), float(xy[1]), float(xy[2]), float(xy[3])], x_off, y_off, cw, ch)
                item = _aux_class_to_scene_item(cls_name, conf_int, gx, img_h)
                if item is not None:
                    out.append(item)
    logger.info("YOLO auxiliary hygiene pass: boxes=%d model=%s", len(out), model_path)
    return out


def _bbox_area(xyxy: list[float]) -> float:
    return max(0.0, xyxy[2] - xyxy[0]) * max(0.0, xyxy[3] - xyxy[1])


def _iou(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0.0, ix2 - ix1)
    ih_box = max(0.0, iy2 - iy1)
    inter = iw * ih_box
    if inter <= 0:
        return 0.0
    ua = _bbox_area(a) + _bbox_area(b) - inter
    return inter / ua if ua > 0 else 0.0


def _center(xyxy: list[float]) -> tuple[float, float]:
    return (xyxy[0] + xyxy[2]) / 2.0, (xyxy[1] + xyxy[3]) / 2.0


def _center_inside(xyxy: list[float], cx: float, cy: float) -> bool:
    return xyxy[0] <= cx <= xyxy[2] and xyxy[1] <= cy <= xyxy[3]


def _person_prep_envelope(pb: list[float], iw: int, ih: int) -> list[float]:
    """Expanded box around a worker: sideways reach + floor strip for bins at feet/counter."""
    x1, y1, x2, y2 = pb
    w = max(1.0, x2 - x1)
    h = max(1.0, y2 - y1)
    pad_x = _PREP_ZONE_SIDE_PAD_FRAC * w
    y_torso = y1 + _PREP_ZONE_TORSO_FRAC * h
    y_feet = min(float(ih), y2 + _PREP_ZONE_DOWN_FRAC * h)
    x1e = max(0.0, x1 - pad_x)
    x2e = min(float(iw), x2 + pad_x)
    y1e = max(0.0, y_torso - 0.08 * h)
    y2e = y_feet
    return [x1e, y1e, x2e, y2e]


def _prep_zone_bin_overlap(bin_xy: list[float], envelope_xy: list[float]) -> bool:
    if _iou(bin_xy, envelope_xy) >= _GEOM_BIN_IOU_MIN:
        return True
    cx, cy = _center(bin_xy)
    return _center_inside(envelope_xy, cx, cy)


def _norm_center_in_workspace_band(xyxy: list[float], iw: int, ih: int) -> bool:
    cx, cy = _center(xyxy)
    nx = cx / max(iw, 1)
    ny = cy / max(ih, 1)
    return (
        _ORPHAN_BIN_NORM_X0 <= nx <= _ORPHAN_BIN_NORM_X1
        and _ORPHAN_BIN_NORM_Y0 <= ny <= _ORPHAN_BIN_NORM_Y1
    )


def _apply_geometry_waste_rules(
    scene_flat: list[dict[str, Any]],
    person_boxes: list[list[float]],
    iw: int,
    ih: int,
) -> None:
    """
    From neutral bin detections, emit improper_waste_area when a bin intersects a worker prep envelope,
    or (fallback) sits in the central workspace band while no person box exists.
    Mutates scene_flat in place.
    """
    bins = [d for d in scene_flat if d.get("check_key") == _BIN_CANDIDATE_KEY]
    if not bins:
        return

    th_geom = int(_VIOLATION_THRESHOLDS_INT.get("improper_waste_area", 40))

    if person_boxes:
        envelopes = [_person_prep_envelope(pb, iw, ih) for pb in person_boxes]
        for bdet in bins:
            bx = bdet["xyxy"]
            bc = int(bdet["confidence"])
            matched = any(_prep_zone_bin_overlap(bx, env) for env in envelopes)
            if matched:
                synth_cf = min(95, max(th_geom, bc + 12))
                scene_flat.append({
                    "class_name": "geom_bin_near_prep",
                    "check_key": "waste_area",
                    "is_violation": True,
                    "confidence": synth_cf,
                    "xyxy": bx,
                })
        logger.info(
            "YOLO geometry hygiene: bin_candidates=%d persons=%d geom_flags=%d",
            len(bins),
            len(person_boxes),
            sum(1 for d in scene_flat if d.get("class_name") == "geom_bin_near_prep"),
        )
        return

    # No person boxes: weak signal — bin in typical prep/counter band only
    for bdet in bins:
        bx = bdet["xyxy"]
        bc = int(bdet["confidence"])
        if not _norm_center_in_workspace_band(bx, iw, ih):
            continue
        synth_cf = min(_ORPHAN_BIN_CONF_CAP, max(th_geom, bc + 5))
        scene_flat.append({
            "class_name": "geom_bin_workspace_fallback",
            "check_key": "waste_area",
            "is_violation": True,
            "confidence": synth_cf,
            "xyxy": bx,
        })
    logger.info(
        "YOLO geometry hygiene (no persons): bin_candidates=%d fallback_flags=%d",
        len(bins),
        sum(1 for d in scene_flat if d.get("class_name") == "geom_bin_workspace_fallback"),
    )


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _merge_boxes_xyxy(boxes: list[list[float]]) -> list[float]:
    if not boxes:
        return [0.0, 0.0, 0.0, 0.0]
    x1 = min(b[0] for b in boxes)
    y1 = min(b[1] for b in boxes)
    x2 = max(b[2] for b in boxes)
    y2 = max(b[3] for b in boxes)
    return [x1, y1, x2, y2]


def _nms_person_boxes(boxes: list[list[float]], iou_thresh: float = 0.55) -> list[list[float]]:
    if not boxes:
        return []
    sorted_boxes = sorted(boxes, key=lambda b: _bbox_area(b), reverse=True)
    kept: list[list[float]] = []
    for b in sorted_boxes:
        if any(_iou(b, k) > iou_thresh for k in kept):
            continue
        kept.append(b)
    return kept


def _nms_person_entries(entries: list[tuple[list[float], int]], iou_thresh: float = 0.55) -> list[tuple[list[float], int]]:
    """NMS on person boxes; sort by confidence so stronger detections win overlaps."""
    if not entries:
        return []
    sorted_entries = sorted(entries, key=lambda e: e[1], reverse=True)
    kept: list[tuple[list[float], int]] = []
    for box, cf in sorted_entries:
        if any(_iou(box, k[0]) > iou_thresh for k in kept):
            continue
        kept.append((box, cf))
    return kept


def _infer_coco_person_boxes(pil_rgb: Any) -> tuple[list[tuple[list[float], int]], bool, str | None, int]:
    """
    Standard YOLO person detection (COCO class person only).
    Returns (NMS merged entries, ran_successfully, source_path_or_hub_id, raw_person_dets_before_nms).
    On failure: ([], False, None, 0) → caller uses PPE-model person classes for boxes.
    """
    resolved = _resolve_person_model_path()
    if resolved is None:
        return [], False, None, 0
    try:
        model = _load_yolo(resolved)
    except Exception as exc:
        logger.warning(
            "person_model_failed load_or_init src=%s error=%s — using PPE model person classes only.",
            resolved,
            exc,
        )
        return [], False, None, 0

    try:
        res = _yolo_predict_cpu(
            model,
            pil_rgb,
            conf=_PERSON_DETECT_CONF_FLOAT,
            classes=[_COCO_PERSON_CLASS_ID],
        )
    except Exception as exc:
        logger.warning("person_model_failed predict src=%s error=%s", resolved, exc)
        return [], False, resolved, 0

    entries: list[tuple[list[float], int]] = []
    for result in res:
        if result.boxes is None:
            continue
        for box in result.boxes:
            conf_int = int(round(float(box.conf[0]) * 100))
            if conf_int < _MIN_BOX_CONF_INT:
                continue
            xy = box.xyxy[0].tolist()
            entries.append(([float(xy[0]), float(xy[1]), float(xy[2]), float(xy[3])], conf_int))

    merged = _nms_person_entries(entries)
    logger.info(
        "person_model_loaded src=%s raw_detections=%d merged_person_boxes=%d",
        resolved,
        len(entries),
        len(merged),
    )
    return merged, True, resolved, len(entries)


def _ppe_det_near_any_person(
    xyxy: list[float],
    person_boxes: list[list[float]],
    iw: int,
    ih: int,
    *,
    check_key: str | None = None,
) -> bool:
    """True if PPE box overlaps or sits near a worker region (expanded person bbox)."""
    if not person_boxes:
        return True
    cx, cy = _center(xyxy)
    diag = math.hypot(float(iw), float(ih))
    # Face/hands boxes are small vs COCO torso — allow a bit more slack than generic PPE.
    base = max(36.0, 0.048 * diag)
    pad = base * (1.18 if check_key in ("mask", "glove") else 1.0)
    for pb in person_boxes:
        if _iou(xyxy, pb) > 0.014:
            return True
        x1, y1, x2, y2 = pb
        if x1 - pad <= cx <= x2 + pad and y1 - pad <= cy <= y2 + pad:
            return True
    return False


def _filter_ppe_by_person_boxes(
    ppe_flat: list[dict[str, Any]],
    person_boxes: list[list[float]],
    iw: int,
    ih: int,
) -> list[dict[str, Any]]:
    """Drop orphan PPE tiles not attributable to any detected worker region."""
    if not person_boxes:
        return list(ppe_flat)
    return [
        d
        for d in ppe_flat
        if _ppe_det_near_any_person(
            d["xyxy"], person_boxes, iw, ih, check_key=str(d.get("check_key", "") or "")
        )
    ]


def _worker_person_quality(
    gi: int,
    person_boxes: list[list[float]],
    person_confs: list[int],
    iw: int,
    ih: int,
) -> bool:
    """True when this cluster index is backed by a sufficiently large, confident person detection."""
    if gi >= len(person_boxes) or not person_boxes:
        return False
    box = person_boxes[gi]
    conf = int(person_confs[gi]) if gi < len(person_confs) else 0
    ia = float(max(iw * ih, 1))
    ar = _bbox_area(box) / ia
    return conf >= _MIN_GOOD_PERSON_CONF_INT and ar >= _MIN_PERSON_BOX_AREA_FRAC


def _ppe_visibility_flags(bbox: list[float] | None, iw: int, ih: int) -> dict[str, bool]:
    """Region visibility proxies for mask / gloves / head / uniform (geometry-only, conservative)."""
    if not bbox or iw <= 0 or ih <= 0:
        return {"face_ok": False, "hands_ok": False, "head_ok": False, "upper_body_ok": False}
    x1, y1, x2, y2 = bbox
    bw = max(0.0, float(x2 - x1))
    bh = max(0.0, float(y2 - y1))
    ia = float(iw * ih)
    area_frac = (bw * bh) / ia if ia else 0.0
    bh_n = bh / float(ih)
    bw_n = bw / float(iw)

    # Close-up (large vertical share of frame): relax width gate — typical front-camera framing.
    close_portrait = bh_n >= 0.092 and area_frac >= _VFACE_MIN_AREA_FRAC * 1.05
    face_ok = area_frac >= _VFACE_MIN_AREA_FRAC * 0.95 and (
        (bh_n >= _VFACE_MIN_BH_FRAC and bw_n >= _VFACE_MIN_BW_FRAC)
        or (close_portrait and bw_n >= max(0.012, _VFACE_MIN_BW_FRAC * 0.7))
    )
    hands_ok = area_frac >= _VHAND_MIN_AREA_FRAC and bh_n >= _VHAND_MIN_BH_FRAC
    head_ok = area_frac >= _VHEAD_MIN_AREA_FRAC and bh_n >= _VHEAD_MIN_BH_FRAC and bw_n >= 0.022
    upper_body_ok = area_frac >= _VTORSO_MIN_AREA_FRAC and bh_n >= _VTORSO_MIN_BH_FRAC

    return {
        "face_ok": face_ok,
        "hands_ok": hands_ok,
        "head_ok": head_ok,
        "upper_body_ok": upper_body_ok,
    }


def _gloves_visibility_ok(vis: dict[str, bool], cluster: list[dict[str, Any]], bbox: list[float] | None) -> bool:
    """Hands zone visible in geometry, or model placed a glove box on this worker (incl. raised hands near face)."""
    if vis.get("hands_ok"):
        return True
    # If YOLO emitted any glove-class box in this cluster, trust it for visibility (selfies often fail bh/area heuristics).
    if any(str(d.get("check_key", "")) == "glove" for d in cluster):
        return True
    if not bbox:
        return False
    x1, y1, x2, y2 = bbox
    bh = max(1.0, float(y2 - y1))
    band_top = y1 + 0.36 * bh
    for d in cluster:
        if str(d.get("check_key", "")) != "glove":
            continue
        cy = _center(d["xyxy"])[1]
        if cy >= band_top:
            return True
    return False


def _resize_image_for_inference(img: Any) -> tuple[Any, int, int]:
    """Downscale only — longest side capped at YOLO_MAX_EDGE (default 640)."""
    from PIL import Image as PILImage

    w, h = img.size
    long_edge = max(w, h)
    if long_edge > _YOLO_MAX_EDGE:
        scale = _YOLO_MAX_EDGE / long_edge
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        img = img.resize((nw, nh), PILImage.Resampling.LANCZOS)
        w, h = nw, nh
    return img, w, h


def _tile_starts(dim: int) -> list[int]:
    if dim <= _TILE_SIZE:
        return [0]
    stride = _TILE_SIZE - _TILE_OVERLAP
    starts: list[int] = [0]
    while True:
        nxt = starts[-1] + stride
        if nxt + _TILE_SIZE >= dim:
            nxt = dim - _TILE_SIZE
        if nxt <= starts[-1]:
            break
        starts.append(nxt)
        if starts[-1] + _TILE_SIZE >= dim:
            break
    return starts


def _tiles_from_image(img: Any, w: int, h: int) -> list[tuple[Any, int, int, int, int]]:
    from PIL import Image as PILImage

    tiles: list[tuple[Any, int, int, int, int]] = []
    if w <= _TILE_SIZE and h <= _TILE_SIZE:
        cw, ch = w, h
        if cw < _TILE_SIZE or ch < _TILE_SIZE:
            padded = PILImage.new("RGB", (_TILE_SIZE, _TILE_SIZE), (114, 114, 114))
            padded.paste(img, (0, 0))
            tile_img = padded
        else:
            tile_img = img
        tiles.append((tile_img, 0, 0, cw, ch))
        return tiles

    for y0 in _tile_starts(h):
        for x0 in _tile_starts(w):
            x1 = min(x0 + _TILE_SIZE, w)
            y1 = min(y0 + _TILE_SIZE, h)
            crop = img.crop((x0, y0, x1, y1))
            cw, ch = crop.size
            if cw < _TILE_SIZE or ch < _TILE_SIZE:
                padded = PILImage.new("RGB", (_TILE_SIZE, _TILE_SIZE), (114, 114, 114))
                padded.paste(crop, (0, 0))
                tile_img = padded
            else:
                tile_img = crop
            tiles.append((tile_img, x0, y0, cw, ch))
    return tiles


def _map_tile_box_to_global(
    xyxy_tile: list[float],
    x0: int,
    y0: int,
    content_w: int,
    content_h: int,
) -> list[float]:
    sx = content_w / float(_TILE_SIZE)
    sy = content_h / float(_TILE_SIZE)
    gx1 = x0 + xyxy_tile[0] * sx
    gy1 = y0 + xyxy_tile[1] * sy
    gx2 = x0 + xyxy_tile[2] * sx
    gy2 = y0 + xyxy_tile[3] * sy
    return [gx1, gy1, gx2, gy2]


def _cluster_ppe_into_people(
    detections: list[dict[str, Any]],
    img_w: int,
    img_h: int,
) -> list[list[dict[str, Any]]]:
    if not detections:
        return []
    diag = math.hypot(img_w, img_h)
    merge_dist = max(90.0, min(diag * 0.18, 420.0))

    n = len(detections)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    centers = [_center(d["xyxy"]) for d in detections]
    for i in range(n):
        for j in range(i + 1, n):
            if _distance(centers[i], centers[j]) <= merge_dist:
                union(i, j)
            elif _iou(detections[i]["xyxy"], detections[j]["xyxy"]) > 0.08:
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(n):
        r = find(i)
        clusters.setdefault(r, []).append(i)

    img_area = float(img_w * img_h)
    groups: list[list[dict[str, Any]]] = []
    for idxs in clusters.values():
        cluster_dets = [detections[k] for k in idxs]
        ub = _merge_boxes_xyxy([d["xyxy"] for d in cluster_dets])
        if _bbox_area(ub) / img_area < _MIN_CLUSTER_AREA_FRAC:
            continue
        groups.append(cluster_dets)
    return groups


def _assign_detections_to_persons(
    person_boxes: list[list[float]],
    detections: list[dict[str, Any]],
    img_w: int,
    img_h: int,
) -> list[list[dict[str, Any]]]:
    if person_boxes:
        assigns: list[list[dict[str, Any]]] = [[] for _ in person_boxes]
        orphans: list[dict[str, Any]] = []
        for d in detections:
            cx, cy = _center(d["xyxy"])
            best_i = -1
            best_score = 0.0
            for i, pb in enumerate(person_boxes):
                iou_v = _iou(pb, d["xyxy"])
                score = iou_v
                if _center_inside(pb, cx, cy):
                    score = max(score, 0.12 + iou_v)
                if score > best_score:
                    best_score = score
                    best_i = i
            if best_i >= 0 and best_score >= 0.03:
                assigns[best_i].append(d)
            else:
                orphans.append(d)
        if orphans:
            clusters = _cluster_ppe_into_people(orphans, img_w, img_h)
            for c in clusters:
                assigns.append(c)
        return [a for a in assigns if a]

    return _cluster_ppe_into_people(detections, img_w, img_h)


def _person_score_for_checks(cluster_dets: list[dict[str, Any]]) -> dict[str, tuple[str, int]]:
    best_vio: dict[str, int] = {}
    best_safe: dict[str, int] = {}
    for d in cluster_dets:
        ck = d["check_key"]
        if ck not in _PERSON_CHECK_KEYS:
            continue
        conf = d["confidence"]
        if d["is_violation"]:
            best_vio[ck] = max(best_vio.get(ck, -1), conf)
        else:
            best_safe[ck] = max(best_safe.get(ck, -1), conf)

    out: dict[str, tuple[str, int]] = {}
    for ck in _CHECK_ORDER:
        v = best_vio.get(ck, -1)
        s = best_safe.get(ck, -1)
        if v < 0 and s < 0:
            continue
        # When both fire (common at low conf / competing heads), take the higher-confidence label —
        # avoids masking a clear "with_mask" with a weak "no_mask" from recall noise.
        if v >= 0 and s >= 0:
            out[ck] = ("safe", s) if s >= v else ("violation", v)
        elif s >= 0:
            out[ck] = ("safe", s)
        elif v >= 0:
            out[ck] = ("violation", v)
    return out


def _scene_checks_from_persons(
    person_states: list[dict[str, tuple[str, int]]],
    merged_person_boxes: int,
    clusters_len: int,
) -> list[dict[str, Any]]:
    agg_vio: dict[str, int] = {}
    agg_safe: dict[str, int] = {}
    for ps in person_states:
        for ck, (st, cf) in ps.items():
            if st == "violation":
                agg_vio[ck] = max(agg_vio.get(ck, -1), cf)
            else:
                agg_safe[ck] = max(agg_safe.get(ck, -1), cf)

    checks: list[dict[str, Any]] = []
    rsn = _REASON_AR
    for ck in _CHECK_ORDER:
        reasons = rsn[ck]
        v = agg_vio.get(ck, -1)
        s = agg_safe.get(ck, -1)
        if v >= 0 and (s < 0 or v >= s - 5):
            checks.append({"key": ck, "status": "violation", "confidence": v, "reason_ar": reasons["violation"]})
        elif s >= 0:
            checks.append({"key": ck, "status": "safe", "confidence": s, "reason_ar": reasons["safe"]})
        else:
            checks.append({"key": ck, "status": "uncertain", "confidence": 0, "reason_ar": reasons["uncertain"]})

    # Headcount: max(person boxes, PPE clusters). Under-counting happens when only one signal fires.
    pb = int(merged_person_boxes or 0)
    cl = int(clusters_len or 0)
    est_people = max(pb, cl)
    if est_people > 0:
        mismatch = pb > 0 and cl > 0 and pb != cl
        base_conf = 74 if mismatch else 88
        pc_conf = min(94, base_conf + min(est_people - 1, 3) * 2)
    else:
        pc_conf = 42
    checks.append({
        "key": "people_count",
        "status": "safe",
        "confidence": pc_conf,
        "reason_ar": f"عدد العمال المقدَّر من الرصد: {est_people}.",
        "count": est_people,
    })
    return checks


def _risk_level(violations: list[dict[str, Any]]) -> tuple[str, str]:
    if not violations:
        return "low", "منخفض"
    max_c = max(int(v["confidence"]) for v in violations)
    n = len(violations)
    if max_c >= 88 or n >= 4:
        return "high", "مرتفع"
    if max_c >= 68 or n >= 2:
        return "medium", "متوسط"
    return "medium", "متوسط"


def _apply_high_recall_person_fill(
    state: dict[str, tuple[str, int]],
    *,
    has_person_signal: bool,
) -> dict[str, tuple[str, int]]:
    """
    High-recall policy for kitchen monitoring:
    if a person is detected and at least one explicit violation exists,
    infer missing mask/glove rows only (moderate confidence). Helmet and uniform
    are excluded — when the model omits positive hat/jacket classes we must not
    fabricate violations (common cause of false head-cover / uniform alerts).
    """
    if not has_person_signal:
        return state
    out = dict(state)
    has_explicit_violation = any(st == "violation" for st, _ in out.values())
    if not has_explicit_violation:
        return out
    for ck in _CHECK_ORDER:
        if ck not in _IMPLICIT_FILL_CHECKS:
            continue
        if ck in out:
            continue
        out[ck] = ("violation", _IMPLICIT_VIOLATION_CONF)
    return out


def _camera_key_for_streak(camera_name: str | None) -> str:
    """Stable key for per-camera temporal smoothing (same physical camera → same streak bucket)."""
    s = (camera_name or "").strip()
    return s if s else "_default"


def _worker_bbox_for_cluster(
    person_boxes: list[list[float]],
    cluster: list[dict[str, Any]],
    gi: int,
) -> list[float] | None:
    """Bounding box for spatial hat heuristic: YOLO person box when available, else merged PPE boxes."""
    if gi < len(person_boxes):
        return person_boxes[gi]
    if cluster:
        boxes = [d["xyxy"] for d in cluster if "xyxy" in d]
        if boxes:
            return _merge_boxes_xyxy(boxes)
    return None


def _mean_luminance_and_span(crop: Any) -> tuple[float, float, float, float, float]:
    """Return (luminance, RGB span, r, g, b) for a PIL crop."""
    try:
        from PIL import ImageStat
    except ImportError:
        return 0.0, 255.0, 0.0, 0.0, 0.0
    if crop.size[0] < 2 or crop.size[1] < 2:
        return 0.0, 255.0, 0.0, 0.0, 0.0
    stat = ImageStat.Stat(crop)
    r0, g0, b0 = stat.mean[:3]
    lum = 0.299 * r0 + 0.587 * g0 + 0.114 * b0
    span = max(r0, g0, b0) - min(r0, g0, b0)
    return float(lum), float(span), float(r0), float(g0), float(b0)


def _torso_band_mean_lum(pil_rgb: Any, bbox: list[float], iw: int, ih: int) -> float | None:
    """Mean luminance over center torso band (for dark-shirt vs white jacket heuristic)."""
    x1, y1, x2, y2 = (int(round(bbox[0])), int(round(bbox[1])), int(round(bbox[2])), int(round(bbox[3])))
    x1 = max(0, min(x1, iw - 1))
    x2 = max(0, min(x2, iw))
    y1 = max(0, min(y1, ih - 1))
    y2 = max(0, min(y2, ih))
    if x2 <= x1 or y2 <= y1:
        return None
    bw, bh = x2 - x1, y2 - y1
    if bw < 12 or bh < 40:
        return None
    tx1 = x1 + int(0.22 * bw)
    tx2 = x2 - int(0.22 * bw)
    ty1 = y1 + int(0.28 * bh)
    ty2 = y1 + int(0.72 * bh)
    if tx2 <= tx1 + 3 or ty2 <= ty1 + 3:
        return None
    crop = pil_rgb.crop((tx1, ty1, tx2, ty2))
    lum, _, _, _, _ = _mean_luminance_and_span(crop)
    return lum


def _apply_dark_attire_gap_fill(
    st: dict[str, tuple[str, int]],
    pil_rgb: Any,
    bbox: list[float] | None,
    iw: int,
    ih: int,
) -> dict[str, tuple[str, int]]:
    """
    When YOLO reports mask/glove breaches but omits uniform/helmet classes, workers in dark civilian
    clothing are often missed. If the torso band is clearly dark (low luminance) and we do not already
    have a model \"safe\" signal for uniform/helmet, infer those violation rows so policy coverage matches
    obvious visual cues (e.g. black T-shirt next to chefs in white).

    Does not override explicit model **safe** rows for uniform or helmet.
    """
    out = dict(st)
    mask_v = out.get("mask") and out["mask"][0] == "violation"
    glove_v = out.get("glove") and out["glove"][0] == "violation"
    if not (mask_v or glove_v):
        return out
    if bbox is None:
        return out
    torso_lum = _torso_band_mean_lum(pil_rgb, bbox, iw, ih)
    if torso_lum is None or torso_lum > _DARK_TORSO_LUM_MAX:
        return out

    ic = _DARK_ATTIRE_INFERRED_CONF
    if not (out.get("uniform") and out["uniform"][0] == "safe") and "uniform" not in out:
        out["uniform"] = ("violation", ic)

    if out.get("helmet") and out["helmet"][0] == "safe":
        return out
    # Only infer head breach if center-head crop does not look like a white chef hat (same gate as FP suppress).
    if not _suppress_headcover_hat_heuristic(pil_rgb, bbox, iw, ih) and "helmet" not in out:
        out["helmet"] = ("violation", ic)
    return out


def _suppress_headcover_hat_heuristic(pil_rgb: Any, bbox: list[float], iw: int, ih: int) -> bool:
    """
    Post-check vision gate for no_headcover: if the region over *this* worker's head center looks like a
    bright white chef hat, suppress the violation for this frame.

    Uses a **horizontal center band** (not full person width) so a neighboring chef's hat does not brighten
    the crop for the worker beside them. If left/right strips are much brighter than the center, skip
    suppression (neighbor contamination). Caps upward padding to reduce ceiling-only false whites.
    """
    x1, y1, x2, y2 = (int(round(bbox[0])), int(round(bbox[1])), int(round(bbox[2])), int(round(bbox[3])))
    x1 = max(0, min(x1, iw - 1))
    x2 = max(0, min(x2, iw))
    y1 = max(0, min(y1, ih - 1))
    y2 = max(0, min(y2, ih))
    if x2 <= x1 or y2 <= y1:
        return False
    bw = x2 - x1
    bh = y2 - y1
    if bh < 28 or bw < 22:
        return False

    inset = int(0.21 * bw)
    cx1 = x1 + inset
    cx2 = x2 - inset
    if cx2 <= cx1 + 4:
        cx1, cx2 = x1 + int(0.12 * bw), x2 - int(0.12 * bw)

    pad_up = min(max(4, int(0.10 * bh)), 36)
    hat_y1 = max(0, y1 - pad_up)
    hat_y2 = min(y2, y1 + int(0.38 * bh))

    crop_center = pil_rgb.crop((cx1, hat_y1, cx2, hat_y2))
    if crop_center.size[0] < 4 or crop_center.size[1] < 6:
        return False

    lum_all, span_all, r0, g0, b0 = _mean_luminance_and_span(crop_center)
    lum_c = lum_all

    side_w = max(6, int(0.18 * bw))
    left_crop = pil_rgb.crop((x1, hat_y1, min(x1 + side_w, cx1 - 1), hat_y2))
    right_crop = pil_rgb.crop((max(x2 - side_w, cx2 + 1), hat_y1, x2, hat_y2))
    lum_l, _, _, _, _ = _mean_luminance_and_span(left_crop) if left_crop.size[0] >= 3 else (0.0, 0.0, 0.0, 0.0, 0.0)
    lum_r, _, _, _, _ = _mean_luminance_and_span(right_crop) if right_crop.size[0] >= 3 else (0.0, 0.0, 0.0, 0.0, 0.0)

    if max(lum_l, lum_r) > lum_c + 22.0 and max(lum_l, lum_r) >= 168.0:
        logger.debug(
            "headcover hat heuristic: skip suppress — side strips brighter than center (neighbor hat?) L=%.1f R=%.1f C=%.1f",
            lum_l,
            lum_r,
            lum_c,
        )
        return False

    ch = crop_center.size[1]
    split = max(2, ch // 2)
    top_half = crop_center.crop((0, 0, crop_center.size[0], split))
    bot_half = crop_center.crop((0, split, crop_center.size[0], ch))
    lum_top, _, _, _, _ = _mean_luminance_and_span(top_half)
    lum_bot, _, _, _, _ = _mean_luminance_and_span(bot_half)

    bright_white_region = (
        lum_all >= 175.0
        and span_all <= 52.0
        and (r0 + g0 + b0) / 3.0 >= 165.0
    )
    tall_bright_crown = lum_top >= 178.0 and (lum_top - lum_bot) >= 7.0

    if bright_white_region or tall_bright_crown:
        logger.debug(
            "headcover hat heuristic: suppress (lum=%.1f span=%.1f top-heavy=%s)",
            lum_all,
            span_all,
            tall_bright_crown,
        )
        return True
    return False


def _headcover_streak_mark(cam_key: str, person_1based: int, proposed: bool) -> bool:
    """
    Temporal smoothing for no_headcover: count consecutive frames where a breach would be reported
    (after hat heuristic + confidence gate). Resets when the proposal drops or hat heuristic fires.

    Returns True only when the streak reaches _HEADCOVER_STREAK_FRAMES this frame (emit violation).
    """
    k = (cam_key, person_1based)
    with _headcover_streak_lock:
        if not proposed:
            _headcover_streak_by_cam_person.pop(k, None)
            return False
        prev = _headcover_streak_by_cam_person.get(k, 0)
        nxt = prev + 1
        _headcover_streak_by_cam_person[k] = nxt
        return nxt >= _HEADCOVER_STREAK_FRAMES


def _classify_headcover_frame(
    pil_rgb: Any,
    bbox: list[float] | None,
    iw: int,
    ih: int,
    conf: int,
    cam_key: str,
    person_1based: int,
) -> str:
    """
    Decide how to treat a raw helmet/no_headcover violation for this worker/frame.

    Returns one of:
      - "emit" — surface no_headcover to the client (streak + thresholds satisfied).
      - "suppress_hat" — bright hat-shaped region; drop violation and reset streak.
      - "suppress_lowconf" — below head-cover-only confidence floor; reset streak.
      - "suppress_streak" — breach not yet sustained across enough consecutive frames.
    """
    if bbox and _suppress_headcover_hat_heuristic(pil_rgb, bbox, iw, ih):
        _headcover_streak_mark(cam_key, person_1based, False)
        return "suppress_hat"
    if conf < _HEADCOVER_VIOLATION_MIN_CONF_INT:
        _headcover_streak_mark(cam_key, person_1based, False)
        return "suppress_lowconf"
    if _headcover_streak_mark(cam_key, person_1based, True):
        return "emit"
    return "suppress_streak"


def _scene_det_to_public_violation(det: dict[str, Any], ih: int) -> tuple[str | None, int]:
    """Map a scene detection to API violation type + confidence."""
    if not det.get("is_violation"):
        return None, 0
    ck = det["check_key"]
    cf = int(det["confidence"])
    cy_n = _center(det["xyxy"])[1] / max(ih, 1)
    if ck == "waste_area":
        return "improper_waste_area", cf
    if ck == "trash_floor":
        return ("trash_on_floor", cf) if cy_n >= _FLOOR_CY_MIN else ("improper_waste_area", cf)
    return None, 0


def _aggregate_scene_hygiene(
    scene_flat: list[dict[str, Any]],
    ih: int,
    *,
    labels: dict[str, str],
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    """Build hygiene violations + check rows for trash_floor / waste_area."""
    best_floor = -1
    best_area = -1
    for det in scene_flat:
        vt, cf = _scene_det_to_public_violation(det, ih)
        if vt == "trash_on_floor":
            best_floor = max(best_floor, cf)
        elif vt == "improper_waste_area":
            best_area = max(best_area, cf)

    rtf = _REASON_AR["trash_floor"]
    rwa = _REASON_AR["waste_area"]

    violations: list[dict[str, Any]] = []
    if best_floor >= 0:
        lb = labels.get("trash_on_floor") or _LABEL_VIOLATION_AR["trash_on_floor"]
        violations.append({
            "type": "trash_on_floor",
            "label_ar": lb,
            "confidence": best_floor,
            "reason_ar": f"{lb}. {rtf['violation']}",
            "description": f"{lb}. {rtf['violation']}",
            "status": "new",
        })
    if best_area >= 0:
        lb = labels.get("improper_waste_area") or _LABEL_VIOLATION_AR["improper_waste_area"]
        violations.append({
            "type": "improper_waste_area",
            "label_ar": lb,
            "confidence": best_area,
            "reason_ar": f"{lb}. {rwa['violation']}",
            "description": f"{lb}. {rwa['violation']}",
            "status": "new",
        })

    sensors = bool(scene_flat)

    if best_floor >= 0:
        tf_row: dict[str, Any] = {"key": "trash_floor", "status": "violation", "confidence": best_floor, "reason_ar": rtf["violation"]}
    elif sensors:
        tf_row = {"key": "trash_floor", "status": "uncertain", "confidence": 0, "reason_ar": rtf["uncertain"]}
    else:
        tf_row = {"key": "trash_floor", "status": "uncertain", "confidence": 0, "reason_ar": rtf["uncertain"]}

    if best_area >= 0:
        wa_row: dict[str, Any] = {"key": "waste_area", "status": "violation", "confidence": best_area, "reason_ar": rwa["violation"]}
    elif sensors:
        wa_row = {"key": "waste_area", "status": "uncertain", "confidence": 0, "reason_ar": rwa["uncertain"]}
    else:
        wa_row = {"key": "waste_area", "status": "uncertain", "confidence": 0, "reason_ar": rwa["uncertain"]}

    return violations, tf_row, wa_row


def _run_yolo_inference(
    image_bytes: bytes,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[list[float]],
    int,
    int,
    int,
    Any,
    list[int],
    dict[str, Any],
]:
    """PPE+scene dets, person boxes, canvas, raw person hit count, PIL, confidences, diagnostic dict."""
    model = _get_yolo_model()
    try:
        from PIL import Image as PILImage
    except ImportError:
        raise ValueError("مكتبة Pillow غير مثبتة. نفّذ: pip install Pillow") from None

    try:
        img = PILImage.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:
        raise ValueError("الصورة غير صالحة.") from exc

    img, img_w, img_h = _resize_image_for_inference(img)
    pil_rgb = img

    person_pd_merged, person_det_ok, person_src, person_raw_n = _infer_coco_person_boxes(pil_rgb)

    tiles = _tiles_from_image(pil_rgb, img_w, img_h)

    raw_person_entries: list[tuple[list[float], int]] = []
    ppe_flat: list[dict[str, Any]] = []
    scene_flat: list[dict[str, Any]] = []
    raw_person_hits = 0

    for tile_img, x_off, y_off, cw, ch in tiles:
        all_runs: list[tuple[float, Any]] = []
        try:
            all_runs.append((_YOLO_CONF, _yolo_predict_cpu(model, tile_img, conf=_YOLO_CONF)))
        except Exception as exc:
            logger.warning("YOLO primary tile (%d,%d) failed: %s", x_off, y_off, exc)
        try:
            all_runs.append((_YOLO_CONF_RECALL, _yolo_predict_cpu(model, tile_img, conf=_YOLO_CONF_RECALL)))
        except Exception as exc:
            logger.warning("YOLO recall tile (%d,%d) failed: %s", x_off, y_off, exc)
        if not all_runs:
            continue

        for run_conf, results in all_runs:
            for result in results:
                if result.boxes is None:
                    continue
                names = result.names or {}
                for box in result.boxes:
                    conf_val = float(box.conf[0]) if box.conf is not None else 0.0
                    cls_id = int(box.cls[0]) if box.cls is not None else -1
                    raw_name = str(names.get(cls_id, "")).strip()
                    cls_name = raw_name.lower().replace(" ", "_").replace("-", "_")
                    if not cls_name:
                        continue
                    conf_int = int(round(conf_val * 100))
                    if conf_int < _MIN_BOX_CONF_INT:
                        continue

                    xy = box.xyxy[0].tolist()
                    gx = _map_tile_box_to_global([float(xy[0]), float(xy[1]), float(xy[2]), float(xy[3])], x_off, y_off, cw, ch)

                    if cls_name in _PERSON_CLASSES:
                        # When COCO person detector runs, worker boxes come from it only (no duplicate persons).
                        if not person_det_ok:
                            raw_person_hits += 1
                            raw_person_entries.append((gx, conf_int))
                        continue

                    mapping = _YOLO_CLASS_MAP.get(cls_name)
                    if mapping is None:
                        if _is_bin_like_class(cls_name):
                            mapping = (_BIN_CANDIDATE_KEY, False)
                        else:
                            logger.debug("YOLO: skip unmapped class=%s conf=%d%% run=%.2f", cls_name, conf_int, run_conf)
                            continue

                    ck, is_vio = mapping
                    # Recall pass contributes only violations by default (avoid inflated "safe").
                    # Exception: mask/glove *safe* classes — needed when primary pass misses dark masks / low light
                    # but recall fires masked/gloves at modest confidence.
                    if run_conf < _YOLO_CONF and not is_vio:
                        if not (
                            ck in ("mask", "glove")
                            and not is_vio
                            and conf_int >= _MIN_RECALL_SAFE_MASK_GLOVE_CONF_INT
                        ):
                            continue
                    payload_det = {
                        "class_name": cls_name,
                        "check_key": ck,
                        "is_violation": is_vio,
                        "confidence": conf_int,
                        "xyxy": gx,
                    }
                    if ck in _SCENE_ROUTING_KEYS:
                        scene_flat.append(payload_det)
                    else:
                        ppe_flat.append(payload_det)

    ppe_raw_count = len(ppe_flat)

    if person_det_ok:
        person_boxes = [e[0] for e in person_pd_merged]
        person_confidences = [e[1] for e in person_pd_merged]
        raw_person_hits = int(person_raw_n)
    else:
        person_entries = _nms_person_entries(raw_person_entries)
        person_boxes = [e[0] for e in person_entries]
        person_confidences = [e[1] for e in person_entries]

    if person_boxes:
        ppe_flat = _filter_ppe_by_person_boxes(ppe_flat, person_boxes, img_w, img_h)
    matched_ppe_count = len(ppe_flat)

    yolo_diag: dict[str, Any] = {
        "person_model_loaded": bool(person_det_ok),
        "person_model_source": person_src,
        "person_boxes_count": len(person_boxes),
        "ppe_raw_count": int(ppe_raw_count),
        "matched_ppe_count": int(matched_ppe_count),
    }

    logger.info(
        "YOLO kitchen: tiles=%d person_detector=%s person_boxes=%d ppe_raw=%d matched_ppe=%d scene_boxes=%d canvas=%dx%d",
        len(tiles),
        person_det_ok,
        len(person_boxes),
        ppe_raw_count,
        matched_ppe_count,
        len(scene_flat),
        img_w,
        img_h,
    )
    return ppe_flat, scene_flat, person_boxes, img_w, img_h, raw_person_hits, pil_rgb, person_confidences, yolo_diag


def analyze_frame_yolo(
    image_bytes: bytes,
    camera_name: str | None,
    location: str | None,
    *,
    wait_for_slot: bool = True,
) -> dict[str, Any]:
    if not settings.YOLO_ENABLED:
        raise ValueError("YOLO is disabled (YOLO_ENABLED=false).")

    with _yolo_analysis_slot(wait=wait_for_slot):
        payload = _analyze_frame_yolo_core(image_bytes, camera_name, location)
        logger.info("YOLO inference finished camera=%s", camera_name or "—")
        return payload


def _analyze_frame_yolo_core(
    image_bytes: bytes,
    camera_name: str | None,
    location: str | None,
) -> dict[str, Any]:
    from datetime import datetime, timezone

    from app.services.monitoring_ai_service import VIOLATION_TYPE_LABELS, _finalize_payload  # noqa: PLC0415

    logger.info(
        "YOLO inference started bytes=%d camera=%s location=%s max_edge=%d",
        len(image_bytes),
        camera_name or "—",
        location or "—",
        _YOLO_MAX_EDGE,
    )

    ppe_flat, scene_flat, person_boxes, iw, ih, raw_person_hits, pil_rgb, person_confs, yolo_diag = (
        _run_yolo_inference(image_bytes)
    )

    waste_path = _resolve_aux_waste_model_path()
    if waste_path:
        try:
            scene_flat.extend(_run_aux_waste_scene_detections(waste_path, pil_rgb, iw, ih))
        except Exception as exc:
            logger.warning("YOLO auxiliary hygiene model skipped: %s", exc)

    _apply_geometry_waste_rules(scene_flat, person_boxes, iw, ih)

    groups = _assign_detections_to_persons(person_boxes, ppe_flat, iw, ih)
    if ppe_flat and not groups:
        logger.info("YOLO: no spatial clusters — single-scene fallback")
        groups = [ppe_flat]
    if not groups and person_boxes:
        # Person exists but PPE classes may be partially missed; keep one group per person.
        groups = [[] for _ in person_boxes]

    person_states: list[dict[str, tuple[str, int]]] = []
    for gi, cluster in enumerate(groups):
        st = _person_score_for_checks(cluster)
        bbox_gap = _worker_bbox_for_cluster(person_boxes, cluster, gi)
        pq = _worker_person_quality(gi, person_boxes, person_confs, iw, ih)
        vis_gate = _ppe_visibility_flags(bbox_gap, iw, ih)
        st = _apply_high_recall_person_fill(st, has_person_signal=pq)
        if pq and vis_gate.get("upper_body_ok"):
            st = _apply_dark_attire_gap_fill(st, pil_rgb, bbox_gap, iw, ih)
        person_states.append(st)

    # Second pass: build violations + head-cover adjusted states (FP filtering does not apply to other checks).
    cam_key = _camera_key_for_streak(camera_name)
    violations_flat: list[dict[str, Any]] = []
    adjusted_person_states: list[dict[str, tuple[str, int]]] = []
    rejected_debug: list[dict[str, Any]] = []

    def _rej(typ: str, idx: int, reason_code: str, cf: int) -> None:
        rejected_debug.append({
            "violation_type": typ,
            "person_index": idx,
            "reason": reason_code,
            "confidence": int(cf),
        })

    for gi, cluster in enumerate(groups):
        st = person_states[gi]
        st_adj: dict[str, tuple[str, int]] = dict(st)
        person_label = f"العامل {gi + 1}"
        bbox = _worker_bbox_for_cluster(person_boxes, cluster, gi)
        pq = _worker_person_quality(gi, person_boxes, person_confs, iw, ih)
        vis = _ppe_visibility_flags(bbox, iw, ih)

        for ck, (status, conf) in list(st.items()):
            if status != "violation":
                continue

            if ck == "helmet":
                if not pq:
                    _headcover_streak_mark(cam_key, gi + 1, False)
                    st_adj.pop("helmet", None)
                    _rej("no_headcover", gi + 1, "rejected_no_person", conf)
                    continue
                if not vis["head_ok"]:
                    _headcover_streak_mark(cam_key, gi + 1, False)
                    st_adj.pop("helmet", None)
                    _rej("no_headcover", gi + 1, "rejected_head_not_visible", conf)
                    continue
                decision = _classify_headcover_frame(pil_rgb, bbox, iw, ih, conf, cam_key, gi + 1)
                # Align aggregated checks with what we surface (hat heuristic / threshold / streak).
                if st.get("helmet") and st["helmet"][0] == "violation":
                    if decision == "suppress_hat":
                        st_adj["helmet"] = ("safe", _HAT_HEURISTIC_SAFE_CONF)
                    elif decision in ("suppress_lowconf", "suppress_streak"):
                        st_adj.pop("helmet", None)
                if decision == "emit":
                    vtype = _VIOLATION_TYPES["helmet"]
                    label_ar = VIOLATION_TYPE_LABELS.get(vtype) or _LABEL_VIOLATION_AR.get(vtype, vtype)
                    reason = f"{label_ar} ({person_label}). {_REASON_AR['helmet']['violation']}"
                    violations_flat.append({
                        "type": vtype,
                        "label_ar": label_ar,
                        "confidence": conf,
                        "reason_ar": reason,
                        "description": reason,
                        "status": "new",
                        "person_index": gi + 1,
                    })
                continue

            if ck in ("mask", "glove", "uniform"):
                vtype = _VIOLATION_TYPES[ck]
                if not pq:
                    st_adj.pop(ck, None)
                    _rej(vtype, gi + 1, "rejected_no_person", conf)
                    continue
                if ck == "mask":
                    if not vis["face_ok"]:
                        st_adj.pop("mask", None)
                        _rej(vtype, gi + 1, "rejected_face_not_visible", conf)
                        continue
                elif ck == "glove":
                    if not _gloves_visibility_ok(vis, cluster, bbox):
                        st_adj.pop("glove", None)
                        _rej(vtype, gi + 1, "rejected_hands_not_visible", conf)
                        continue
                elif ck == "uniform":
                    if not vis["upper_body_ok"]:
                        st_adj.pop("uniform", None)
                        _rej(vtype, gi + 1, "rejected_body_not_visible", conf)
                        continue

                label_ar = VIOLATION_TYPE_LABELS.get(vtype) or _LABEL_VIOLATION_AR.get(vtype, vtype)
                reason = f"{label_ar} ({person_label}). {_REASON_AR[ck]['violation']}"
                violations_flat.append({
                    "type": vtype,
                    "label_ar": label_ar,
                    "confidence": conf,
                    "reason_ar": reason,
                    "description": reason,
                    "status": "new",
                    "person_index": gi + 1,
                })
                continue

        adjusted_person_states.append(st_adj)

    checks_in = _scene_checks_from_persons(adjusted_person_states, len(person_boxes), len(groups))

    scene_violations, tf_row, wa_row = _aggregate_scene_hygiene(scene_flat, ih, labels=VIOLATION_TYPE_LABELS)
    if checks_in:
        people_row = checks_in.pop()
        checks_in.extend([tf_row, wa_row, people_row])
    else:
        checks_in = [tf_row, wa_row]
    violations_flat.extend(scene_violations)

    analyzed_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"

    payload = _finalize_payload(
        provider="yolo",
        camera_name=camera_name,
        location=location,
        checks_in=checks_in,
        people_count_top=max(len(person_boxes), len(groups)),
        violations_override=violations_flat,
        violation_thresholds=_VIOLATION_THRESHOLDS_INT,
        default_violation_threshold=40,
        skip_display_bucket_for_yolo=True,
    )

    violations_ok = payload.get("violations") or []

    pin_vals: list[int] = []
    for v in violations_ok:
        pi = v.get("person_index")
        if pi is None:
            continue
        try:
            pin_vals.append(int(pi))
        except (TypeError, ValueError):
            continue
    pin_max = max(pin_vals) if pin_vals else 0
    exact_people = max(len(person_boxes), len(groups), pin_max)
    if exact_people == 0 and (raw_person_hits > 0 or len(ppe_flat) > 0):
        exact_people = 1

    payload["people_count"] = exact_people

    violators_by_check_key = {
        "mask": 0,
        "glove": 0,
        "helmet": 0,
        "uniform": 0,
        "trash_floor": 0,
        "waste_area": 0,
    }
    _VT_TO_CHECK_KEY = {
        "no_mask": "mask",
        "no_gloves": "glove",
        "no_headcover": "helmet",
        "improper_uniform": "uniform",
        "trash_on_floor": "trash_floor",
        "improper_waste_area": "waste_area",
    }
    for v in violations_ok:
        ck = _VT_TO_CHECK_KEY.get(str(v.get("type", "")).strip())
        if ck:
            violators_by_check_key[ck] += 1

    for row in payload.get("checks") or []:
        if isinstance(row, dict) and row.get("key") == "people_count":
            row["reason_ar"] = f"عدد العمال المقدَّر من الرصد: {exact_people}."

    risk_en, risk_ar = _risk_level(violations_ok)

    merged_labels = VIOLATION_TYPE_LABELS | _LABEL_VIOLATION_AR
    lines = [
        f"{merged_labels.get(v['type'], v['type'])} — {int(v['confidence'])}%"
        for v in violations_ok
    ]
    summary_sentence = "؛ ".join(lines) if lines else "لم يتم رصد مخالفات مطبخية واضحة في هذه اللقطة."

    has_quality_person = any(
        _worker_person_quality(gi, person_boxes, person_confs, iw, ih)
        for gi in range(len(groups))
    )
    ppe_notice_ar: str | None = None
    if not has_quality_person and len(ppe_flat) > 0:
        ppe_notice_ar = (
            "لم يُرصد شخص واضح بثقة كافية في الإطار؛ لم تُبلَّغ مخالفات معدات السلامة الشخصية المرتبطة بالأشخاص."
        )

    rej_counts = dict(Counter(str(r.get("reason", "")) for r in rejected_debug if r.get("reason")))
    rn_no_person = sum(1 for r in rejected_debug if r.get("reason") == "rejected_no_person")
    yolo_diag_out = dict(yolo_diag)
    yolo_diag_out["rejected_no_person_count"] = int(rn_no_person)

    logger.info(
        "YOLO monitoring diag: person_model_loaded=%s person_boxes_count=%d ppe_raw_count=%d matched_ppe_count=%d rejected_no_person_count=%d",
        yolo_diag_out.get("person_model_loaded"),
        int(yolo_diag_out.get("person_boxes_count") or 0),
        int(yolo_diag_out.get("ppe_raw_count") or 0),
        int(yolo_diag_out.get("matched_ppe_count") or 0),
        int(yolo_diag_out.get("rejected_no_person_count") or 0),
    )

    payload["frame_report"] = {
        "analyzed_at": analyzed_at,
        "frame_width": iw,
        "frame_height": ih,
        "overall_risk_level": risk_en,
        "overall_risk_ar": risk_ar,
        "summary_ar": summary_sentence,
        "violation_lines": lines,
        "people_clusters": len(groups),
        "people_count_exact": exact_people,
        "violators_by_check_key": violators_by_check_key,
        "ppe_rejected_violations": rejected_debug,
        "ppe_rejected_counts_by_reason": rej_counts,
        "yolo_diag": yolo_diag_out,
        **({"ppe_notice_ar": ppe_notice_ar} if ppe_notice_ar else {}),
        "violations_detail": [
            {
                "type": v["type"],
                "label_ar": v.get("label_ar", ""),
                "confidence": int(v.get("confidence", 0)),
                "person_index": v.get("person_index"),
                "reason_ar": v.get("reason_ar", ""),
            }
            for v in violations_ok
        ],
    }
    return payload
