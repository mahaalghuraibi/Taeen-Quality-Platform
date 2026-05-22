#!/usr/bin/env python3
"""
Download mask and headcover datasets from Roboflow.

This script only downloads data — it does NOT train.
Run this first, then run retrain_mask_headcover.py.

Usage
-----
  export ROBOFLOW_API_KEY="your_key_here"
  python scripts/download_ppe_data.py

  # Download only one model's data:
  python scripts/download_ppe_data.py --model mask
  python scripts/download_ppe_data.py --model headcover

Required env var
----------------
  ROBOFLOW_API_KEY — from https://roboflow.com → Settings → API Keys

What gets downloaded
--------------------
  Mask:
    - militech/face-mask-detection-ctmwm v3      (~853 images, CC BY 4.0)
    - joseph-nelson/mask-wearing-or-not v4        (~800 images, CC BY 4.0)
  Headcover:
    - maha-alghuraibi/hairnet-fb3td v1           (~3643 images, CC BY 4.0)
      NOTE: Labels already exist at
      /Users/ladymha_/Desktop/glove-detection/datasets/hairnet/
      but 0 images are on disk — this re-downloads images only.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = ROOT / "dataset" / "ppe_sources"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _count_images(folder: Path) -> int:
    if not folder.is_dir():
        return 0
    return sum(1 for p in folder.rglob("*") if p.suffix.lower() in IMAGE_EXT)


def _log(msg: str) -> None:
    print(msg, flush=True)


def _check_key() -> str:
    key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if not key:
        print("""
ERROR: ROBOFLOW_API_KEY is not set.

Steps:
  1. Go to https://roboflow.com and create a free account
  2. Settings → API Keys → copy the key
  3. Run:
       export ROBOFLOW_API_KEY="paste_your_key_here"
       python scripts/download_ppe_data.py
""")
        sys.exit(1)
    return key


def _install_roboflow() -> None:
    try:
        import roboflow  # noqa: F401
    except ImportError:
        import subprocess
        _log("Installing roboflow package...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "roboflow", "-q"])


def download_dataset(
    rf,
    workspace: str,
    project_id: str,
    version: int,
    dest: Path,
    label: str,
) -> bool:
    if _count_images(dest) > 0:
        _log(f"  SKIP  {label} — already downloaded ({_count_images(dest)} images)")
        return True

    dest.mkdir(parents=True, exist_ok=True)
    _log(f"  Downloading {label} ({workspace}/{project_id} v{version})...")
    try:
        project = rf.workspace(workspace).project(project_id)
        project.version(version).download("yolov8", location=str(dest))
        n = _count_images(dest)
        _log(f"  OK    {label} → {dest.name}/ ({n} images)")
        return True
    except Exception as exc:
        _log(f"  FAIL  {label}: {exc}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Download PPE datasets from Roboflow")
    parser.add_argument(
        "--model", choices=["mask", "headcover", "both"], default="both",
    )
    args = parser.parse_args()

    key = _check_key()
    _install_roboflow()

    from roboflow import Roboflow
    rf = Roboflow(api_key=key)

    SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    success = True

    if args.model in ("mask", "both"):
        _log("\n── MASK DATASETS ──────────────────────────────────────────")
        ok1 = download_dataset(
            rf, "militech", "face-mask-detection-ctmwm", 3,
            SOURCES_DIR / "rf_mask_militech",
            "militech mask dataset (~853 images)",
        )
        ok2 = download_dataset(
            rf, "joseph-nelson", "mask-wearing-or-not", 4,
            SOURCES_DIR / "rf_mask_joseph_nelson",
            "joseph-nelson mask dataset (~800 images)",
        )
        if not ok1 and not ok2:
            _log("\n  ERROR: Both mask downloads failed.")
            _log("  Without mask data the model cannot be retrained.")
            success = False
        else:
            total = _count_images(SOURCES_DIR / "rf_mask_militech") + \
                    _count_images(SOURCES_DIR / "rf_mask_joseph_nelson")
            _log(f"\n  Mask total on disk: {total} images")
            if total < 500:
                _log("  WARNING: <500 images is marginal. Consider downloading more sources.")

    if args.model in ("headcover", "both"):
        _log("\n── HEADCOVER DATASETS ─────────────────────────────────────")
        ok = download_dataset(
            rf, "maha-alghuraibi", "hairnet-fb3td", 1,
            SOURCES_DIR / "rf_headcover_hairnet_fb3td",
            "maha-alghuraibi hairnet dataset (~3643 images)",
        )
        if not ok:
            _log("\n  ERROR: Headcover download failed.")
            _log("  The labels-only dataset at:")
            _log("    /Users/ladymha_/Desktop/glove-detection/datasets/hairnet/")
            _log("  has 0 images. Cannot train without images.")
            success = False
        else:
            n = _count_images(SOURCES_DIR / "rf_headcover_hairnet_fb3td")
            _log(f"\n  Headcover total on disk: {n} images")
            _log("  NOTE: This dataset is mostly white/light hairnets.")
            _log("  Dark/navy headcovers (most common in your kitchen) are NOT in this dataset.")
            _log("  You must collect those manually — see:")
            _log(f"    {ROOT}/dataset/manual_collection/COLLECTION_INSTRUCTIONS.md")

    _log("\n── SUMMARY ────────────────────────────────────────────────")
    if success:
        _log("All downloads succeeded.")
        _log("\nNext step: retrain the models:")
        _log("  python scripts/retrain_mask_headcover.py --skip-download")
    else:
        _log("Some downloads failed — check errors above.")
        _log("Fix the failures, then run:")
        _log("  python scripts/retrain_mask_headcover.py --skip-download")

    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
