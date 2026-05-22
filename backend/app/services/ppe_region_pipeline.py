"""
Region-aware PPE detection pipeline.

For each detected person box, each PPE model runs only on the relevant body
region — not the full frame. This prevents hairnet model false positives on
gloved hands and mask model hallucinations on empty backgrounds.

Detection regions:
  face crop  = top 25 % of person box  → mask_best.pt
  head crop  = top 35 % of person box  → hairnet_best.pt
  hand crop  = bottom 40 % of person box → glove_best.pt
              (if too small → gloves = needs_review, never compliant)

Temporal confirmation:
  "ok" state requires 3 consecutive frames per camera per check type.
  "violation" is surfaced immediately (no streak required on the violation side —
  the violation_tracker in monitoring.py applies the 3-frame streak before any
  DB alert is written).

Entry point:
  analyze_ppe_regions(pil_rgb, person_boxes, person_confs, cam_key)
  → (per_person: list[PersonPPEResult],
     aggregated: dict[str, AggregatedPPECheck],
     annotated_b64: str | None)
"""
from __future__ import annotations

import base64
import logging
import threading
from dataclasses import dataclass, field
from typing import Any, Literal

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ─── Confidence thresholds (match ai_violation_service.py) ───────────────────
# Temporary workaround thresholds while models are being retrained.
# Models were trained for only 5–12 epochs and top out at low confidence values:
#   mask_best.pt     → max conf ~0.28  (broken — 5 epochs)
#   hairnet_best.pt  → fires at 0.26–0.52
#   glove_best.pt    → max conf ~0.54  (just below the old 0.55 threshold)
# These lower values let real detections surface as "needs_review" in the UI.
_MASK_CONF: float      = 0.25
_HEADCOVER_CONF: float = 0.30
_GLOVE_CONF: float     = 0.35

# Consecutive ok-frames before flipping a check card to green.
_CONFIRM_FRAMES: int = 3

# Minimum crop pixel dimensions. Below this the region is not reliably visible.
# Lowered from 40/35 px — crops are upscaled before inference anyway (see _maybe_upscale).
_MIN_FACE_W: int = 25
_MIN_FACE_H: int = 25
_MIN_HEAD_H: int = 25
_MIN_HAND_W: int = 25
_MIN_HAND_H: int = 25

# Upscale small crops to this minimum before YOLO inference. The trained models
# expect 416 px input — running on 40 px crops is equivalent to 1/8th resolution.
# Upscaling to 160 px minimises the mismatch without introducing full-frame noise.
_MIN_INFERENCE_DIM: int = 160

# Body region fractions of person-box height.
_FACE_H_FRAC: float = 0.25   # top 25 % → face  (for mask)
_HEAD_H_FRAC: float = 0.35   # top 35 % → head  (for headcover)
_HAND_H_FRAC: float = 0.40   # bottom 40 % → hands (for gloves)

# ─── Gloves optional mode ────────────────────────────────────────────────────
# The gloves model (glove_best.pt) is undertrained (5 epochs, max conf ~0.54).
# Until a better model is available, gloves detections are capped at
# "needs_review" — never a confirmed violation — to avoid false alerts.
# Set to False once the retrained model passes ppe_eval_models.py targets.
_GLOVES_OPTIONAL: bool = True

# Gloves are only considered "clearly visible" if the hand crop is at least
# this large. Below this, the hands region is treated as not reliably visible.
_MIN_GLOVE_CLEAR_W: int = 50
_MIN_GLOVE_CLEAR_H: int = 50


# ─── Temporal streak (per-camera, per-check-type, one tick per frame) ────────
_streak_lock = threading.Lock()
_compliant_streak: dict[tuple[str, str], int] = {}


def _streak_tick(cam_key: str, check_type: str, positive: bool) -> bool:
    """Advance or reset streak. Returns True when _CONFIRM_FRAMES reached."""
    k = (cam_key, check_type)
    with _streak_lock:
        if not positive:
            _compliant_streak.pop(k, None)
            return False
        prev = _compliant_streak.get(k, 0)
        nxt = prev + 1
        _compliant_streak[k] = nxt
        logger.debug("PPE_STREAK cam=%s check=%s streak=%d/%d", cam_key, check_type, nxt, _CONFIRM_FRAMES)
        return nxt >= _CONFIRM_FRAMES


