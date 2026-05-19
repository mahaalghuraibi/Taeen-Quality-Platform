#!/usr/bin/env python3
"""
Phase 2 — Import Kaggle Face Mask dataset into dataset/mask and dataset/no_mask.

Source layout (default: ../data relative to Desktop, or --source):
  data/with_mask/    → dataset/mask/raw/images/mask_0001.jpg
  data/without_mask/ → dataset/no_mask/raw/images/no_mask_0001.jpg

Images only; non-image files are skipped. Processes in batches for large sets.
Roboflow: upload raw folders or label in Roboflow, then export to labeled/.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = ROOT / "dataset"
DEFAULT_SOURCE = ROOT.parent / "data"  # SKA1/data when repo is ska-system/

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
BATCH_SIZE = 500

SUBFOLDERS = ("raw", "labeled", "train", "valid")


def ensure_class_dirs(class_name: str) -> Path:
    """Create raw|labeled|train|valid images+labels if missing."""
    for sub in SUBFOLDERS:
        for kind in ("images", "labels"):
            p = DATASET_ROOT / class_name / sub / kind
            p.mkdir(parents=True, exist_ok=True)
            keep = p / ".gitkeep"
            if not keep.exists():
                keep.touch()
    return DATASET_ROOT / class_name / "raw" / "images"


def iter_images(src_dir: Path):
    if not src_dir.is_dir():
        return
    for p in sorted(src_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES:
            yield p


def target_name(prefix: str, index: int, source: Path) -> str:
    ext = source.suffix.lower()
    if ext in (".jpeg",):
        ext = ".jpg"
    if ext not in IMAGE_SUFFIXES:
        ext = ".jpg"
    return f"{prefix}_{index:04d}{ext}"


def import_split(
    *,
    src_dir: Path,
    dest_dir: Path,
    prefix: str,
    batch_size: int,
    dry_run: bool,
) -> int:
    dest_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    batch: list[Path] = []

    def flush_batch(items: list[Path], start_index: int) -> int:
        n = 0
        for offset, src in enumerate(items):
            idx = start_index + offset
            name = target_name(prefix, idx, src)
            dest = dest_dir / name
            if dry_run:
                n += 1
                continue
            if dest.exists():
                n += 1
                continue
            shutil.copy2(src, dest)
            n += 1
        return n

    for src in iter_images(src_dir):
        batch.append(src)
        if len(batch) >= batch_size:
            count += flush_batch(batch, count + 1)
            print(f"  … {prefix}: {count} images", flush=True)
            batch = []

    if batch:
        count += flush_batch(batch, count + 1)

    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Kaggle mask dataset into dataset/")
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help=f"Folder containing with_mask/ and without_mask/ (default: {DEFAULT_SOURCE})",
    )
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    source = args.source.resolve()
    with_mask_src = source / "with_mask"
    without_mask_src = source / "without_mask"

    if not with_mask_src.is_dir() and not without_mask_src.is_dir():
        print(f"Source not found: {source}", file=sys.stderr)
        print("Expected: with_mask/ and without_mask/", file=sys.stderr)
        return 1

    mask_dest = ensure_class_dirs("mask")
    no_mask_dest = ensure_class_dirs("no_mask")

    print(f"Source:      {source}")
    print(f"Mask dest:   {mask_dest}")
    print(f"No-mask dest:{no_mask_dest}")
    print(f"Batch size:  {args.batch_size}")
    if args.dry_run:
        print("(dry-run — no files copied)\n")

    mask_count = 0
    no_mask_count = 0

    if with_mask_src.is_dir():
        print("Importing with_mask → dataset/mask/raw/images …")
        mask_count = import_split(
            src_dir=with_mask_src,
            dest_dir=mask_dest,
            prefix="mask",
            batch_size=args.batch_size,
            dry_run=args.dry_run,
        )
    else:
        print("  skip: with_mask/ not found", file=sys.stderr)

    if without_mask_src.is_dir():
        print("Importing without_mask → dataset/no_mask/raw/images …")
        no_mask_count = import_split(
            src_dir=without_mask_src,
            dest_dir=no_mask_dest,
            prefix="no_mask",
            batch_size=args.batch_size,
            dry_run=args.dry_run,
        )
    else:
        print("  skip: without_mask/ not found", file=sys.stderr)

    print("\n=== Import summary ===")
    print(f"  mask (with_mask):     {mask_count}")
    print(f"  no_mask (without_mask): {no_mask_count}")
    print(f"  total:                {mask_count + no_mask_count}")
    print("\nNext steps:")
    print("  1) Upload dataset/mask/raw and dataset/no_mask/raw to Roboflow (or label locally).")
    print("  2) Export YOLO labels into dataset/<class>/labeled/images + labels/")
    print("  3) python scripts/organize_dataset.py --val-ratio 0.2")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
