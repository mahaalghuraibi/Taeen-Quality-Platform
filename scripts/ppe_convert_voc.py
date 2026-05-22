#!/usr/bin/env python3
"""
Convert Pascal VOC XML annotations to YOLO format.

Used for the Kaggle "Face Mask Detection" dataset (andrewmvd/face-mask-detection)
which ships with Pascal VOC XML annotations:
  annotations/<image_name>.xml → labels/<image_name>.txt

The andrewmvd dataset has 3 classes:
  with_mask         → mask      (canonical class 0)
  without_mask      → no_mask   (canonical class 1)
  mask_weared_incorrect → no_mask (canonical class 1)

Usage:
  # After downloading the Kaggle dataset to dataset/ppe_sources/kaggle_mask_andrewmvd/
  python scripts/ppe_convert_voc.py \
      --source dataset/ppe_sources/kaggle_mask_andrewmvd \
      --dest   dataset/ppe_sources/kaggle_mask_andrewmvd_yolo

  # Then run ppe_normalize_labels.py to pick it up.
"""
from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = ROOT / "dataset" / "ppe_sources"

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# VOC class name → canonical class name
VOC_CLASS_MAP: dict[str, str | None] = {
    "with_mask":              "mask",
    "without_mask":           "no_mask",
    "mask_weared_incorrect":  "no_mask",
    # hairnet / headcover variants found in some datasets
    "hairnet":    "headcover",
    "no_hairnet": "no_headcover",
    "hat":        "headcover",
    "helmet":     "headcover",
    # glove variants
    "gloves":    "gloves",
    "glove":     "gloves",
    "no_gloves": "no_gloves",
    "no_glove":  "no_gloves",
}

CANONICAL_IDS: dict[str, int] = {
    "mask": 0, "no_mask": 1,
    "headcover": 0, "no_headcover": 1,
    "no_gloves": 0, "gloves": 1,
}


def _parse_xml(xml_path: Path) -> tuple[int, int, list[tuple[int, float, float, float, float]]]:
    """Parse one VOC XML. Returns (img_w, img_h, list of (class_id, cx, cy, w, h))."""
    tree = ET.parse(str(xml_path))
    root = tree.getroot()

    size = root.find("size")
    img_w = int(size.find("width").text) if size is not None else 0
    img_h = int(size.find("height").text) if size is not None else 0

    objects: list[tuple[int, float, float, float, float]] = []
    for obj in root.findall("object"):
        name_el = obj.find("name")
        if name_el is None:
            continue
        voc_name = name_el.text.strip().lower().replace(" ", "_")
        canonical = VOC_CLASS_MAP.get(voc_name)
        if canonical is None:
            continue
        class_id = CANONICAL_IDS.get(canonical)
        if class_id is None:
            continue

        bnd = obj.find("bndbox")
        if bnd is None:
            continue
        try:
            x1 = float(bnd.find("xmin").text)
            y1 = float(bnd.find("ymin").text)
            x2 = float(bnd.find("xmax").text)
            y2 = float(bnd.find("ymax").text)
        except (TypeError, ValueError):
            continue

        if img_w == 0 or img_h == 0:
            continue

        cx = ((x1 + x2) / 2) / img_w
        cy = ((y1 + y2) / 2) / img_h
        bw = (x2 - x1) / img_w
        bh = (y2 - y1) / img_h

        # Clamp to [0, 1]
        cx = max(0.0, min(1.0, cx))
        cy = max(0.0, min(1.0, cy))
        bw = max(0.001, min(1.0, bw))
        bh = max(0.001, min(1.0, bh))

        if bw < 0.005 or bh < 0.005:
            continue

        objects.append((class_id, cx, cy, bw, bh))

    return img_w, img_h, objects


def convert(source: Path, dest: Path, *, dry_run: bool) -> tuple[int, int, int]:
    """Convert all XMLs under source → YOLO txt under dest. Returns (total, converted, skipped)."""
    total = converted = skipped = 0

    # Look for annotations in common locations
    xml_dirs = []
    for candidate in [source / "annotations", source / "Annotations", source]:
        if candidate.is_dir():
            xml_dirs.append(candidate)

    for xml_dir in xml_dirs:
        for xml_path in sorted(xml_dir.glob("*.xml")):
            total += 1
            try:
                img_w, img_h, objects = _parse_xml(xml_path)
            except Exception as exc:
                print(f"  WARN: {xml_path.name}: {exc}", file=sys.stderr)
                skipped += 1
                continue

            if not objects:
                skipped += 1
                continue

            # Find matching image
            img_path = None
            for ext in IMAGE_EXT:
                candidate = source / "images" / f"{xml_path.stem}{ext}"
                if not candidate.is_file():
                    # also check parent
                    candidate = xml_path.parent.parent / "images" / f"{xml_path.stem}{ext}"
                if candidate.is_file():
                    img_path = candidate
                    break

            if img_path is None:
                # Try same folder
                for ext in IMAGE_EXT:
                    candidate = xml_dir / f"{xml_path.stem}{ext}"
                    if candidate.is_file():
                        img_path = candidate
                        break

            if img_path is None:
                skipped += 1
                continue

            if not dry_run:
                out_img = dest / "images" / img_path.name
                out_lbl = dest / "labels" / f"{xml_path.stem}.txt"
                out_img.parent.mkdir(parents=True, exist_ok=True)
                out_lbl.parent.mkdir(parents=True, exist_ok=True)
                import shutil
                shutil.copy2(img_path, out_img)
                lines = [f"{cid} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}"
                         for cid, cx, cy, bw, bh in objects]
                out_lbl.write_text("\n".join(lines) + "\n", encoding="utf-8")

            converted += 1

    return total, converted, skipped


def main() -> int:
    default_source = SOURCES_DIR / "kaggle_mask_andrewmvd"
    default_dest = SOURCES_DIR / "kaggle_mask_andrewmvd_yolo"

    parser = argparse.ArgumentParser(description="Convert Pascal VOC XML to YOLO format")
    parser.add_argument("--source", type=Path, default=default_source)
    parser.add_argument("--dest", type=Path, default=default_dest)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.source.is_dir():
        print(f"Source not found: {args.source}", file=sys.stderr)
        print("Download with: python scripts/ppe_download_datasets.py --target mask --include-kaggle", file=sys.stderr)
        return 1

    if args.dry_run:
        print("(dry-run)")

    print(f"Converting: {args.source} → {args.dest}")
    total, converted, skipped = convert(args.source, args.dest, dry_run=args.dry_run)

    print(f"Total XMLs: {total}  Converted: {converted}  Skipped: {skipped}")
    if not args.dry_run and converted > 0:
        print(f"Output: {args.dest}")
        print("\nNext: add 'kaggle_mask_andrewmvd_yolo' to ppe_normalize_labels.py SOURCE_CLASS_MAPS")
        print("Then: python scripts/ppe_build_split.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
