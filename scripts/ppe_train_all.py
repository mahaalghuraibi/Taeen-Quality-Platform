#!/usr/bin/env python3
"""
Train all three PPE detection models (mask, headcover, gloves).

Model specs:
  Base:    yolov8n.pt (nano — fits in 6 GB RAM, CPU training OK)
  Epochs:  100 with patience=25 early stopping
  imgsz:   640 (models will run on 160px crops after upscaling, but trained
               at 640 for better feature learning)
  Batch:   8  (safe for 8 GB RAM; increase to 16 with more RAM)

Augmentation is tuned for CCTV kitchen conditions:
  - Strong brightness/saturation variation  (kitchen lighting changes)
  - Blur + grayscale                        (dome cameras)
  - Perspective warp                        (high ceiling angle)
  - Scale variation                         (different distances from camera)
  - No vertical flip (people stay upright)

After training, best weights are deployed to:
  backend/ml/models/mask_best.pt
  backend/ml/models/hairnet_best.pt    (headcover model)
  backend/ml/models/glove_best.pt

Usage:
  python scripts/ppe_train_all.py
  python scripts/ppe_train_all.py --model mask
  python scripts/ppe_train_all.py --model all --epochs 150 --batch 16
  python scripts/ppe_train_all.py --no-deploy   # train only, do not copy weights

Estimated training time on Mac M-series (MPS):
  ~45 min per model at 100 epochs with 1000 images
Estimated time on CPU only:
  ~4–6 hours per model (use --device cpu explicitly)
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = ROOT / "dataset"
MODELS_DIR = ROOT / "backend" / "ml" / "models"
ALT_MODELS_DIR = ROOT / "backend" / "app" / "ml" / "models"

# ─── Model configuration ──────────────────────────────────────────────────────
MODEL_CONFIG: dict[str, dict] = {
    "mask": {
        "data_yaml":    DATASET_ROOT / "ppe_mask"      / "data.yaml",
        "run_name":     "mask_v2",
        "deploy_as":    "mask_best.pt",
        "description":  "Face mask detection (mask=0, no_mask=1)",
    },
    "headcover": {
        "data_yaml":    DATASET_ROOT / "ppe_headcover" / "data.yaml",
        "run_name":     "headcover_v2",
        "deploy_as":    "hairnet_best.pt",   # kept for backend compatibility
        "description":  "Headcover detection (headcover=0, no_headcover=1)",
    },
    "gloves": {
        "data_yaml":    DATASET_ROOT / "ppe_gloves"    / "data.yaml",
        "run_name":     "gloves_v2",
        "deploy_as":    "glove_best.pt",
        "description":  "Gloves detection (no_gloves=0, gloves=1)",
    },
}

# ─── Training hyperparameters ──────────────────────────────────────────────────
TRAIN_KWARGS = {
    # Optimizer
    "optimizer":     "AdamW",
    "lr0":           0.001,
    "lrf":           0.01,
    "momentum":      0.937,
    "weight_decay":  0.0005,
    "warmup_epochs": 3,

    # Training stability
    "close_mosaic": 10,

    # ── CCTV kitchen augmentation ────────────────────────────────────────────
    # Colour: kitchen lighting changes dramatically (day/night, fluorescent vs LED)
    "hsv_h": 0.015,   # slight hue jitter
    "hsv_s": 0.7,     # strong saturation variation
    "hsv_v": 0.5,     # strong brightness variation (dark kitchens are common)

    # Geometry: cameras are ceiling-mounted at various angles
    "degrees":     10.0,    # ±10° rotation
    "translate":   0.1,     # ±10% translation
    "scale":       0.5,     # ±50% scale (far/near workers)
    "shear":       2.0,
    "perspective": 0.001,   # perspective warp (high-ceiling CCTV)
    "flipud":      0.0,     # no vertical flip
    "fliplr":      0.5,     # horizontal flip

    # Mixing
    "mosaic":      1.0,     # 4-image mosaic — helps small-object detection
    "mixup":       0.1,

    # Blur / degradation (dome cameras often have motion blur + compression)
    "blur":        0.3,
    "median_blur": 0.1,

    # Grayscale (some CCTV cameras switch to B&W at night)
    "grayscale": 0.2,
}


def _detect_device() -> str:
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "0"
    except Exception:
        pass
    return "cpu"


def train_model(
    model_key: str,
    *,
    epochs: int,
    batch: int,
    imgsz: int,
    device: str,
    no_deploy: bool,
    runs_dir: Path,
) -> bool:
    cfg = MODEL_CONFIG[model_key]
    data_yaml = cfg["data_yaml"]

    if not data_yaml.is_file():
        print(f"\n[{model_key}] dataset not found: {data_yaml}", file=sys.stderr)
        print(f"  Run: python scripts/ppe_build_split.py --model {model_key}", file=sys.stderr)
        return False

    print(f"\n{'='*60}")
    print(f"Training: {model_key.upper()}  ({cfg['description']})")
    print(f"Data:     {data_yaml}")
    print(f"Epochs:   {epochs}   Batch: {batch}   imgsz: {imgsz}   Device: {device}")
    print(f"{'='*60}")

    try:
        from ultralytics import YOLO
    except ImportError:
        print("ERROR: pip install ultralytics", file=sys.stderr)
        return False

    model = YOLO("yolov8n.pt")

    run_dir = runs_dir / model_key
    run_dir.mkdir(parents=True, exist_ok=True)

    model.train(
        data=str(data_yaml),
        epochs=epochs,
        batch=batch,
        imgsz=imgsz,
        device=device,
        project=str(run_dir),
        name=cfg["run_name"],
        exist_ok=True,
        patience=25,
        **TRAIN_KWARGS,
    )

    best_pt = run_dir / cfg["run_name"] / "weights" / "best.pt"
    if not best_pt.is_file():
        print(f"  ERROR: best.pt not found at {best_pt}", file=sys.stderr)
        return False

    print(f"\n  Training complete. Best weights: {best_pt}")

    if not no_deploy:
        deploy_name = cfg["deploy_as"]
        for dest_dir in [MODELS_DIR, ALT_MODELS_DIR]:
            dest = dest_dir / deploy_name
            if dest_dir.is_dir():
                shutil.copy2(best_pt, dest)
                print(f"  Deployed → {dest}")

    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Train PPE detection models")
    parser.add_argument("--model", choices=["mask", "headcover", "gloves", "all"], default="all")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch",  type=int, default=8)
    parser.add_argument("--imgsz",  type=int, default=640)
    parser.add_argument("--device", default="auto",
                        help="Device: auto / cpu / mps / 0 (CUDA GPU 0)")
    parser.add_argument("--no-deploy", action="store_true",
                        help="Do not copy weights to backend/ml/models/")
    parser.add_argument("--runs-dir", type=Path, default=ROOT / "runs" / "ppe",
                        help="Output directory for training runs")
    args = parser.parse_args()

    device = _detect_device() if args.device == "auto" else args.device
    print(f"Using device: {device}")

    models = list(MODEL_CONFIG.keys()) if args.model == "all" else [args.model]
    failed: list[str] = []

    for m in models:
        ok = train_model(
            m,
            epochs=args.epochs,
            batch=args.batch,
            imgsz=args.imgsz,
            device=device,
            no_deploy=args.no_deploy,
            runs_dir=args.runs_dir,
        )
        if not ok:
            failed.append(m)

    print("\n=== Training summary ===")
    for m in models:
        status = "FAILED" if m in failed else "OK"
        print(f"  {m:<12} {status}")

    if not args.no_deploy and len(models) > len(failed):
        print("\nRestart the FastAPI server to load new models.")
        print("Then run: python scripts/ppe_eval_models.py")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
