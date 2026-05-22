"""
PPE Accuracy Test Script
Run from backend/ directory: python scripts/ppe_accuracy_test.py

Tests all three dedicated PPE models with realistic synthetic frames.
Prints raw detections, confidence, final decision, expected result, PASS/FAIL.
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

# Ensure app imports work
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

MODELS_DIR = Path(__file__).resolve().parents[1] / "ml" / "models"

# ─── Thresholds (must match ai_violation_service.py) ──────────────────────────
GLOVE_CONF_T   = 0.55
HAIRNET_CONF_T = 0.55
MASK_CONF_T    = 0.60
PERSON_CONF_T  = 0.45

# ─── Model class maps ─────────────────────────────────────────────────────────
GLOVE_CLASSES   = {0: "no_gloves",  1: "gloves"}
HAIRNET_CLASSES = {0: "hairnet",    1: "no_hairnet"}
MASK_CLASSES    = {0: "mask",       1: "no_mask"}

GLOVE_VIOLATION_IDS   = {0}
HAIRNET_VIOLATION_IDS = {1}
MASK_VIOLATION_IDS    = {1}

# ─── Frame builders ───────────────────────────────────────────────────────────
def _bgr(h, w, r, g, b):
    f = np.ones((h, w, 3), np.uint8)
    f[:] = (b, g, r)
    return f


def _draw_person(frame, *, skin=True, mask_color=None, glove_color=None, hairnet=False):
    """Draw a basic humanoid figure onto frame (centre of frame)."""
    h, w = frame.shape[:2]
    cx, cy = w // 2, h // 2

    # Body
    cv2.rectangle(frame, (cx - 40, cy - 10), (cx + 40, cy + 120), (50, 100, 200), -1)

    # Head
    head_color = (200, 165, 120) if skin else (80, 80, 80)
    if hairnet:
        head_color = (30, 30, 30)
        cv2.ellipse(frame, (cx, cy - 55), (40, 45), 0, 0, 360, (20, 20, 20), -1)
    cv2.ellipse(frame, (cx, cy - 55), (35, 40), 0, 0, 360, head_color, -1)

    # Face / mask
    if mask_color:
        cv2.rectangle(frame, (cx - 25, cy - 55), (cx + 25, cy - 25), mask_color, -1)
    else:
        # eyes + mouth
        cv2.circle(frame, (cx - 12, cy - 60), 4, (40, 40, 40), -1)
        cv2.circle(frame, (cx + 12, cy - 60), 4, (40, 40, 40), -1)
        cv2.ellipse(frame, (cx, cy - 40), (12, 6), 0, 0, 180, (40, 40, 40), 2)

    # Hands / gloves
    hand_color = glove_color if glove_color else ((200, 165, 120) if skin else (80, 80, 80))
    cv2.ellipse(frame, (cx - 55, cy + 60), (18, 22), 0, 0, 360, hand_color, -1)
    cv2.ellipse(frame, (cx + 55, cy + 60), (18, 22), 0, 0, 360, hand_color, -1)

    return frame


def make_frames():
    """Return list of (name, frame_bgr, expected_glove_vio, expected_hairnet_vio, expected_mask_vio)."""
    H, W = 480, 640
    frames = []

    # 1. Full PPE compliant — mask + gloves + hairnet
    f = _bgr(H, W, 230, 230, 230)
    _draw_person(f, mask_color=(0, 90, 200), glove_color=(0, 180, 0), hairnet=True)
    frames.append(("full_ppe_compliant",   f, False, False, False))

    # 2. No PPE at all — bare face, no gloves, no hairnet
    f = _bgr(H, W, 200, 200, 200)
    _draw_person(f, skin=True)
    frames.append(("no_ppe_violation",     f, True,  True,  True))

    # 3. Mask only — gloves/hairnet missing
    f = _bgr(H, W, 210, 210, 210)
    _draw_person(f, mask_color=(0, 80, 180))
    frames.append(("mask_only",            f, True,  True,  False))

    # 4. Gloves only — mask/hairnet missing
    f = _bgr(H, W, 215, 215, 215)
    _draw_person(f, glove_color=(0, 160, 0))
    frames.append(("gloves_only",          f, False, True,  True))

    # 5. Hairnet only — mask/gloves missing
    f = _bgr(H, W, 220, 220, 220)
    _draw_person(f, hairnet=True)
    frames.append(("hairnet_only",         f, True,  False, True))

    # 6. Empty kitchen — no person at all
    f = _bgr(H, W, 180, 180, 180)
    cv2.rectangle(f, (100, 300), (540, 479), (120, 100, 80), -1)  # counter
    frames.append(("no_person",            f, None,  None,  None))

    # 7. Two people — first with full PPE, second with no PPE
    f = _bgr(H, W, 200, 200, 200)
    sub1 = f[:, :300].copy()
    sub2 = f[:, 320:].copy()
    _draw_person(sub1, mask_color=(0, 90, 200), glove_color=(0, 180, 0), hairnet=True)
    _draw_person(sub2)
    f[:, :300] = sub1
    f[:, 320:] = sub2
    frames.append(("two_people_mixed",     f, True,  True,  True))  # at least one violation

    # 8. Dark kitchen lighting
    f = _bgr(H, W, 40, 40, 40)
    _draw_person(f, skin=True)
    frames.append(("dark_lighting",        f, True,  True,  True))

    # 9. Bright overexposed
    f = _bgr(H, W, 240, 240, 240)
    _draw_person(f, mask_color=(230, 230, 230), glove_color=(235, 235, 235), hairnet=True)
    frames.append(("bright_overexposed",   f, False, False, False))  # hard case

    # 10. Blank white (false positive check)
    f = _bgr(H, W, 255, 255, 255)
    frames.append(("blank_white_fp_check", f, False, False, False))

    return frames


# ─── Inference helpers ─────────────────────────────────────────────────────────
def _run_model(model, bgr_frame, conf_floor, class_names, violation_ids, threshold):
    """Run model; return (violation_detected, best_conf, raw_detections_list)."""
    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
    results = model(rgb, verbose=False, conf=conf_floor, iou=0.45)
    dets = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            conf   = float(box.conf[0])
            name   = class_names.get(cls_id, f"cls{cls_id}")
            if conf >= threshold:
                dets.append({"class": name, "conf": conf, "violation": cls_id in violation_ids})
    violation = any(d["violation"] for d in dets)
    best_conf = max((d["conf"] for d in dets), default=0.0)
    return violation, best_conf, dets


def _load_models():
    from ultralytics import YOLO
    print("Loading models…")
    glove   = YOLO(str(MODELS_DIR / "glove_best.pt"))
    hairnet = YOLO(str(MODELS_DIR / "hairnet_best.pt"))
    mask    = YOLO(str(MODELS_DIR / "mask_best.pt"))
    person  = YOLO(str(MODELS_DIR / "yolov8n.pt"))
    print("Models loaded.\n")
    return glove, hairnet, mask, person


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    glove_m, hairnet_m, mask_m, person_m = _load_models()
    frames = make_frames()

    total = passed = 0
    COL = 90
    print("=" * COL)
    print(f"{'TEST CASE':<28} {'MODEL':<10} {'RAW DETS':<34} {'RESULT':<12} {'EXPECTED':<10} STATUS")
    print("=" * COL)

    for name, frame, exp_g, exp_h, exp_m in frames:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Person check
        person_results = person_m(rgb, verbose=False, conf=PERSON_CONF_T)
        person_found = any(
            int(box.cls[0]) == 0 and float(box.conf[0]) >= PERSON_CONF_T
            for r in person_results for box in r.boxes
        )

        if exp_g is None:
            # No-person frame: just check person detector doesn't fire
            status = "PASS" if not person_found else "FAIL"
            total += 1
            passed += (1 if status == "PASS" else 0)
            print(f"{name:<28} {'yolov8n':<10} {'n/a':<34} {str(person_found):<12} {'False':<10} {status}")
            continue

        # Glove
        gv, gc, gd = _run_model(glove_m,   frame, GLOVE_CONF_T,   GLOVE_CLASSES,   GLOVE_VIOLATION_IDS,   GLOVE_CONF_T)
        hv, hc, hd = _run_model(hairnet_m, frame, HAIRNET_CONF_T, HAIRNET_CLASSES, HAIRNET_VIOLATION_IDS, HAIRNET_CONF_T)
        mv, mc, md = _run_model(mask_m,    frame, MASK_CONF_T,    MASK_CLASSES,    MASK_VIOLATION_IDS,    MASK_CONF_T)

        for label, vio, conf, dets, expected in [
            ("gloves",   gv, gc, gd, exp_g),
            ("hairnet",  hv, hc, hd, exp_h),
            ("mask",     mv, mc, md, exp_m),
        ]:
            raw_str = ", ".join(f"{d['class']}@{d['conf']:.2f}" for d in dets) or "—"
            result_str = "VIOLATION" if vio else ("no_det" if not dets else "ok")
            exp_str    = "VIOLATION" if expected else "ok/none"
            match = (vio == expected)
            status = "PASS" if match else "FAIL"
            total += 1
            passed += (1 if match else 0)
            col1 = name if label == "gloves" else ""
            print(f"{col1:<28} {label:<10} {raw_str:<34} {result_str:<12} {exp_str:<10} {status}")

        print()

    print("=" * COL)
    pct = 100 * passed // total if total else 0
    print(f"RESULT: {passed}/{total} tests passed  ({pct}%)")
    print("=" * COL)

    # Summary per-model
    print("\nNOTE: Synthetic frames may not exercise all model failure modes.")
    print("For production accuracy, replace frames with real kitchen webcam captures.")
    if pct < 80:
        print("\nWARNING: Accuracy below 80%. See ACCURACY_AUDIT.md for remediation plan.")


if __name__ == "__main__":
    main()
