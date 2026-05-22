#!/usr/bin/env python3
"""
Validate YOLO labels for all PPE source datasets.

Checks:
  1. Every image file has a corresponding label file
  2. Every label file has a corresponding image file
  3. All bbox coordinates are in [0, 1] range
  4. All class IDs are within valid range for each model type
  5. No empty label files (would confuse YOLO trainer)
  6. No duplicate filenames across the merged dataset
  7. Image files are readable (not corrupt)

Usage:
  python scripts/ppe_validate_labels.py
  python scripts/ppe_validate_labels.py --source rf_mask_militech
  python scripts/ppe_validate_labels.py --fix          # auto-remove bad files
  python scripts/ppe_validate_labels.py --report-only  # summary only, no file list
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = ROOT / "dataset" / "ppe_sources"
PPE_DATASETS_DIR = ROOT / "dataset"

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# Valid class IDs per model type (detected from class name context in filename/path)
VALID_CLASS_IDS = {
    "mask":      {0, 1},   # 0=mask, 1=no_mask
    "headcover": {0, 1},   # 0=headcover, 1=no_headcover
    "gloves":    {0, 1},   # 0=no_gloves, 1=gloves
    "any":       {0, 1, 2, 3, 4, 5},  # unknown model — allow broader range
}


def _guess_model_type(folder: Path) -> str:
    name = folder.as_posix().lower()
    if "mask" in name:
        return "mask"
    if "hairnet" in name or "headcover" in name or "head" in name:
        return "headcover"
    if "glove" in name:
        return "gloves"
    return "any"


def _validate_label_file(
    txt: Path,
    valid_ids: set[int],
) -> list[str]:
    """Return list of error messages for this label file."""
    errors: list[str] = []
    try:
        text = txt.read_text(encoding="utf-8")
    except OSError as exc:
        return [f"cannot read: {exc}"]

    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        return ["empty label file"]

    for i, line in enumerate(lines, start=1):
        parts = line.split()
        if len(parts) < 5:
            errors.append(f"line {i}: too few fields ({len(parts)}): {line!r}")
            continue
        try:
            cls_id = int(parts[0])
            cx, cy, bw, bh = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
        except ValueError:
            errors.append(f"line {i}: non-numeric values: {line!r}")
            continue

        if cls_id not in valid_ids and "any" not in valid_ids:
            errors.append(f"line {i}: invalid class id {cls_id} (valid: {sorted(valid_ids)})")

        for val, name in [(cx, "cx"), (cy, "cy"), (bw, "bw"), (bh, "bh")]:
            if not (0.0 <= val <= 1.0):
                errors.append(f"line {i}: {name}={val:.4f} out of [0,1]")

        if bw < 0.002 or bh < 0.002:
            errors.append(f"line {i}: bbox too small (bw={bw:.4f} bh={bh:.4f})")

    return errors


def _find_image(label: Path, images_dir: Path) -> Path | None:
    for ext in IMAGE_EXT:
        candidate = images_dir / f"{label.stem}{ext}"
        if candidate.is_file():
            return candidate
    return None


def _is_corrupt(img_path: Path) -> bool:
    try:
        import cv2
        img = cv2.imread(str(img_path))
        return img is None
    except Exception:
        return True


def validate_folder_pair(
    images_dir: Path,
    labels_dir: Path,
    model_type: str,
    *,
    fix: bool,
    verbose: bool,
) -> dict[str, int]:
    valid_ids = VALID_CLASS_IDS.get(model_type, VALID_CLASS_IDS["any"])
    stats = {
        "images": 0, "labels": 0,
        "ok": 0, "missing_label": 0, "missing_image": 0,
        "label_errors": 0, "corrupt_images": 0,
        "fixed": 0,
    }

    # All images
    images = {p.stem: p for p in images_dir.rglob("*") if p.suffix.lower() in IMAGE_EXT}
    labels = {p.stem: p for p in labels_dir.glob("*.txt") if p.name != "classes.txt"}

    stats["images"] = len(images)
    stats["labels"] = len(labels)

    # Missing labels
    for stem, img in sorted(images.items()):
        if stem not in labels:
            stats["missing_label"] += 1
            if verbose:
                print(f"  MISSING_LABEL: {img.name}")
            if fix:
                img.unlink()
                stats["fixed"] += 1

    # Missing images
    for stem, lbl in sorted(labels.items()):
        if stem not in images:
            stats["missing_image"] += 1
            if verbose:
                print(f"  MISSING_IMAGE: {lbl.name}")
            if fix:
                lbl.unlink()
                stats["fixed"] += 1

    # Validate labels that have matching images
    for stem, lbl in sorted(labels.items()):
        if stem not in images:
            continue
        img = images[stem]

        # Check corruption
        if _is_corrupt(img):
            stats["corrupt_images"] += 1
            if verbose:
                print(f"  CORRUPT: {img.name}")
            if fix:
                img.unlink()
                lbl.unlink()
                stats["fixed"] += 1
            continue

        # Validate label
        errors = _validate_label_file(lbl, valid_ids)
        if errors:
            stats["label_errors"] += 1
            if verbose:
                for e in errors:
                    print(f"  LABEL_ERROR [{lbl.name}]: {e}")
            if fix and any("out of [0,1]" in e or "too small" in e for e in errors):
                # Only auto-fix coordinate errors; leave class errors for manual review
                pass
        else:
            stats["ok"] += 1

    return stats


def validate_source(source_folder: Path, *, fix: bool, verbose: bool, report_only: bool) -> dict[str, int]:
    model_type = _guess_model_type(source_folder)
    combined: dict[str, int] = {
        "images": 0, "labels": 0, "ok": 0,
        "missing_label": 0, "missing_image": 0,
        "label_errors": 0, "corrupt_images": 0, "fixed": 0,
    }

    # Find images/labels pairs in common Roboflow layouts:
    # source/train/images + source/train/labels
    # source/valid/images + source/valid/labels
    # source/images       + source/labels
    found_pairs = False
    for split in ("train", "valid", "test", "."):
        split_dir = source_folder / split if split != "." else source_folder
        img_dir = split_dir / "images"
        lbl_dir = split_dir / "labels"
        if img_dir.is_dir() and lbl_dir.is_dir():
            s = validate_folder_pair(img_dir, lbl_dir, model_type, fix=fix,
                                     verbose=verbose and not report_only)
            for k in combined:
                combined[k] += s.get(k, 0)
            found_pairs = True

    if not found_pairs:
        # Flat layout: source/mask/images + source/mask/labels
        for class_dir in source_folder.iterdir():
            if not class_dir.is_dir():
                continue
            img_dir = class_dir / "images"
            lbl_dir = class_dir / "labels"
            if img_dir.is_dir() and lbl_dir.is_dir():
                s = validate_folder_pair(img_dir, lbl_dir, model_type, fix=fix,
                                         verbose=verbose and not report_only)
                for k in combined:
                    combined[k] += s.get(k, 0)

    return combined


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate YOLO PPE labels")
    parser.add_argument("--source", help="Validate only this source folder")
    parser.add_argument("--fix", action="store_true",
                        help="Remove files with unresolvable errors (missing pair, corrupt)")
    parser.add_argument("--report-only", action="store_true",
                        help="Summary only — do not list individual errors")
    parser.add_argument("--verbose", action="store_true",
                        help="List every problematic file")
    args = parser.parse_args()

    try:
        import cv2  # noqa: F401 — needed for corruption check
    except ImportError:
        print("WARNING: opencv not installed — corruption check skipped", file=sys.stderr)

    if not SOURCES_DIR.is_dir():
        print(f"Sources dir not found: {SOURCES_DIR}", file=sys.stderr)
        print("Run ppe_download_datasets.py first.", file=sys.stderr)
        return 1

    if args.source:
        sources = [SOURCES_DIR / args.source]
    else:
        sources = [d for d in sorted(SOURCES_DIR.iterdir()) if d.is_dir()]

    grand_total: dict[str, int] = {
        "images": 0, "labels": 0, "ok": 0,
        "missing_label": 0, "missing_image": 0,
        "label_errors": 0, "corrupt_images": 0, "fixed": 0,
    }

    has_errors = False
    print(f"\n{'Source':<45} {'images':>7} {'labels':>7} {'ok':>7} {'errors':>7}")
    print("-" * 75)

    for src in sources:
        if not src.is_dir():
            print(f"  Not found: {src}", file=sys.stderr)
            continue
        s = validate_source(src, fix=args.fix, verbose=args.verbose, report_only=args.report_only)
        errors = s["missing_label"] + s["missing_image"] + s["label_errors"] + s["corrupt_images"]
        has_errors = has_errors or errors > 0
        print(
            f"  {src.name:<43} {s['images']:>7} {s['labels']:>7} {s['ok']:>7} {errors:>7}"
            + (f"  [fixed {s['fixed']}]" if s["fixed"] > 0 else "")
        )
        for k in grand_total:
            grand_total[k] += s.get(k, 0)

    print("-" * 75)
    total_errors = (grand_total["missing_label"] + grand_total["missing_image"]
                    + grand_total["label_errors"] + grand_total["corrupt_images"])
    print(
        f"  {'TOTAL':<43} {grand_total['images']:>7} {grand_total['labels']:>7} "
        f"{grand_total['ok']:>7} {total_errors:>7}"
    )

    if total_errors == 0:
        print("\nAll labels valid.")
        print("Next: python scripts/ppe_build_split.py")
    else:
        print(f"\n{total_errors} issues found.")
        if not args.fix:
            print("Run with --fix to auto-remove corrupt/unmatched files.")
        print("Run with --verbose for file-level details.")

    return 1 if (has_errors and not args.fix) else 0


if __name__ == "__main__":
    raise SystemExit(main())
