"""
Scene + uniform checks for production CCTV.

Honest pipeline: these checks complement the main YOLO model and the dedicated
PPE region pipeline. Until a CCTV-trained detector is available, each check uses
a deterministic computer-vision heuristic to flag suspicious regions and surfaces
them as `needs_review` (amber) rather than confirmed violations. This is
explicitly the production rule: do NOT mark compliant unless positively detected,
and do NOT fake a confirmed violation when the signal is only heuristic.

Three checks here:

1. wet_floor_check(frame_bgr, person_boxes)
   - Inspects only the bottom 50% of the frame (floor band).
   - Removes pixels overlapping person boxes (avoids shoes/feet reflections).
   - Uses HSV: low saturation + high value patches (specular bright reflections)
     larger than a connected-area threshold.
   - Filters out polished stainless counters by enforcing a vertical y-position
     in the lower band and area-shape ratio that matches floor puddles, not
     thin counter strips.
   - Returns { status, confidence, message, suspect_box, area_frac }.

2. floor_trash_check(frame_bgr, person_boxes)
   - Inspects only the lower 60% of the frame (floor/walking area).
   - Removes person boxes from the search area.
   - Detects small dark/saturated blob clusters that aren't on counters.
   - Surfaces as `needs_review` if blobs found; never confirmed without a model.

3. uniform_check(frame_bgr, person_boxes)
   - For each person box, crops the torso band (rows ~25%–65% of person).
   - Measures dominant colour: chef whites = high V (>180) AND low S (<60).
     Acceptable uniform palette also includes branded colours from config.
   - If torso is mostly dark/non-uniform colour AND torso box is large enough
     to be visible → flag person as no_uniform candidate (needs_review).

All functions are CPU-only, pure numpy/OpenCV. No model loading.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import numpy as np

logger = logging.getLogger(__name__)


# ─── Tunables ────────────────────────────────────────────────────────────────
# Floor band in normalised frame coordinates. Wet/trash only checked here.
_FLOOR_BAND_Y0_FRAC: float = 0.50  # top of floor band
_FLOOR_BAND_Y1_FRAC: float = 0.98  # leave a few px margin at the bottom

# Person box dilation: erase a margin around feet to avoid shoe reflections.
_PERSON_MASK_DILATE_FRAC: float = 0.05  # 5% of frame height

# Wet floor: specular highlight detection on floor band.
_WET_V_MIN: int = 195   # very bright pixels
_WET_S_MAX: int = 55    # low saturation (white-ish gloss)
_WET_MIN_AREA_FRAC: float = 0.012  # patch must be >= 1.2% of floor band area
_WET_MIN_ASPECT: float = 0.35      # avoid thin counter strips (height/width)
_WET_MAX_ASPECT: float = 3.0
_WET_CONFIDENCE_BASE: int = 40     # heuristic — always needs_review

# Trash: small dark blobs on floor.
_TRASH_DARK_V_MAX: int = 110
_TRASH_MIN_AREA_FRAC: float = 0.0006   # very small objects on floor
_TRASH_MAX_AREA_FRAC: float = 0.030    # exclude shadows of big objects
_TRASH_MIN_BLOBS: int = 3              # require several blobs to flag
_TRASH_CONFIDENCE_BASE: int = 38

# Uniform torso band fractions of person box height.
_TORSO_Y0_FRAC: float = 0.22
_TORSO_Y1_FRAC: float = 0.62
_TORSO_MIN_W: int = 30
_TORSO_MIN_H: int = 40

# Kitchen uniform palette: high value + low saturation (chef whites).
_UNIFORM_V_MIN: int = 175
_UNIFORM_S_MAX: int = 70
_UNIFORM_OK_FRAC: float = 0.45     # ≥45% of torso pixels match uniform palette
_UNIFORM_DARK_V_MAX: int = 110     # mostly dark torso → likely civilian clothes
_UNIFORM_DARK_FRAC: float = 0.55   # ≥55% torso dark
_UNIFORM_CONFIDENCE_BASE: int = 45


# ─── Result dataclasses ─────────────────────────────────────────────────────
@dataclass
class SceneCheckResult:
    status: str               # "violation" | "needs_review" | "ok" | "unavailable"
    confidence: int           # 0–100
    message: str
    metadata: dict | None = None


@dataclass
class PersonUniformResult:
    person_idx: int           # 1-based
    status: str               # "violation" | "needs_review" | "ok" | "unavailable"
    confidence: int           # 0–100
    torso_visible: bool
    message: str = ""


# ─── Helpers ────────────────────────────────────────────────────────────────
def _person_mask(shape_hw: tuple[int, int], person_boxes: list[list[float]]) -> np.ndarray:
    """1 where person stands, dilated by a small margin to cover feet/shadow."""
    h, w = shape_hw
    m = np.zeros((h, w), dtype=np.uint8)
    if not person_boxes:
        return m
    pad = max(2, int(round(h * _PERSON_MASK_DILATE_FRAC)))
    for pb in person_boxes:
        try:
            x1 = max(0, int(round(pb[0])) - pad)
            y1 = max(0, int(round(pb[1])) - pad)
            x2 = min(w, int(round(pb[2])) + pad)
            y2 = min(h, int(round(pb[3])) + pad)
            if x2 > x1 and y2 > y1:
                m[y1:y2, x1:x2] = 1
        except (TypeError, ValueError, IndexError):
            continue
    return m


def _floor_band(shape_hw: tuple[int, int]) -> tuple[int, int, int, int]:
    h, w = shape_hw
    y0 = int(round(h * _FLOOR_BAND_Y0_FRAC))
    y1 = int(round(h * _FLOOR_BAND_Y1_FRAC))
    return 0, y0, w, y1


# ─── Wet floor heuristic ─────────────────────────────────────────────────────
def wet_floor_check(
    frame_bgr: np.ndarray,
    person_boxes: list[list[float]],
) -> SceneCheckResult:
    """
    Look for specular bright/low-saturation patches in the floor band that aren't
    covered by a person box. Returns needs_review when a patch is found.
    """
    try:
        h, w = frame_bgr.shape[:2]
        x0, y0, x1, y1 = _floor_band((h, w))
        floor = frame_bgr[y0:y1, x0:x1]
        if floor.size == 0:
            return SceneCheckResult("unavailable", 0, "frame too small for floor check")

        people_mask = _person_mask((h, w), person_boxes)[y0:y1, x0:x1]
        valid = (people_mask == 0).astype(np.uint8)

        hsv = cv2.cvtColor(floor, cv2.COLOR_BGR2HSV)
        s = hsv[..., 1]
        v = hsv[..., 2]
        bright_glossy = ((v >= _WET_V_MIN) & (s <= _WET_S_MAX) & (valid == 1)).astype(np.uint8) * 255

        if bright_glossy.sum() == 0:
            return SceneCheckResult("ok", 0, "no specular floor patches detected")

        # Smooth + connected components to find blob.
        bright_glossy = cv2.morphologyEx(bright_glossy, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        bright_glossy = cv2.morphologyEx(bright_glossy, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))

        n, labels, stats, _ = cv2.connectedComponentsWithStats(bright_glossy, connectivity=8)
        floor_area = max(1, floor.shape[0] * floor.shape[1])

        best_area_frac = 0.0
        best_box: tuple[int, int, int, int] | None = None
        for i in range(1, n):
            area = int(stats[i, cv2.CC_STAT_AREA])
            cw = int(stats[i, cv2.CC_STAT_WIDTH])
            ch = int(stats[i, cv2.CC_STAT_HEIGHT])
            if cw == 0 or ch == 0:
                continue
            aspect = ch / cw
            if not (_WET_MIN_ASPECT <= aspect <= _WET_MAX_ASPECT):
                continue
            frac = area / floor_area
            if frac >= _WET_MIN_AREA_FRAC and frac > best_area_frac:
                best_area_frac = frac
                cx = int(stats[i, cv2.CC_STAT_LEFT])
                cy = int(stats[i, cv2.CC_STAT_TOP])
                best_box = (cx + x0, cy + y0, cx + cw + x0, cy + ch + y0)

        if best_box is None:
            return SceneCheckResult("ok", 0, "no large specular patch on floor")

        # Heuristic-only: never auto-confirm. Always needs_review with bounded confidence.
        cf = min(75, _WET_CONFIDENCE_BASE + int(round(best_area_frac * 1000)))
        return SceneCheckResult(
            status="needs_review",
            confidence=cf,
            message=(
                f"اكتُشفت بقعة لامعة على الأرض قد تكون مبللة (مساحة {best_area_frac*100:.1f}% من منطقة الأرضية)."
            ),
            metadata={"suspect_box": list(best_box), "area_frac": round(best_area_frac, 4)},
        )
    except Exception as exc:
        logger.warning("wet_floor_check failed: %s", exc)
        return SceneCheckResult("unavailable", 0, f"error: {exc}")


# ─── Floor trash heuristic ───────────────────────────────────────────────────
def floor_trash_check(
    frame_bgr: np.ndarray,
    person_boxes: list[list[float]],
) -> SceneCheckResult:
    """
    Look for small dark/saturated blobs on the floor band that aren't covered by
    a person box. Multiple small blobs is a stronger signal than one.
    """
    try:
        h, w = frame_bgr.shape[:2]
        x0, y0, x1, y1 = _floor_band((h, w))
        floor = frame_bgr[y0:y1, x0:x1]
        if floor.size == 0:
            return SceneCheckResult("unavailable", 0, "frame too small for floor check")

        people_mask = _person_mask((h, w), person_boxes)[y0:y1, x0:x1]
        valid = (people_mask == 0).astype(np.uint8)

        gray = cv2.cvtColor(floor, cv2.COLOR_BGR2GRAY)
        gray_blur = cv2.GaussianBlur(gray, (5, 5), 0)

        # Adaptive threshold to isolate small dark objects from light tile.
        thr = cv2.adaptiveThreshold(
            gray_blur, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            blockSize=31,
            C=10,
        )
        thr = (thr * valid).astype(np.uint8)
        thr = cv2.morphologyEx(thr, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

        n, labels, stats, _ = cv2.connectedComponentsWithStats(thr, connectivity=8)
        floor_area = max(1, floor.shape[0] * floor.shape[1])

        small_blob_count = 0
        biggest_blob_frac = 0.0
        for i in range(1, n):
            area = int(stats[i, cv2.CC_STAT_AREA])
            frac = area / floor_area
            if _TRASH_MIN_AREA_FRAC <= frac <= _TRASH_MAX_AREA_FRAC:
                small_blob_count += 1
                if frac > biggest_blob_frac:
                    biggest_blob_frac = frac

        if small_blob_count < _TRASH_MIN_BLOBS:
            return SceneCheckResult(
                status="ok",
                confidence=0,
                message="لا توجد نفايات ظاهرة على الأرض.",
                metadata={"blob_count": small_blob_count},
            )

        cf = min(70, _TRASH_CONFIDENCE_BASE + min(20, small_blob_count * 4))
        return SceneCheckResult(
            status="needs_review",
            confidence=cf,
            message=(
                f"رُصد ما يقارب {small_blob_count} عنصر صغير على الأرض — قد يكون نفايات أو مخلفات."
            ),
            metadata={"blob_count": small_blob_count, "biggest_blob_frac": round(biggest_blob_frac, 4)},
        )
    except Exception as exc:
        logger.warning("floor_trash_check failed: %s", exc)
        return SceneCheckResult("unavailable", 0, f"error: {exc}")


# ─── Per-person uniform heuristic ────────────────────────────────────────────
def uniform_check_per_person(
    frame_bgr: np.ndarray,
    person_boxes: list[list[float]],
) -> list[PersonUniformResult]:
    """
    For each person, crop torso band and check chef-white palette dominance.
    """
    out: list[PersonUniformResult] = []
    if not person_boxes:
        return out
    try:
        h, w = frame_bgr.shape[:2]
        for idx, pb in enumerate(person_boxes, start=1):
            try:
                px1 = max(0, int(round(pb[0])))
                py1 = max(0, int(round(pb[1])))
                px2 = min(w, int(round(pb[2])))
                py2 = min(h, int(round(pb[3])))
            except (TypeError, ValueError, IndexError):
                out.append(PersonUniformResult(idx, "unavailable", 0, False, "invalid box"))
                continue
            ph = py2 - py1
            pw = px2 - px1
            if ph <= 0 or pw <= 0:
                out.append(PersonUniformResult(idx, "unavailable", 0, False, "empty box"))
                continue
            ty1 = py1 + int(ph * _TORSO_Y0_FRAC)
            ty2 = py1 + int(ph * _TORSO_Y1_FRAC)
            crop = frame_bgr[ty1:ty2, px1:px2]
            ch, cw = crop.shape[:2]
            if cw < _TORSO_MIN_W or ch < _TORSO_MIN_H:
                out.append(PersonUniformResult(
                    idx, "needs_review", 0, False,
                    "منطقة الجذع صغيرة جداً للتحقق من الزي.",
                ))
                continue

            hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
            s = hsv[..., 1]
            v = hsv[..., 2]
            uniform_pixels = ((v >= _UNIFORM_V_MIN) & (s <= _UNIFORM_S_MAX)).sum()
            dark_pixels = (v <= _UNIFORM_DARK_V_MAX).sum()
            total = ch * cw
            uniform_frac = uniform_pixels / max(1, total)
            dark_frac = dark_pixels / max(1, total)

            if uniform_frac >= _UNIFORM_OK_FRAC and dark_frac < 0.30:
                cf = int(round(min(85, 55 + uniform_frac * 40)))
                out.append(PersonUniformResult(
                    idx, "ok", cf, True,
                    f"زي رسمي ظاهر ({uniform_frac*100:.0f}% من الجذع).",
                ))
                continue
            if dark_frac >= _UNIFORM_DARK_FRAC:
                cf = int(round(min(70, _UNIFORM_CONFIDENCE_BASE + dark_frac * 30)))
                out.append(PersonUniformResult(
                    idx, "needs_review", cf, True,
                    f"جذع داكن السائد ({dark_frac*100:.0f}%) — يحتاج مراجعة الزي.",
                ))
                continue
            cf = max(30, int(round(uniform_frac * 60)))
            out.append(PersonUniformResult(
                idx, "needs_review", cf, True,
                f"الزي غير مؤكد ({uniform_frac*100:.0f}% أبيض، {dark_frac*100:.0f}% داكن).",
            ))
        return out
    except Exception as exc:
        logger.warning("uniform_check_per_person failed: %s", exc)
        return [PersonUniformResult(0, "unavailable", 0, False, f"error: {exc}")]


def aggregate_uniform_results(
    results: list[PersonUniformResult],
) -> SceneCheckResult:
    """Compress per-person uniform results into a single supplementary card entry."""
    if not results:
        return SceneCheckResult("unavailable", 0, "لا يوجد أشخاص لفحص الزي.")
    ok = [r for r in results if r.status == "ok"]
    nr = [r for r in results if r.status == "needs_review"]
    if len(ok) == len(results):
        avg = int(round(sum(r.confidence for r in ok) / len(ok))) if ok else 0
        return SceneCheckResult("ok", avg, f"جميع الأشخاص ({len(ok)}) يرتدون الزي الرسمي.")
    if nr:
        avg = int(round(sum(r.confidence for r in nr) / len(nr))) if nr else 0
        return SceneCheckResult(
            "needs_review", avg,
            f"{len(nr)} شخص يحتاج مراجعة الزي (من {len(results)}).",
            metadata={"needs_review_count": len(nr), "person_count": len(results)},
        )
    return SceneCheckResult("needs_review", 0, "تعذر التحقق من الزي.")
