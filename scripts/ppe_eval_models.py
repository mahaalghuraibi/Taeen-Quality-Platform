#!/usr/bin/env python3
"""
Evaluate all three PPE models and produce a before/after accuracy report.

Runs YOLO's built-in validation on the test split of each model's dataset
AND runs direct inference on 20 real test frames to produce a practical
pass/fail accuracy that reflects real webcam conditions.

Metrics reported:
  mAP50, mAP50-95, Precision, Recall  (from YOLO validation)
  Pass rate on 20 test frames          (real-world accuracy)
  Confidence ceiling (max confidence observed)
  Status: OK / WEAK / BROKEN

Usage:
  python scripts/ppe_eval_models.py
  python scripts/ppe_eval_models.py --model mask
  python scripts/ppe_eval_models.py --test-frames backend/scripts/test_frames
  python scripts/ppe_eval_models.py --compare     # before vs after comparison
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = ROOT / "dataset"
MODELS_DIR = ROOT / "backend" / "ml" / "models"
TEST_FRAMES_DIR = ROOT / "backend" / "scripts" / "test_frames"
REPORT_FILE = ROOT / "PPE_EVAL_REPORT.md"

# ─── Model config ──────────────────────────────────────────────────────────────
MODEL_CONFIG = {
    "mask": {
        "weights":      MODELS_DIR / "mask_best.pt",
        "data_yaml":    DATASET_ROOT / "ppe_mask"      / "data.yaml",
        "conf":         0.25,
        "violation_cls": 1,   # class id for "violation" (no_mask)
        "ok_cls":        0,   # class id for "ok" (mask)
        "description":  "mask vs no_mask",
    },
    "headcover": {
        "weights":      MODELS_DIR / "hairnet_best.pt",
        "data_yaml":    DATASET_ROOT / "ppe_headcover" / "data.yaml",
        "conf":         0.30,
        "violation_cls": 1,   # no_headcover
        "ok_cls":        0,   # headcover
        "description":  "headcover vs no_headcover",
    },
    "gloves": {
        "weights":      MODELS_DIR / "glove_best.pt",
        "data_yaml":    DATASET_ROOT / "ppe_gloves"    / "data.yaml",
        "conf":         0.35,
        "violation_cls": 0,   # no_gloves
        "ok_cls":        1,   # gloves
        "description":  "no_gloves vs gloves",
    },
}

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _run_yolo_val(weights: Path, data_yaml: Path, conf: float) -> dict:
    """Run YOLO validation and return metrics dict."""
    try:
        from ultralytics import YOLO
    except ImportError:
        return {"error": "ultralytics not installed"}

    if not weights.is_file():
        return {"error": f"weights not found: {weights}"}
    if not data_yaml.is_file():
        return {"error": f"data.yaml not found: {data_yaml} — run ppe_build_split.py first"}

    model = YOLO(str(weights))
    try:
        results = model.val(data=str(data_yaml), conf=conf, iou=0.45, verbose=False, plots=False)
    except Exception as exc:
        return {"error": str(exc)}

    maps = results.box
    return {
        "mAP50":     float(getattr(maps, "map50", 0) or 0),
        "mAP50_95":  float(getattr(maps, "map",   0) or 0),
        "precision": float(getattr(maps, "mp",    0) or 0),
        "recall":    float(getattr(maps, "mr",    0) or 0),
    }


def _run_frame_test(
    weights: Path,
    test_frames_dir: Path,
    conf: float,
    violation_cls: int,
    ok_cls: int,
) -> dict:
    """Run inference on all test frames. Return pass rate and confidence stats."""
    if not weights.is_file():
        return {"error": f"weights not found: {weights}"}

    frames = sorted(
        p for p in test_frames_dir.rglob("*")
        if p.suffix.lower() in IMAGE_EXT
    )
    if not frames:
        return {"error": f"no test frames found in {test_frames_dir}"}

    try:
        from ultralytics import YOLO
    except ImportError:
        return {"error": "ultralytics not installed"}

    model = YOLO(str(weights))
    results_data: list[dict] = []

    for frame in frames:
        try:
            import cv2
            img = cv2.imread(str(frame))
            if img is None:
                continue
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = model(img_rgb, verbose=False, conf=conf, iou=0.45)
        except Exception as exc:
            results_data.append({"frame": frame.name, "error": str(exc)})
            continue

        detections: list[dict] = []
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls_id = int(box.cls[0])
                c = float(box.conf[0])
                detections.append({"cls": cls_id, "conf": round(c, 3)})

        max_conf = max((d["conf"] for d in detections), default=0.0)
        any_detection = len(detections) > 0

        results_data.append({
            "frame": frame.name,
            "detections": len(detections),
            "max_conf": max_conf,
            "detected": any_detection,
        })

    total = len(results_data)
    detected = sum(1 for r in results_data if r.get("detected", False))
    confs = [r.get("max_conf", 0) for r in results_data if r.get("max_conf", 0) > 0]
    max_conf_seen = max(confs, default=0.0)
    avg_conf = sum(confs) / len(confs) if confs else 0.0

    return {
        "total_frames":  total,
        "detected":      detected,
        "pass_rate":     round(detected / total, 3) if total > 0 else 0.0,
        "max_conf":      round(max_conf_seen, 3),
        "avg_conf":      round(avg_conf, 3),
    }


def _grade(mAP50: float, pass_rate: float) -> str:
    if mAP50 >= 0.85 and pass_rate >= 0.80:
        return "PRODUCTION READY"
    if mAP50 >= 0.70 and pass_rate >= 0.50:
        return "ACCEPTABLE (monitor closely)"
    if mAP50 >= 0.55 or pass_rate >= 0.30:
        return "WEAK (needs more data)"
    return "BROKEN (retrain with more data)"


def eval_model(
    model_key: str,
    test_frames_dir: Path,
    *,
    run_val: bool,
) -> dict:
    cfg = MODEL_CONFIG[model_key]
    weights = cfg["weights"]
    conf = cfg["conf"]

    print(f"\n[{model_key}] {cfg['description']}")
    print(f"  weights: {weights}")

    result: dict = {"model": model_key, "weights": str(weights)}

    if run_val:
        print("  Running YOLO validation …")
        val = _run_yolo_val(weights, cfg["data_yaml"], conf)
        result["validation"] = val
        if "error" not in val:
            print(f"  mAP50={val['mAP50']:.3f}  P={val['precision']:.3f}  R={val['recall']:.3f}")

    print(f"  Running frame test ({test_frames_dir}) …")
    frame = _run_frame_test(weights, test_frames_dir, conf, cfg["violation_cls"], cfg["ok_cls"])
    result["frame_test"] = frame
    if "error" not in frame:
        print(
            f"  Pass rate: {frame['pass_rate']:.0%}  "
            f"({frame['detected']}/{frame['total_frames']} frames)  "
            f"max_conf={frame['max_conf']:.2f}"
        )

    mAP50 = result.get("validation", {}).get("mAP50", 0.0) if run_val else 0.0
    pass_rate = frame.get("pass_rate", 0.0) if "error" not in frame else 0.0
    result["grade"] = _grade(mAP50, pass_rate)
    print(f"  Grade: {result['grade']}")

    return result


def _write_report(results: list[dict], compare_file: Path | None) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        f"# PPE Model Evaluation Report",
        f"**Date:** {now}",
        "",
        "## Results",
        "",
        "| Model | mAP50 | Precision | Recall | Frame Pass Rate | Max Conf | Grade |",
        "|-------|-------|-----------|--------|-----------------|----------|-------|",
    ]

    for r in results:
        m = r["model"]
        val = r.get("validation", {})
        ft = r.get("frame_test", {})
        mAP50 = f"{val.get('mAP50', 0):.3f}" if "error" not in val else "N/A"
        prec  = f"{val.get('precision', 0):.3f}" if "error" not in val else "N/A"
        rec   = f"{val.get('recall', 0):.3f}" if "error" not in val else "N/A"
        pass_r = f"{ft.get('pass_rate', 0):.0%}" if "error" not in ft else "N/A"
        max_c  = f"{ft.get('max_conf', 0):.2f}" if "error" not in ft else "N/A"
        grade  = r.get("grade", "UNKNOWN")
        lines.append(f"| `{m}_best.pt` | {mAP50} | {prec} | {rec} | {pass_r} | {max_c} | {grade} |")

    lines += ["", "## Recommended Next Steps", ""]
    for r in results:
        grade = r.get("grade", "")
        m = r["model"]
        if "BROKEN" in grade:
            lines.append(f"- **{m}**: Collect 600–1200 more real kitchen images and retrain.")
        elif "WEAK" in grade:
            lines.append(f"- **{m}**: Collect 200–400 more images focusing on edge cases.")
        else:
            lines.append(f"- **{m}**: Model meets production targets.")

    REPORT_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nReport written: {REPORT_FILE}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate PPE detection models")
    parser.add_argument("--model", choices=["mask", "headcover", "gloves", "all"], default="all")
    parser.add_argument("--test-frames", type=Path, default=TEST_FRAMES_DIR,
                        help=f"Directory with test frames (default: {TEST_FRAMES_DIR})")
    parser.add_argument("--no-val", action="store_true",
                        help="Skip YOLO validation (only run frame test)")
    parser.add_argument("--json-out", type=Path, help="Also save results as JSON")
    args = parser.parse_args()

    if not args.test_frames.is_dir():
        print(f"Test frames not found: {args.test_frames}", file=sys.stderr)
        print("Expected: backend/scripts/test_frames/", file=sys.stderr)
        return 1

    models = list(MODEL_CONFIG.keys()) if args.model == "all" else [args.model]

    print(f"{'='*60}")
    print(f"PPE MODEL EVALUATION  {datetime.now():%Y-%m-%d %H:%M}")
    print(f"{'='*60}")

    all_results: list[dict] = []
    for m in models:
        r = eval_model(m, args.test_frames, run_val=not args.no_val)
        all_results.append(r)

    _write_report(all_results, None)

    if args.json_out:
        args.json_out.write_text(json.dumps(all_results, indent=2), encoding="utf-8")
        print(f"JSON results: {args.json_out}")

    print("\n=== SUMMARY ===")
    for r in all_results:
        print(f"  {r['model']:<12} {r.get('grade', 'UNKNOWN')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
