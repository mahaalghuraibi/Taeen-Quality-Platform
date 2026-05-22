#!/usr/bin/env python3
"""
Download public PPE datasets for mask, gloves, and headcover detection.

Sources used (all CC BY 4.0 or more permissive):

MASK:
  [RF1] Roboflow "Face Mask Detection" — 853 images, pre-labeled YOLO
        workspace=militech  project=face-mask-detection-s6u8e
  [RF2] Roboflow "mask-wearing" — 800 images
        workspace=joseph-nelson  project=mask-wearing
  [KAG] Kaggle "Face Mask Detection" (Prajna Bhandary) — 7553 images,
        classification format (needs autolabel_faces.py to add bboxes)

GLOVES:
  [RF3] Roboflow "Gloves PPE Detection" — 720 images
        workspace=roboflow-universe-projects  project=gloves-ppe
  [RF4] Roboflow "Medical Gloves" — 600 images
        workspace=comp-vision  project=medical-gloves

HEADCOVER:
  [RF5] Roboflow "Hairnet Detection" (maha-alghuraibi) — 600 images
        workspace=maha-alghuraibi  project=hairnet-fb3td
  [RF6] Roboflow "Head Protection PPE" — includes chef hats, hard hats
        workspace=roboflow-universe-projects  project=head-protection

NOTE: Roboflow downloads require a free API key (roboflow.com → account → API key).
      Set ROBOFLOW_API_KEY env var before running.
      Kaggle downloads require: pip install kaggle  + ~/.kaggle/kaggle.json

Usage:
  export ROBOFLOW_API_KEY=rf_xxxxx
  python scripts/ppe_download_datasets.py --target mask
  python scripts/ppe_download_datasets.py --target gloves
  python scripts/ppe_download_datasets.py --target headcover
  python scripts/ppe_download_datasets.py --target all

  # Download Kaggle mask dataset (classification, needs autolabel step after)
  python scripts/ppe_download_datasets.py --target mask --include-kaggle
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = ROOT / "dataset" / "ppe_sources"

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# ─── Roboflow dataset catalogue ───────────────────────────────────────────────
# Each entry: (workspace, project, version, target_folder, description)
RF_DATASETS: dict[str, list[tuple[str, str, int, str, str]]] = {
    "mask": [
        ("militech", "face-mask-detection-s6u8e", 1, "rf_mask_militech",
         "Face Mask Detection ~853 images CC BY 4.0"),
        ("joseph-nelson", "mask-wearing", 1, "rf_mask_joseph",
         "Mask Wearing ~800 images CC BY 4.0"),
    ],
    "gloves": [
        ("roboflow-universe-projects", "gloves-ppe", 1, "rf_gloves_ppe",
         "Gloves PPE Detection ~720 images CC BY 4.0"),
        ("comp-vision", "medical-gloves", 1, "rf_gloves_medical",
         "Medical Gloves ~600 images CC BY 4.0"),
    ],
    "headcover": [
        ("maha-alghuraibi", "hairnet-fb3td", 1, "rf_hairnet_maha",
         "Hairnet Detection ~600 images CC BY 4.0"),
        ("roboflow-universe-projects", "head-protection", 1, "rf_headcover_protection",
         "Head Protection (chef hats, hard hats) ~500 images CC BY 4.0"),
    ],
}

# ─── Kaggle datasets (classification only, no bboxes → use autolabel_faces.py)
KAGGLE_DATASETS: dict[str, tuple[str, str]] = {
    "mask": (
        "andrewmvd/face-mask-detection",
        "kaggle_mask_andrewmvd",
    ),
}


def _rf_download(workspace: str, project: str, version: int, dest_folder: str) -> Path:
    """Download one Roboflow dataset in YOLOv8 format."""
    api_key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if not api_key:
        print(
            "  ERROR: ROBOFLOW_API_KEY not set. Get a free key at roboflow.com → account.",
            file=sys.stderr,
        )
        return Path()

    try:
        from roboflow import Roboflow
    except ImportError:
        print("  ERROR: pip install roboflow", file=sys.stderr)
        return Path()

    dest = SOURCES_DIR / dest_folder
    dest.mkdir(parents=True, exist_ok=True)

    try:
        rf = Roboflow(api_key=api_key)
        dataset = rf.workspace(workspace).project(project).version(version).download(
            "yolov8", location=str(dest), overwrite=False,
        )
        return Path(getattr(dataset, "location", dest))
    except Exception as exc:
        print(f"  ERROR downloading {workspace}/{project}: {exc}", file=sys.stderr)
        return Path()


def _kaggle_download(dataset_slug: str, dest_folder: str) -> Path:
    """Download a Kaggle dataset (requires kaggle CLI + kaggle.json)."""
    dest = SOURCES_DIR / dest_folder
    dest.mkdir(parents=True, exist_ok=True)

    try:
        subprocess.run(
            ["kaggle", "datasets", "download", "-d", dataset_slug,
             "--unzip", "-p", str(dest)],
            check=True,
        )
        return dest
    except FileNotFoundError:
        print("  ERROR: kaggle CLI not found. pip install kaggle", file=sys.stderr)
    except subprocess.CalledProcessError as exc:
        print(f"  ERROR: kaggle download failed: {exc}", file=sys.stderr)
    return Path()


def _count_images(folder: Path) -> int:
    if not folder.is_dir():
        return 0
    return sum(1 for p in folder.rglob("*") if p.suffix.lower() in IMAGE_EXT)


def download_target(target: str, include_kaggle: bool) -> None:
    entries = RF_DATASETS.get(target, [])
    if not entries:
        print(f"Unknown target: {target}", file=sys.stderr)
        return

    print(f"\n{'='*60}")
    print(f"DOWNLOADING: {target.upper()}")
    print(f"{'='*60}")

    for workspace, project, version, folder, desc in entries:
        print(f"\n  [{folder}] {desc}")
        existing = _count_images(SOURCES_DIR / folder)
        if existing > 0:
            print(f"  Already downloaded: {existing} images — skipping.")
            continue
        loc = _rf_download(workspace, project, version, folder)
        if loc and loc.is_dir():
            n = _count_images(loc)
            print(f"  Downloaded: {n} images → {loc}")
        else:
            print(f"  Skipped / failed: {folder}")

    if include_kaggle and target in KAGGLE_DATASETS:
        slug, folder = KAGGLE_DATASETS[target]
        print(f"\n  [kaggle/{folder}] Kaggle dataset: {slug}")
        existing = _count_images(SOURCES_DIR / folder)
        if existing > 0:
            print(f"  Already downloaded: {existing} images — skipping.")
        else:
            loc = _kaggle_download(slug, folder)
            if loc and loc.is_dir():
                n = _count_images(loc)
                print(f"  Downloaded: {n} images → {loc}")
            else:
                print(f"  Failed — see errors above.")

        print()
        print("  NOTE: Kaggle mask dataset has NO bounding boxes (classification format).")
        print("  Run:  python scripts/ppe_autolabel_faces.py  to auto-generate face boxes.")


def print_status() -> None:
    print("\n=== Downloaded source summary ===")
    for target, entries in RF_DATASETS.items():
        for _, _, _, folder, _ in entries:
            n = _count_images(SOURCES_DIR / folder)
            status = f"{n} images" if n > 0 else "MISSING"
            print(f"  {folder:<40} {status}")
    for target, (_, folder) in KAGGLE_DATASETS.items():
        n = _count_images(SOURCES_DIR / folder)
        status = f"{n} images (classification, needs autolabel)" if n > 0 else "MISSING"
        print(f"  {folder:<40} {status}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Download public PPE datasets")
    parser.add_argument(
        "--target", choices=["mask", "gloves", "headcover", "all"], default="all",
        help="Which PPE type to download",
    )
    parser.add_argument(
        "--include-kaggle", action="store_true",
        help="Also download Kaggle datasets (requires kaggle CLI)",
    )
    parser.add_argument("--status", action="store_true", help="Show download status and exit")
    args = parser.parse_args()

    SOURCES_DIR.mkdir(parents=True, exist_ok=True)

    if args.status:
        print_status()
        return 0

    targets = list(RF_DATASETS.keys()) if args.target == "all" else [args.target]
    for t in targets:
        download_target(t, args.include_kaggle)

    print()
    print_status()
    print()
    print("Next steps:")
    print("  1) python scripts/ppe_autolabel_faces.py     # if Kaggle mask downloaded")
    print("  2) python scripts/ppe_normalize_labels.py    # remap class names")
    print("  3) python scripts/ppe_validate_labels.py     # check label integrity")
    print("  4) python scripts/ppe_build_split.py         # merge + train/val/test split")
    print("  5) python scripts/ppe_train_all.py           # train all 3 models")
    print("  6) python scripts/ppe_eval_models.py         # evaluate and report")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
