#!/usr/bin/env python3
"""
Download or import images into dataset/<class>/raw/images.

Supports:
  - Roboflow dataset export (YOLOv8) via roboflow Python SDK
  - Plain URL list file (one URL per line)
  - Local directory copy

Examples:
  export ROBOFLOW_API_KEY=rf_xxx
  python scripts/download_images.py --roboflow-project kitchen-ppe --roboflow-version 3 --class mask

  python scripts/download_images.py --urls-file urls/mask_sources.txt --class mask

  python scripts/download_images.py --from-dir ~/Downloads/mask_batch --class mask
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Project root = parent of scripts/
ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = ROOT / "dataset"

CLASSES = (
    "helmet",
    "mask",
    "gloves",
    "hairnet",
    "trash",
    "dirty_surface",
    "improper_uniform",
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _safe_name(name: str) -> str:
    return re.sub(r"[^\w.\-]+", "_", name)[:180]


def _dest_raw(class_name: str) -> Path:
    dest = DATASET_ROOT / class_name / "raw" / "images"
    dest.mkdir(parents=True, exist_ok=True)
    return dest


def download_urls(urls: list[str], dest: Path, *, prefix: str = "img") -> int:
    count = 0
    for i, url in enumerate(urls, start=1):
        url = url.strip()
        if not url or url.startswith("#"):
            continue
        ext = Path(url.split("?", 1)[0]).suffix.lower()
        if ext not in IMAGE_SUFFIXES:
            ext = ".jpg"
        out = dest / f"{prefix}_{i:05d}{ext}"
        if out.exists():
            count += 1
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "taeen-dataset-downloader/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            if len(data) < 1024:
                print(f"  skip (too small): {url}", file=sys.stderr)
                continue
            out.write_bytes(data)
            count += 1
            print(f"  saved {out.name}")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            print(f"  failed: {url} — {exc}", file=sys.stderr)
    return count


def copy_from_dir(src: Path, dest: Path) -> int:
    count = 0
    for p in sorted(src.rglob("*")):
        if p.suffix.lower() not in IMAGE_SUFFIXES or not p.is_file():
            continue
        target = dest / _safe_name(p.name)
        if target.exists():
            continue
        shutil.copy2(p, target)
        count += 1
    return count


def download_roboflow(*, project: str, version: int, class_name: str, fmt: str) -> int:
    api_key = (os.getenv("ROBOFLOW_API_KEY") or "").strip()
    if not api_key:
        print("Set ROBOFLOW_API_KEY to download from Roboflow.", file=sys.stderr)
        return 0
    try:
        from roboflow import Roboflow
    except ImportError:
        print("Install: pip install roboflow", file=sys.stderr)
        return 0

    workspace = (os.getenv("ROBOFLOW_WORKSPACE") or "").strip()
    rf = Roboflow(api_key=api_key)
    if workspace:
        proj = rf.workspace(workspace).project(project)
    else:
        proj = rf.project(project)

    dest = _dest_raw(class_name)
    tmp = DATASET_ROOT / "_roboflow_cache" / f"{project}_v{version}"
    tmp.mkdir(parents=True, exist_ok=True)

    print(f"Roboflow download: project={project} version={version} format={fmt}")
    dataset = proj.version(version).download(fmt, location=str(tmp))

    # Roboflow YOLOv8 zip extracts train/valid with images+labels — copy images to raw
    count = 0
    base = Path(dataset.location) if hasattr(dataset, "location") else tmp
    for sub in ("train", "valid", "test"):
        img_dir = base / sub / "images"
        if img_dir.is_dir():
            count += copy_from_dir(img_dir, dest)
    if count == 0 and base.is_dir():
        count += copy_from_dir(base, dest)
    print(f"  → {count} images in {dest}")
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Download images into dataset/<class>/raw/images")
    parser.add_argument("--class", dest="class_name", required=True, choices=CLASSES, help="Target class folder")
    parser.add_argument("--urls-file", type=Path, help="Text file with one image URL per line")
    parser.add_argument("--from-dir", type=Path, help="Copy images from a local folder")
    parser.add_argument("--roboflow-project", help="Roboflow project slug")
    parser.add_argument("--roboflow-version", type=int, default=1, help="Roboflow dataset version")
    parser.add_argument(
        "--roboflow-format",
        default="yolov8",
        choices=("yolov8", "yolov5pytorch", "coco"),
        help="Roboflow export format",
    )
    args = parser.parse_args()

    if not DATASET_ROOT.is_dir():
        print(f"Dataset root not found: {DATASET_ROOT}", file=sys.stderr)
        return 1

    dest = _dest_raw(args.class_name)
    total = 0

    if args.roboflow_project:
        total += download_roboflow(
            project=args.roboflow_project,
            version=args.roboflow_version,
            class_name=args.class_name,
            fmt=args.roboflow_format,
        )
    if args.urls_file:
        if not args.urls_file.is_file():
            print(f"URLs file not found: {args.urls_file}", file=sys.stderr)
            return 1
        urls = args.urls_file.read_text(encoding="utf-8").splitlines()
        total += download_urls(urls, dest, prefix=args.class_name)
    if args.from_dir:
        if not args.from_dir.is_dir():
            print(f"Source dir not found: {args.from_dir}", file=sys.stderr)
            return 1
        total += copy_from_dir(args.from_dir.resolve(), dest)

    if not args.roboflow_project and not args.urls_file and not args.from_dir:
        parser.print_help()
        print("\nProvide one of: --roboflow-project, --urls-file, --from-dir", file=sys.stderr)
        return 1

    print(f"\nDone. {total} image(s) available under {dest}")
    print("Next: label → dataset/<class>/labeled/, then run scripts/organize_dataset.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
