#!/usr/bin/env python3
"""
Retrain mask and headcover (hairnet) PPE models using YOLOv8m.

Workflow
--------
1. Download datasets from Roboflow (requires ROBOFLOW_API_KEY env var).
2. Validate images + labels; remove corrupt/bad pairs.
3. Build merged 70/20/10 train/valid/test splits.
4. Train YOLOv8m — 100 epochs, patience 20, imgsz 640, CCTV augmentation.
5. Print confusion matrix path and per-class metrics.
6. Deploy best.pt → backend/ml/models/{mask,hairnet}_best.pt

Usage
-----
  export ROBOFLOW_API_KEY="your_key_here"
  python scripts/retrain_mask_headcover.py

  # Skip download if data already downloaded:
  python scripts/retrain_mask_headcover.py --skip-download

  # Train only one model:
  python scripts/retrain_mask_headcover.py --model mask
  python scripts/retrain_mask_headcover.py --model headcover

  # Do not copy to backend after training:
  python scripts/retrain_mask_headcover.py --no-deploy
"""
from __future__ import annotations

import argparse
import os
import random
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]   # ska-system/
DATASET_DIR = ROOT / "dataset"
SOURCES_DIR = DATASET_DIR / "ppe_sources"
RUNS_DIR = ROOT / "runs"
BACKEND_MODELS = ROOT / "backend" / "ml" / "models"
# Secondary model copy (app/ subdirectory) — kept in sync after deploy
BACKEND_APP_MODELS = ROOT / "backend" / "app" / "ml" / "models"

# Hairnet labels already exist here (images missing — need re-download)
HAIRNET_EXISTING = Path("/Users/ladymha_/Desktop/glove-detection/datasets/hairnet")

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# ── Roboflow dataset IDs ──────────────────────────────────────────────────────
# Format: (workspace, project, version)
MASK_RF_SOURCES = [
    # Prajna Bhandary face mask dataset — 7553 images, MIT license
    # Classification-only: needs ppe_autolabel_faces.py first
    # Skipped here because it lacks bboxes. Use the pre-labeled sources instead.

    # Pre-labeled, YOLOv8 format — mask / no_mask bboxes ready to use
    ("militech",       "face-mask-detection-ctmwm",   3),   # ~853 images
    ("joseph-nelson",  "mask-wearing-or-not",          4),   # ~800 images
]

HEADCOVER_RF_SOURCES = [
    # maha-alghuraibi/hairnet — 3643 images, CC BY 4.0
    # Labels already on disk at HAIRNET_EXISTING — only re-download images.
    ("maha-alghuraibi", "hairnet-fb3td",  1),
]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def _count_images(folder: Path) -> int:
    if not folder.is_dir():
        return 0
    return sum(1 for p in folder.rglob("*") if p.suffix.lower() in IMAGE_EXT)


def _count_labels(folder: Path) -> int:
    if not folder.is_dir():
        return 0
    return sum(1 for p in folder.rglob("*.txt") if p.name not in ("classes.txt", "notes.json"))


def _check_roboflow_key() -> str:
    key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if not key:
        print("\n" + "=" * 70)
        print("ERROR: ROBOFLOW_API_KEY is not set.")
        print()
        print("  1. Create a free account at https://roboflow.com")
        print("  2. Go to Settings → API Keys → copy your key")
        print("  3. Run:")
        print()
        print('     export ROBOFLOW_API_KEY="paste_your_key_here"')
        print("     python scripts/retrain_mask_headcover.py")
        print()
        print("  OR skip download if you already have data:")
        print("     python scripts/retrain_mask_headcover.py --skip-download")
        print("=" * 70 + "\n")
        sys.exit(1)
    return key


