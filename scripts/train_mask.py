#!/usr/bin/env python3
"""
Train a YOLOv8s mask-detection model for kitchen / CCTV production use.

Base model : yolov8s.pt  (better accuracy than yolov8n with acceptable latency)
Classes    : 0=mask  1=no_mask
Epochs     : 50 (with early-stopping after 15 patience epochs)

Augmentations tuned for CCTV conditions:
  - brightness / saturation shifts  (variable kitchen lighting)
  - blur + median blur              (motion blur, low-res cameras)
  - grayscale conversion            (B&W dome cameras)
  - perspective warp                (high ceiling mount, oblique angles)
  - horizontal flip                 (mirror-image faces)
  - mosaic reduced to 0.5           (helps small-face recall)

Usage
-----
  # From the repo root
  python scripts/train_mask.py

  # Override dataset or output
  python scripts/train_mask.py --data dataset/mask_dataset.yaml --project runs/mask --epochs 80

After training the best weights are automatically copied to:
  backend/app/ml/models/mask_best.pt
Restart the FastAPI server to pick them up (the model is loaded lazily).
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # ska-system/
DEST = ROOT / "backend" / "app" / "ml" / "models" / "mask_best.pt"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train YOLOv8s mask detection model")
    p.add_argument(
        "--data",
        default=str(ROOT / "dataset" / "mask_dataset.yaml"),
        help="Path to dataset YAML (default: dataset/mask_dataset.yaml)",
    )
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--project", default=str(ROOT / "runs" / "mask"))
    p.add_argument("--name", default="mask_yolov8s")
    p.add_argument(
        "--no-deploy",
        action="store_true",
        help="Skip copying best.pt to backend/app/ml/models/",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        print("ultralytics not installed — run:  pip install ultralytics", file=sys.stderr)
        return 1

    data_path = Path(args.data)
    if not data_path.is_file():
        print(f"Dataset YAML not found: {data_path}", file=sys.stderr)
        print("Run  python scripts/organize_dataset.py  first to build yolo_export/.", file=sys.stderr)
        return 1

    print(f"Loading base model: yolov8s.pt")
    model = YOLO("yolov8s.pt")

    print(f"Starting training — epochs={args.epochs}  imgsz={args.imgsz}  batch={args.batch}")
    print(f"Dataset : {data_path}")
    print(f"Output  : {args.project}/{args.name}/")

    model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.project,
        name=args.name,
        exist_ok=True,

        # ── Optimizer ────────────────────────────────────────────────────────
        optimizer="AdamW",
        lr0=0.001,          # initial learning rate
        lrf=0.01,           # final lr = lr0 * lrf
        momentum=0.937,
        weight_decay=0.0005,
        warmup_epochs=3,

        # ── Early stopping ───────────────────────────────────────────────────
        patience=15,        # stop if mAP50 doesn't improve for 15 epochs
        close_mosaic=10,    # disable mosaic augmentation last 10 epochs

        # ── Image augmentations (CCTV-tuned) ─────────────────────────────────
        # Colour / exposure
        hsv_h=0.015,        # hue jitter — slight cast shifts
        hsv_s=0.5,          # saturation — indoor vs outdoor kitchen lighting
        hsv_v=0.4,          # value (brightness) — strong variation for dark kitchens

        # Geometry
        degrees=10,         # ±10° rotation — tilted cameras
        translate=0.1,      # ±10 % translation
        scale=0.5,          # ±50 % scale — cameras at different distances
        shear=2.0,          # slight shear distortion
        perspective=0.0005, # perspective warp — high-ceiling CCTV angle
        flipud=0.0,         # no vertical flip (people stay upright)
        fliplr=0.5,         # horizontal flip — face left/right equally

        # Mixing
        mosaic=0.5,         # 4-image mosaic — keep at 0.5 to preserve face size
        mixup=0.1,          # mild mixup
        copy_paste=0.0,     # copy-paste off (insufficient masks in scene)

        # Blur / quality degradation (CCTV cameras often have low quality)
        blur=0.3,           # random Gaussian blur (simulates motion + focus issues)
        median_blur=0.1,    # salt-and-pepper noise smoothing

        # Grayscale (B&W dome cameras are common in kitchens)
        grayscale=0.2,      # 20 % of batches converted to grayscale
    )

    # Locate the best weights produced by this run
    best_pt = Path(args.project) / args.name / "weights" / "best.pt"
    if not best_pt.is_file():
        print(f"\n⚠  best.pt not found at {best_pt} — training may have failed early.", file=sys.stderr)
        return 1

    print(f"\nTraining complete. Best weights: {best_pt}")

    if not args.no_deploy:
        DEST.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best_pt, DEST)
        print(f"Deployed → {DEST}")
        print("Restart the FastAPI server to load the new model.")
    else:
        print(f"--no-deploy set. Copy {best_pt} → {DEST} manually.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