# ─── Data types ───────────────────────────────────────────────────────────────
@dataclass
class PPEItemResult:
    """Raw (pre-streak) inference result for one PPE item on one person."""
    status: Literal["ok", "violation", "needs_review"]
    confidence: int                                    # 0-100
    detected_class: str | None = None                 # e.g. "mask", "no_mask"
    region_visible: bool = True
    det_box: tuple[int, int, int, int] | None = None  # full-frame pixel coords


@dataclass
class PersonPPEResult:
    person_idx: int           # 1-based
    person_box: list[float]   # [x1, y1, x2, y2]
    person_conf: int           # 0-100
    mask: PPEItemResult
    headcover: PPEItemResult
    gloves: PPEItemResult


@dataclass
class AggregatedPPECheck:
    """Per-check-type summary across all persons, with streak applied."""
    status: Literal["ok", "violation", "needs_review", "verifying"]
    confidence: int    # 0-100
    person_count: int
    violating_count: int
    needs_review_count: int


# ─── Geometry helpers ─────────────────────────────────────────────────────────
def _face_box(pb: list[float], fh: int, fw: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = int(pb[0]), int(pb[1]), int(pb[2]), int(pb[3])
    ch = max(1, round((y2 - y1) * _FACE_H_FRAC))
    return max(0, x1), max(0, y1), min(fw, x2), min(fh, y1 + ch)


def _head_box(pb: list[float], fh: int, fw: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = int(pb[0]), int(pb[1]), int(pb[2]), int(pb[3])
    ch = max(1, round((y2 - y1) * _HEAD_H_FRAC))
    return max(0, x1), max(0, y1), min(fw, x2), min(fh, y1 + ch)


def _hand_box(pb: list[float], fh: int, fw: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = int(pb[0]), int(pb[1]), int(pb[2]), int(pb[3])
    ph = y2 - y1
    cy1 = max(0, y2 - round(ph * _HAND_H_FRAC))
    return max(0, x1), cy1, min(fw, x2), min(fh, y2)


# ─── Per-crop inference ───────────────────────────────────────────────────────
def _maybe_upscale(crop_bgr: np.ndarray) -> np.ndarray:
    """Upscale small crops so the model sees at least _MIN_INFERENCE_DIM pixels."""
    h, w = crop_bgr.shape[:2]
    if min(h, w) >= _MIN_INFERENCE_DIM:
        return crop_bgr
    scale = _MIN_INFERENCE_DIM / min(h, w)
    new_w = max(int(w * scale), _MIN_INFERENCE_DIM)
    new_h = max(int(h * scale), _MIN_INFERENCE_DIM)
    return cv2.resize(crop_bgr, (new_w, new_h), interpolation=cv2.INTER_CUBIC)


def _infer_crop(
    model: Any,
    crop_bgr: np.ndarray,
    conf_threshold: float,
    violation_class_ids: set[int],
    class_names: dict[int, str],
    offset: tuple[int, int],
) -> PPEItemResult:
    """
    Run model on a single BGR crop. Returns raw (pre-streak) PPEItemResult.
    offset: (crop_x1, crop_y1) in full-frame pixel coords for box translation.
    """
    crop_bgr = _maybe_upscale(crop_bgr)
    crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
    try:
        results = model(crop_rgb, verbose=False, conf=conf_threshold, iou=0.45)
    except Exception as exc:
        logger.warning("ppe_region_pipeline model inference failed: %s", exc)
        return PPEItemResult(status="needs_review", confidence=0, region_visible=True)

    best_vio: tuple[float, str, list[float]] | None = None
    best_ok:  tuple[float, str, list[float]] | None = None

    for r in results:
        if r.boxes is None:
            continue
        for box in r.boxes:
            cls_id = int(box.cls[0])
            conf   = float(box.conf[0])
            if conf < conf_threshold:
                continue
            cname = class_names.get(cls_id, f"cls{cls_id}")
            xyxy  = box.xyxy[0].tolist()
            if cls_id in violation_class_ids:
                if best_vio is None or conf > best_vio[0]:
                    best_vio = (conf, cname, xyxy)
            else:
                if best_ok is None or conf > best_ok[0]:
                    best_ok = (conf, cname, xyxy)

    ox, oy = offset

    if best_vio is not None:
        c, cname, xy = best_vio
        fb = (int(xy[0]) + ox, int(xy[1]) + oy, int(xy[2]) + ox, int(xy[3]) + oy)
        return PPEItemResult(status="violation", confidence=round(c * 100),
                             detected_class=cname, region_visible=True, det_box=fb)

    if best_ok is not None:
        c, cname, xy = best_ok
        fb = (int(xy[0]) + ox, int(xy[1]) + oy, int(xy[2]) + ox, int(xy[3]) + oy)
        return PPEItemResult(status="ok", confidence=round(c * 100),
                             detected_class=cname, region_visible=True, det_box=fb)

    # Model saw nothing inside the crop.
    return PPEItemResult(status="needs_review", confidence=0, region_visible=True)


# ─── Evidence annotation ──────────────────────────────────────────────────────
_STATUS_BGR: dict[str, tuple[int, int, int]] = {
    "ok":           (30, 200, 30),
    "violation":    (30, 30, 220),
    "needs_review": (20, 140, 255),
    "verifying":    (30, 210, 240),
}


def _annotate_frame(
    frame_bgr: np.ndarray,
    results: list[PersonPPEResult],
    aggregated: dict[str, AggregatedPPECheck],
) -> str:
    """Draw person + PPE region boxes. Returns base64 JPEG data URL."""
    canvas = frame_bgr.copy()
    fh, fw = canvas.shape[:2]

    for r in results:
        pb = r.person_box
        px1, py1, px2, py2 = int(pb[0]), int(pb[1]), int(pb[2]), int(pb[3])

        # Overall person compliance colour
        items_statuses = [r.mask.status, r.headcover.status, r.gloves.status]
        if "violation" in items_statuses:
            pcolor = (30, 30, 220)
        elif "needs_review" in items_statuses:
            pcolor = (20, 140, 255)
        else:
            pcolor = (30, 200, 30)

        cv2.rectangle(canvas, (px1, py1), (px2, py2), pcolor, 2)
        label = f"W{r.person_idx}"
        cv2.putText(canvas, label, (px1 + 3, max(py1 - 5, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, pcolor, 1, cv2.LINE_AA)

        # Face / head / hand region outlines (thin, grey)
        for region_fn, label_text in [
            (_face_box, "Face"),
            (_head_box, "Head"),
            (_hand_box, "Hands"),
        ]:
            rb = region_fn(pb, fh, fw)
            cv2.rectangle(canvas, (rb[0], rb[1]), (rb[2], rb[3]), (100, 100, 100), 1)

        # PPE detection boxes
        for item, ppe_label in [
            (r.mask,      "Mask"),
            (r.headcover, "Head"),
            (r.gloves,    "Gloves"),
        ]:
            color = _STATUS_BGR.get(item.status, (120, 120, 120))
            if item.det_box:
                bx1, by1, bx2, by2 = item.det_box
                cv2.rectangle(canvas, (bx1, by1), (bx2, by2), color, 2)
                txt = f"{ppe_label}:{item.detected_class or item.status} {item.confidence}%"
                cv2.putText(canvas, txt, (bx1, max(by1 - 4, 10)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1, cv2.LINE_AA)

    _, buf = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 83])
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


# ─── Main entry point ─────────────────────────────────────────────────────────
def analyze_ppe_regions(
    pil_rgb: Any,
    person_boxes: list[list[float]],
    person_confs: list[int],
    cam_key: str,
) -> tuple[list[PersonPPEResult], dict[str, AggregatedPPECheck], str | None]:
    """
    Region-aware PPE detection for all persons in a frame.

    Returns:
      per_person   – one PersonPPEResult per person (raw, for annotation / per-person violation entries)
      aggregated   – dict keyed by check type ("no_mask", "no_headcover", "no_gloves")
                     with streak-adjusted status for supplementary_results
      annotated_b64 – evidence image as data URL, or None on failure
    """
    if not person_boxes:
        return [], {}, None

    try:
        from app.services.ai_violation_service import (  # noqa: PLC0415
            GLOVE_CLASS_NAMES, GLOVE_VIOLATION_CLASS_IDS,
            HAIRNET_CLASS_NAMES, HAIRNET_VIOLATION_CLASS_IDS,
            MASK_CLASS_NAMES, MASK_VIOLATION_CLASS_IDS,
            _load_glove_model, _load_hairnet_model, _load_mask_model,
        )
    except ImportError:
        logger.warning("ppe_region_pipeline: ai_violation_service unavailable.")
        return [], {}, None

    try:
        rgb_arr    = np.array(pil_rgb)
        frame_bgr  = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)
    except Exception as exc:
        logger.warning("ppe_region_pipeline: frame conversion failed: %s", exc)
        return [], {}, None

    fh, fw = frame_bgr.shape[:2]

    # Lazy-load models (cached after first call, thread-safe).
    mask_m    = _load_mask_model()
    hairnet_m = _load_hairnet_model()
    glove_m   = _load_glove_model()

    per_person: list[PersonPPEResult] = []

    for gi, pb in enumerate(person_boxes):
        pidx  = gi + 1
        pconf = person_confs[gi] if gi < len(person_confs) else 0

        # ── 1. Mask: face crop (top 25 %) ──────────────────────────────────
        fb   = _face_box(pb, fh, fw)
        crop = frame_bgr[fb[1]:fb[3], fb[0]:fb[2]]
        ch, cw = crop.shape[:2]

        if cw >= _MIN_FACE_W and ch >= _MIN_FACE_H:
            mask_res = _infer_crop(mask_m, crop, _MASK_CONF,
                                   MASK_VIOLATION_CLASS_IDS, MASK_CLASS_NAMES,
                                   (fb[0], fb[1]))
        else:
            mask_res = PPEItemResult(status="needs_review", confidence=0,
                                     region_visible=False)

        logger.info("PPE_REGION person=%d mask=%s conf=%d face_vis=%s",
                    pidx, mask_res.status, mask_res.confidence, mask_res.region_visible)

        # ── 2. Headcover: head crop (top 35 %) ─────────────────────────────
        hb   = _head_box(pb, fh, fw)
        crop = frame_bgr[hb[1]:hb[3], hb[0]:hb[2]]
        ch, cw = crop.shape[:2]

        if cw >= _MIN_FACE_W and ch >= _MIN_HEAD_H:
            hc_res = _infer_crop(hairnet_m, crop, _HEADCOVER_CONF,
                                 HAIRNET_VIOLATION_CLASS_IDS, HAIRNET_CLASS_NAMES,
                                 (hb[0], hb[1]))
        else:
            hc_res = PPEItemResult(status="needs_review", confidence=0,
                                   region_visible=False)

        logger.info("PPE_REGION person=%d headcover=%s conf=%d head_vis=%s",
                    pidx, hc_res.status, hc_res.confidence, hc_res.region_visible)

        # ── 3. Gloves: hand crop (bottom 40 %) ─────────────────────────────
        gb   = _hand_box(pb, fh, fw)
        crop = frame_bgr[gb[1]:gb[3], gb[0]:gb[2]]
        ch, cw = crop.shape[:2]

        if cw >= _MIN_HAND_W and ch >= _MIN_HAND_H:
            gl_res = _infer_crop(glove_m, crop, _GLOVE_CONF,
                                 GLOVE_VIOLATION_CLASS_IDS, GLOVE_CLASS_NAMES,
                                 (gb[0], gb[1]))
            # Hands are detectable but not clearly large enough for a firm decision.
            # Cap at needs_review so we don't raise a false violation on a small crop.
            if gl_res.status == "violation" and (cw < _MIN_GLOVE_CLEAR_W or ch < _MIN_GLOVE_CLEAR_H):
                gl_res = PPEItemResult(
                    status="needs_review",
                    confidence=gl_res.confidence,
                    detected_class=gl_res.detected_class,
                    region_visible=True,
                    det_box=gl_res.det_box,
                )
        else:
            # Hand region not clearly visible: never mark as compliant or violation.
            gl_res = PPEItemResult(status="needs_review", confidence=0,
                                   region_visible=False)

        # Optional mode: cap any glove violation at needs_review until model is retrained.
        if _GLOVES_OPTIONAL and gl_res.status == "violation":
            gl_res = PPEItemResult(
                status="needs_review",
                confidence=gl_res.confidence,
                detected_class=gl_res.detected_class,
                region_visible=gl_res.region_visible,
                det_box=gl_res.det_box,
            )

        logger.info("PPE_REGION person=%d gloves=%s conf=%d hand_vis=%s optional=%s",
                    pidx, gl_res.status, gl_res.confidence, gl_res.region_visible,
                    _GLOVES_OPTIONAL)

        per_person.append(PersonPPEResult(
            person_idx=pidx, person_box=pb, person_conf=pconf,
            mask=mask_res, headcover=hc_res, gloves=gl_res,
        ))

    # ── Aggregate per check type + apply ONE streak tick per frame ────────────
    _CHECKS: list[tuple[str, str]] = [
        ("no_mask",      "mask"),
        ("no_headcover", "headcover"),
        ("no_gloves",    "gloves"),
    ]
    aggregated: dict[str, AggregatedPPECheck] = {}

    for vtype, attr in _CHECKS:
        items = [getattr(r, attr) for r in per_person]

        violating    = [it for it in items if it.status == "violation"]
        ok_items     = [it for it in items if it.status == "ok"]
        nr_items     = [it for it in items if it.status == "needs_review"]

        vcount = len(violating)
        nrcount = len(nr_items)
        pcount = len(items)

        if violating:
            # Any violation → aggregate is violation; reset streak.
            top_conf = max(it.confidence for it in violating)
            _streak_tick(cam_key, vtype, False)
            agg = AggregatedPPECheck(
                status="violation", confidence=top_conf,
                person_count=pcount, violating_count=vcount, needs_review_count=nrcount,
            )

        elif ok_items and not nr_items and not violating:
            # All persons show PPE → check streak.
            min_conf  = min(it.confidence for it in ok_items)
            confirmed = _streak_tick(cam_key, vtype, True)
            agg = AggregatedPPECheck(
                status="ok" if confirmed else "verifying",
                confidence=min_conf,
                person_count=pcount, violating_count=0, needs_review_count=0,
            )

        elif ok_items and nr_items:
            # Mix of detected PPE and unverified regions — do not confirm as clean.
            _streak_tick(cam_key, vtype, False)
            avg_conf = sum(it.confidence for it in ok_items) // len(ok_items)
            agg = AggregatedPPECheck(
                status="needs_review", confidence=avg_conf,
                person_count=pcount, violating_count=0, needs_review_count=nrcount,
            )

        else:
            # Only needs_review (model silent across all crops, or all regions too small).
            _streak_tick(cam_key, vtype, False)
            agg = AggregatedPPECheck(
                status="needs_review", confidence=0,
                person_count=pcount, violating_count=0, needs_review_count=nrcount,
            )

        logger.info(
            "PPE_REGION aggregate: type=%s status=%s conf=%d violating=%d/%d",
            vtype, agg.status, agg.confidence, vcount, pcount,
        )
        aggregated[vtype] = agg

    # ── Annotate evidence frame ────────────────────────────────────────────────
    try:
        annotated_b64 = _annotate_frame(frame_bgr, per_person, aggregated)
    except Exception as exc:
        logger.warning("ppe_region_pipeline: annotation failed: %s", exc)
        annotated_b64 = None

    return per_person, aggregated, annotated_b64