def _install_roboflow() -> None:
    try:
        import roboflow  # noqa: F401
    except ImportError:
        _log("Installing roboflow package...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "roboflow", "-q"])


# ─────────────────────────────────────────────────────────────────────────────
# Download
# ─────────────────────────────────────────────────────────────────────────────

def download_mask_datasets(api_key: str) -> list[Path]:
    """Download mask datasets from Roboflow. Returns list of downloaded roots."""
    _install_roboflow()
    from roboflow import Roboflow

    downloaded: list[Path] = []
    rf = Roboflow(api_key=api_key)

    for workspace, project_id, version in MASK_RF_SOURCES:
        dest = SOURCES_DIR / f"rf_mask_{project_id.replace('-', '_')}"
        if _count_images(dest) > 0:
            _log(f"  SKIP  {project_id} — already downloaded ({_count_images(dest)} images)")
            downloaded.append(dest)
            continue

        _log(f"  Downloading {workspace}/{project_id} v{version} ...")
        try:
            project = rf.workspace(workspace).project(project_id)
            dataset = project.version(version).download("yolov8", location=str(dest))
            _log(f"  OK    {project_id} → {dest} ({_count_images(dest)} images)")
            downloaded.append(dest)
        except Exception as exc:
            _log(f"  FAIL  {project_id}: {exc}")
            _log("         Continuing with other sources...")

    return downloaded


def download_headcover_datasets(api_key: str) -> list[Path]:
    """Download hairnet/headcover datasets from Roboflow."""
    _install_roboflow()
    from roboflow import Roboflow

    downloaded: list[Path] = []
    rf = Roboflow(api_key=api_key)

    for workspace, project_id, version in HEADCOVER_RF_SOURCES:
        dest = SOURCES_DIR / f"rf_headcover_{project_id.replace('-', '_')}"

        # If labels already exist at the legacy path, check if we can just
        # download images into the Roboflow export format.
        if _count_images(dest) > 0:
            _log(f"  SKIP  {project_id} — already downloaded ({_count_images(dest)} images)")
            downloaded.append(dest)
            continue

        _log(f"  Downloading {workspace}/{project_id} v{version} ...")
        try:
            project = rf.workspace(workspace).project(project_id)
            dataset = project.version(version).download("yolov8", location=str(dest))
            img_count = _count_images(dest)
            _log(f"  OK    {project_id} → {dest} ({img_count} images)")
            downloaded.append(dest)
        except Exception as exc:
            _log(f"  FAIL  {project_id}: {exc}")

    # If the new download succeeded AND legacy labels exist at HAIRNET_EXISTING,
    # no need to merge — new download has both images and labels.
    return downloaded


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

def _validate_pair(img_path: Path, label_path: Path) -> bool:
    """Return True if the image is readable and all label lines are valid YOLO."""
    try:
        import cv2
        img = cv2.imread(str(img_path))
        if img is None or img.shape[0] < 8 or img.shape[1] < 8:
            return False
    except Exception:
        return False

    if label_path.exists():
        for line in label_path.read_text(encoding="utf-8").splitlines():
            parts = line.strip().split()
            if not parts:
                continue
            try:
                cls = int(parts[0])
                coords = [float(x) for x in parts[1:]]
            except ValueError:
                return False
            if len(coords) != 4:
                return False
            cx, cy, bw, bh = coords
            if not (0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0
                    and 0.0 < bw <= 1.0 and 0.0 < bh <= 1.0):
                return False
    return True


def validate_source(source_dir: Path) -> tuple[int, int]:
    """Validate all image/label pairs in a Roboflow export. Returns (ok, removed)."""
    ok = removed = 0
    for img in source_dir.rglob("*"):
        if img.suffix.lower() not in IMAGE_EXT:
            continue
        lbl = img.parent.parent / "labels" / (img.stem + ".txt")
        if lbl.parent.name == "images":
            lbl = img.parent.parent / "labels" / (img.stem + ".txt")
        # Try sibling labels/ folder
        lbl_alt = img.with_suffix(".txt").parent.parent / "labels" / (img.stem + ".txt")

        label_file = lbl if lbl.exists() else (lbl_alt if lbl_alt.exists() else img.with_suffix(".txt"))

        if _validate_pair(img, label_file):
            ok += 1
        else:
            removed += 1
            _log(f"    REMOVE bad pair: {img.name}")
            img.unlink(missing_ok=True)
            if label_file.exists():
                label_file.unlink()

    return ok, removed


# ─────────────────────────────────────────────────────────────────────────────
# Dataset merge + split
# ─────────────────────────────────────────────────────────────────────────────

def _collect_pairs(source_roots: list[Path]) -> list[tuple[Path, Path | None]]:
    """Collect (image, label_or_None) pairs from Roboflow-format directories."""
    pairs: list[tuple[Path, Path | None]] = []
    seen_stems: set[str] = set()

    for root in source_roots:
        for img in sorted(root.rglob("*")):
            if img.suffix.lower() not in IMAGE_EXT:
                continue
            # Skip venv / package images
            if ".venv" in img.parts or "site-packages" in img.parts:
                continue

            stem = img.stem
            if stem in seen_stems:
                continue
            seen_stems.add(stem)

            # Look for label in parallel labels/ folder
            lbl: Path | None = None
            for part in ("images",):
                if part in img.parts:
                    idx = list(img.parts).index(part)
                    lbl_candidate = Path(*img.parts[:idx]) / "labels" / (stem + ".txt")
                    if lbl_candidate.exists():
                        lbl = lbl_candidate
                        break

            pairs.append((img, lbl))

    return pairs


def build_split(
    model_name: str,
    source_roots: list[Path],
    class_names: list[str],
    train_ratio: float = 0.70,
    valid_ratio: float = 0.20,
    # test gets the remainder
) -> Path:
    """
    Merge sources, deduplicate, split 70/20/10, write YOLO structure.
    Returns path to data.yaml.
    """
    out_dir = DATASET_DIR / f"ppe_{model_name}"
    _log(f"Building split for {model_name} → {out_dir}")

    for split in ("train", "valid", "test"):
        (out_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    pairs = _collect_pairs(source_roots)
    if not pairs:
        _log(f"  ERROR: No images found in sources for {model_name}!")
        return Path()

    _log(f"  Total pairs found: {len(pairs)}")
    random.seed(42)
    random.shuffle(pairs)

    n = len(pairs)
    n_train = int(n * train_ratio)
    n_valid = int(n * valid_ratio)

    splits = {
        "train": pairs[:n_train],
        "valid": pairs[n_train:n_train + n_valid],
        "test":  pairs[n_train + n_valid:],
    }

    counts: dict[str, int] = {}
    for split_name, split_pairs in splits.items():
        img_dir = out_dir / "images" / split_name
        lbl_dir = out_dir / "labels" / split_name
        for img_src, lbl_src in split_pairs:
            dst_img = img_dir / img_src.name
            shutil.copy2(img_src, dst_img)
            if lbl_src and lbl_src.exists():
                shutil.copy2(lbl_src, lbl_dir / (img_src.stem + ".txt"))
        counts[split_name] = len(split_pairs)

    yaml_path = out_dir / "data.yaml"
    yaml_path.write_text(
        f"path: {out_dir}\n"
        f"train: images/train\n"
        f"val:   images/valid\n"
        f"test:  images/test\n"
        f"\n"
        f"nc: {len(class_names)}\n"
        f"names: {class_names}\n",
        encoding="utf-8",
    )

    _log(f"  train={counts['train']}  valid={counts['valid']}  test={counts['test']}")
    _log(f"  data.yaml → {yaml_path}")
    return yaml_path


# ─────────────────────────────────────────────────────────────────────────────
# Training
# ─────────────────────────────────────────────────────────────────────────────

def train_model(
    model_name: str,
    data_yaml: Path,
    deploy_dest: Path,
    epochs: int = 100,
    patience: int = 20,
    imgsz: int = 640,
    batch: int = 16,
) -> Path:
    """Train YOLOv8m, print metrics, deploy best.pt. Returns best.pt path."""
    try:
        from ultralytics import YOLO
    except ImportError:
        _log("Installing ultralytics...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "ultralytics", "-q"])
        from ultralytics import YOLO

    _log(f"\n{'=' * 70}")
    _log(f"TRAINING: {model_name.upper()}")
    _log(f"  data:    {data_yaml}")
    _log(f"  model:   yolov8m.pt")
    _log(f"  epochs:  {epochs}  patience: {patience}")
    _log(f"  imgsz:   {imgsz}  batch: {batch}")
    _log(f"{'=' * 70}\n")

    model = YOLO("yolov8m.pt")

    project_dir = RUNS_DIR / model_name
    project_dir.mkdir(parents=True, exist_ok=True)

    results = model.train(
        data=str(data_yaml),
        epochs=epochs,
        patience=patience,
        imgsz=imgsz,
        batch=batch,
        device="mps",            # Mac M-series GPU
        optimizer="AdamW",
        lr0=0.001,
        lrf=0.01,
        warmup_epochs=3,
        # ── CCTV-tuned augmentation ──────────────────────────────────────
        # Strong HSV — kitchen lighting is variable (fluorescent, halogen, dark)
        hsv_h=0.015,
        hsv_s=0.7,
        hsv_v=0.5,
        # Perspective warp — ceiling-mounted cameras at 45–70° angle
        perspective=0.001,
        # Blur — low-resolution CCTV, motion blur on moving workers
        blur=0.3,
        # Grayscale — older B&W dome cameras
        degrees=10.0,            # slight rotation (camera not perfectly level)
        translate=0.1,
        scale=0.5,               # wide scale range — workers at different distances
        fliplr=0.5,              # horizontal flip (mirror faces)
        mosaic=1.0,              # always use mosaic (multiple people in frame)
        mixup=0.1,
        copy_paste=0.1,
        erasing=0.4,
        auto_augment="randaugment",
        # ── Output ──────────────────────────────────────────────────────
        plots=True,              # confusion matrix, P-R curves, class-wise metrics
        save=True,
        save_period=10,
        project=str(project_dir),
        name="train",
        exist_ok=False,
    )

    # Find the best weights
    run_dir = Path(results.save_dir) if hasattr(results, "save_dir") else project_dir / "train"
    best_pt = run_dir / "weights" / "best.pt"

    if not best_pt.exists():
        # Fallback: search
        candidates = sorted((project_dir).glob("**/best.pt"), key=lambda p: p.stat().st_mtime)
        if candidates:
            best_pt = candidates[-1]

    _log(f"\n{'─' * 70}")
    _log(f"Training complete: {model_name}")
    _log(f"  Best weights: {best_pt}")
    _log(f"  Confusion matrix: {run_dir}/confusion_matrix.png")
    _log(f"  Per-class PR:     {run_dir}/PR_curve.png")
    _log(f"  Results CSV:      {run_dir}/results.csv")
    _log(f"{'─' * 70}\n")

    # Print summary metrics from results.csv if available
    _print_final_metrics(run_dir / "results.csv")

    # Validate on test split
    _log(f"Running validation on test split...")
    val_model = YOLO(str(best_pt))
    val_metrics = val_model.val(data=str(data_yaml), split="test", device="mps", plots=True)
    if val_metrics:
        _log(f"  Test mAP50:   {getattr(val_metrics, 'box', {}).get('map50', 'N/A') if hasattr(val_metrics, 'box') else 'N/A'}")

    # Deploy
    if best_pt.exists():
        deploy_dest.parent.mkdir(parents=True, exist_ok=True)
        backup = deploy_dest.with_stem(deploy_dest.stem + "_prev_backup")
        if deploy_dest.exists():
            shutil.copy2(deploy_dest, backup)
            _log(f"  Backed up old model → {backup.name}")
        shutil.copy2(best_pt, deploy_dest)
        _log(f"  Deployed: {best_pt} → {deploy_dest}")
        # Keep secondary app/ copy in sync
        app_dest = BACKEND_APP_MODELS / deploy_dest.name
        if app_dest.parent.exists():
            shutil.copy2(best_pt, app_dest)
            _log(f"  Synced:   {app_dest}")
    else:
        _log(f"  WARNING: best.pt not found at {best_pt} — skipping deploy")

    return best_pt


def _print_final_metrics(csv_path: Path) -> None:
    if not csv_path.exists():
        return
    try:
        lines = csv_path.read_text(encoding="utf-8").strip().splitlines()
        if len(lines) < 2:
            return
        header = [h.strip() for h in lines[0].split(",")]
        last = [v.strip() for v in lines[-1].split(",")]
        row = dict(zip(header, last))

        metrics = [
            ("metrics/precision(B)", "Precision"),
            ("metrics/recall(B)",    "Recall"),
            ("metrics/mAP50(B)",     "mAP@50"),
            ("metrics/mAP50-95(B)",  "mAP@50-95"),
        ]
        _log("  Final epoch metrics:")
        for key, label in metrics:
            val = row.get(key, "—")
            try:
                val = f"{float(val):.4f}"
            except (ValueError, TypeError):
                pass
            _log(f"    {label:<15} {val}")
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# Preflight check
# ─────────────────────────────────────────────────────────────────────────────

def preflight() -> None:
    """Print environment info and warn about known issues."""
    _log("Preflight check:")
    try:
        import torch
        _log(f"  torch:      {torch.__version__}")
        _log(f"  MPS:        {torch.backends.mps.is_available()}")
        _log(f"  CUDA:       {torch.cuda.is_available()}")
    except ImportError:
        _log("  torch:      NOT INSTALLED")

    try:
        import ultralytics
        _log(f"  ultralytics: {ultralytics.__version__}")
    except ImportError:
        _log("  ultralytics: NOT INSTALLED (will install)")

    _log(f"  Python:     {sys.version.split()[0]}")
    _log(f"  ROOT:       {ROOT}")
    _log(f"  SOURCES:    {SOURCES_DIR}")
    _log(f"  BACKEND:    {BACKEND_MODELS}")
    print()


def check_existing_data(model_name: str) -> tuple[int, int]:
    """Return (image_count, label_count) for merged split if it exists."""
    split_dir = DATASET_DIR / f"ppe_{model_name}"
    imgs = sum(_count_images(split_dir / "images" / s) for s in ("train", "valid", "test"))
    lbls = sum(_count_labels(split_dir / "labels" / s) for s in ("train", "valid", "test"))
    return imgs, lbls


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Retrain mask + headcover YOLOv8m models")
    parser.add_argument(
        "--model", choices=["mask", "headcover", "both"], default="both",
        help="Which model to retrain (default: both)",
    )
    parser.add_argument(
        "--skip-download", action="store_true",
        help="Skip Roboflow download (use data already on disk)",
    )
    parser.add_argument(
        "--skip-split", action="store_true",
        help="Skip dataset split rebuild (use existing ppe_mask / ppe_headcover splits)",
    )
    parser.add_argument(
        "--no-deploy", action="store_true",
        help="Do not copy trained weights to backend/ml/models/",
    )
    parser.add_argument("--epochs",   type=int, default=100)
    parser.add_argument("--patience", type=int, default=20)
    parser.add_argument("--imgsz",   type=int, default=640)
    parser.add_argument("--batch",   type=int, default=16)
    args = parser.parse_args()

    preflight()

    do_mask      = args.model in ("mask", "both")
    do_headcover = args.model in ("headcover", "both")

    api_key: str = ""
    if not args.skip_download:
        api_key = _check_roboflow_key()

    # ── MASK ─────────────────────────────────────────────────────────────────
    mask_yaml: Path | None = None
    if do_mask:
        _log("=== MASK MODEL ===")
        mask_sources: list[Path] = []

        if not args.skip_download:
            _log("Downloading mask datasets from Roboflow...")
            mask_sources = download_mask_datasets(api_key)
        else:
            # Use whatever is on disk
            for p in SOURCES_DIR.glob("rf_mask_*"):
                if _count_images(p) > 0:
                    mask_sources.append(p)
            _log(f"  Found {len(mask_sources)} mask source(s) on disk")

        if not mask_sources:
            _log("  ERROR: No mask data available. Cannot train mask model.")
            _log("         Run without --skip-download and set ROBOFLOW_API_KEY.")
            if not do_headcover:
                return 1
        else:
            if not args.skip_split:
                _log("Validating mask images...")
                total_ok = total_bad = 0
                for src in mask_sources:
                    ok, bad = validate_source(src)
                    _log(f"  {src.name}: {ok} ok, {bad} removed")
                    total_ok += ok
                    total_bad += bad
                _log(f"  Total: {total_ok} valid, {total_bad} removed")

                if total_ok < 200:
                    _log(f"  WARNING: Only {total_ok} valid mask images — model will be weak.")
                    _log("           Collect more real kitchen images before retraining.")

                mask_yaml = build_split(
                    "mask", mask_sources,
                    class_names=["mask", "no_mask"],
                )
            else:
                mask_yaml = DATASET_DIR / "ppe_mask" / "data.yaml"
                imgs, lbls = check_existing_data("mask")
                _log(f"  Using existing mask split: {imgs} images, {lbls} labels")
                if imgs < 100:
                    _log("  ERROR: Existing mask split has <100 images. Cannot train.")
                    mask_yaml = None

    # ── HEADCOVER ────────────────────────────────────────────────────────────
    headcover_yaml: Path | None = None
    if do_headcover:
        _log("\n=== HEADCOVER MODEL ===")
        headcover_sources: list[Path] = []

        if not args.skip_download:
            _log("Downloading headcover datasets from Roboflow...")
            headcover_sources = download_headcover_datasets(api_key)
        else:
            for p in SOURCES_DIR.glob("rf_headcover_*"):
                if _count_images(p) > 0:
                    headcover_sources.append(p)
            _log(f"  Found {len(headcover_sources)} headcover source(s) on disk")

        # If the full hairnet dataset was re-downloaded, use it.
        # If not, warn about missing images.
        legacy_imgs = _count_images(HAIRNET_EXISTING / "train" / "images")
        if legacy_imgs == 0 and not headcover_sources:
            _log("  ERROR: Hairnet images are 0 on disk and no new download succeeded.")
            _log(f"         Labels exist at: {HAIRNET_EXISTING}")
            _log("         Re-download the dataset:")
            _log("           export ROBOFLOW_API_KEY=<key>")
            _log("           python scripts/retrain_mask_headcover.py --model headcover")
            if not do_mask or mask_yaml is None:
                return 1
        else:
            if legacy_imgs > 0 and not headcover_sources:
                _log(f"  Using legacy hairnet path: {HAIRNET_EXISTING} ({legacy_imgs} images)")
                headcover_sources = [HAIRNET_EXISTING]

            if not args.skip_split:
                _log("Validating headcover images...")
                total_ok = total_bad = 0
                for src in headcover_sources:
                    ok, bad = validate_source(src)
                    _log(f"  {src.name}: {ok} ok, {bad} removed")
                    total_ok += ok
                    total_bad += bad
                _log(f"  Total: {total_ok} valid, {total_bad} removed")

                if total_ok < 200:
                    _log(f"  WARNING: Only {total_ok} valid headcover images.")
                    _log("           Add dark/navy headcover images from your kitchen camera.")
                    _log(f"           See: {DATASET_DIR}/manual_collection/COLLECTION_INSTRUCTIONS.md")

                headcover_yaml = build_split(
                    "headcover", headcover_sources,
                    class_names=["headcover", "no_headcover"],
                )
            else:
                headcover_yaml = DATASET_DIR / "ppe_headcover" / "data.yaml"
                imgs, lbls = check_existing_data("headcover")
                _log(f"  Using existing headcover split: {imgs} images, {lbls} labels")
                if imgs < 100:
                    _log("  ERROR: Existing headcover split has <100 images. Cannot train.")
                    headcover_yaml = None

    # ── TRAINING ─────────────────────────────────────────────────────────────
    train_kwargs = dict(
        epochs=args.epochs,
        patience=args.patience,
        imgsz=args.imgsz,
        batch=args.batch,
    )

    if do_mask and mask_yaml and mask_yaml.exists():
        _log("\n" + "=" * 70)
        _log("Starting MASK training...")
        mask_dest = BACKEND_MODELS / "mask_best.pt" if not args.no_deploy else Path("/dev/null")
        try:
            train_model("mask", mask_yaml, mask_dest, **train_kwargs)
        except Exception as exc:
            _log(f"  MASK TRAINING FAILED: {exc}")
            import traceback
            traceback.print_exc()

    if do_headcover and headcover_yaml and headcover_yaml.exists():
        _log("\n" + "=" * 70)
        _log("Starting HEADCOVER training...")
        headcover_dest = BACKEND_MODELS / "hairnet_best.pt" if not args.no_deploy else Path("/dev/null")
        try:
            train_model("headcover", headcover_yaml, headcover_dest, **train_kwargs)
        except Exception as exc:
            _log(f"  HEADCOVER TRAINING FAILED: {exc}")
            import traceback
            traceback.print_exc()

    _log("\nDone.")
    _log("Next steps:")
    _log("  1. Check confusion matrices in runs/mask/train/ and runs/headcover/train/")
    _log("  2. Run: python scripts/ppe_eval_models.py")
    _log("  3. Restart the FastAPI server to pick up new weights")
    _log("  4. Test live at http://localhost:5173/monitoring")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
