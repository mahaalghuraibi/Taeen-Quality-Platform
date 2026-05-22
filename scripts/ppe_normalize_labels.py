#!/usr/bin/env python3
"""
Normalize YOLO label class IDs across all PPE source datasets.

Different datasets use different class name conventions. This script
reads a mapping config and rewrites all label files so every source
uses the canonical class IDs required by the three PPE models.

Canonical class maps (must match ai_violation_service.py):
  MASK MODEL      : 0=mask       1=no_mask
  HEADCOVER MODEL : 0=headcover  1=no_headcover
  GLOVE MODEL     : 0=no_gloves  1=gloves

Each source dataset needs a CLASS_MAP entry that says:
  "source class id X" → "canonical class name"

Datasets handled:
  rf_mask_militech        : {0: mask, 1: no_mask, 2: mask_weared_incorrect→no_mask}
  rf_mask_joseph          : {0: mask, 1: no_mask}
  kaggle_mask_andrewmvd   : Pascal VOC XML → needs ppe_convert_voc.py first
  kaggle_mask_labeled     : {0: mask, 1: no_mask}  (from autolabel_faces.py)
  rf_gloves_ppe           : {0: gloves, 1: no_gloves}  [may vary by dataset]
  rf_gloves_medical       : {0: glove, 1: no_glove}
  rf_hairnet_maha         : {0: hairnet→headcover, 1: no_hairnet→no_headcover}
  rf_headcover_protection : {0: helmet→headcover, 1: hard_hat→headcover, ...}

Usage:
  python scripts/ppe_normalize_labels.py
  python scripts/ppe_normalize_labels.py --dry-run
  python scripts/ppe_normalize_labels.py --source rf_hairnet_maha
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = ROOT / "dataset" / "ppe_sources"

# ─── Class maps per source dataset ────────────────────────────────────────────
# source_class_id -> canonical_class_name
# canonical names: mask, no_mask, headcover, no_headcover, gloves, no_gloves
#
# Final class IDs after normalization:
#   mask model:      mask→0,  no_mask→1
#   headcover model: headcover→0, no_headcover→1
#   glove model:     no_gloves→0, gloves→1

CANONICAL_IDS: dict[str, int] = {
    # Mask model classes
    "mask":         0,
    "no_mask":      1,
    # Headcover model classes
    "headcover":    0,
    "no_headcover": 1,
    # Glove model classes
    "no_gloves":    0,
    "gloves":       1,
}

# Per-source remapping: source_folder → {old_class_id: canonical_name | None}
# None means DISCARD this class (drop label lines with this class ID)
SOURCE_CLASS_MAPS: dict[str, dict[int, str | None]] = {
    "rf_mask_militech": {
        0: "mask",
        1: "no_mask",
        2: "no_mask",      # mask_weared_incorrect treated as no_mask
    },
    "rf_mask_joseph": {
        0: "mask",
        1: "no_mask",
    },
    "kaggle_mask_labeled": {
        0: "mask",
        1: "no_mask",
    },
    "rf_gloves_ppe": {
        0: "gloves",
        1: "no_gloves",
    },
    "rf_gloves_medical": {
        0: "gloves",       # "glove" → canonical "gloves"
        1: "no_gloves",    # "no_glove" → canonical "no_gloves"
    },
    "rf_hairnet_maha": {
        0: "headcover",    # "hairnet" → canonical "headcover"
        1: "no_headcover", # "no_hairnet" → canonical "no_headcover"
    },
    "rf_headcover_protection": {
        0: "headcover",    # "helmet" or "hard_hat" → headcover (chef hat included)
        1: "headcover",    # sometimes multiple positive classes
        2: "no_headcover", # absence class
    },
}


def _find_label_dirs(source_root: Path) -> list[Path]:
    """Find all labels/ directories under a source folder."""
    if not source_root.is_dir():
        return []
    dirs: list[Path] = []
    for labels_dir in source_root.rglob("labels"):
        if labels_dir.is_dir():
            dirs.append(labels_dir)
    # If no labels/ found, check if .txt files are directly in the folder
    if not dirs:
        txts = list(source_root.rglob("*.txt"))
        if txts:
            dirs = list({t.parent for t in txts})
    return dirs


def _normalize_file(
    txt_path: Path,
    class_map: dict[int, str | None],
    *,
    dry_run: bool,
) -> tuple[int, int, int]:
    """
    Normalize one YOLO label file in-place.
    Returns (kept, remapped, discarded) line counts.
    """
    text = txt_path.read_text(encoding="utf-8")
    out_lines: list[str] = []
    kept = remapped = discarded = 0

    for line in text.splitlines():
        parts = line.strip().split()
        if not parts or len(parts) < 5:
            continue
        try:
            old_id = int(parts[0])
        except ValueError:
            continue

        canonical_name = class_map.get(old_id)
        if canonical_name is None:
            discarded += 1
            continue

        new_id = CANONICAL_IDS.get(canonical_name)
        if new_id is None:
            discarded += 1
            continue

        new_line = f"{new_id} {' '.join(parts[1:])}"
        if new_id == old_id:
            kept += 1
        else:
            remapped += 1
        out_lines.append(new_line)

    if not dry_run:
        txt_path.write_text("\n".join(out_lines) + ("\n" if out_lines else ""), encoding="utf-8")

    return kept, remapped, discarded


def normalize_source(source_name: str, class_map: dict[int, str | None], *, dry_run: bool) -> None:
    source_root = SOURCES_DIR / source_name
    label_dirs = _find_label_dirs(source_root)

    if not label_dirs:
        print(f"  [{source_name}] No label files found — skip")
        return

    total_kept = total_remapped = total_discarded = total_files = 0

    for labels_dir in label_dirs:
        for txt in sorted(labels_dir.glob("*.txt")):
            if txt.name == "classes.txt":
                continue
            k, r, d = _normalize_file(txt, class_map, dry_run=dry_run)
            total_kept += k
            total_remapped += r
            total_discarded += d
            total_files += 1

    print(
        f"  [{source_name}] {total_files} files — "
        f"kept={total_kept} remapped={total_remapped} discarded={total_discarded}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize YOLO label class IDs")
    parser.add_argument("--source", help="Process only this source folder (default: all)")
    parser.add_argument("--dry-run", action="store_true", help="Show counts without writing")
    args = parser.parse_args()

    if not SOURCES_DIR.is_dir():
        print(f"Sources directory not found: {SOURCES_DIR}", file=sys.stderr)
        print("Run ppe_download_datasets.py first.", file=sys.stderr)
        return 1

    if args.dry_run:
        print("(dry-run — no files will be modified)")

    sources = SOURCE_CLASS_MAPS
    if args.source:
        if args.source not in sources:
            print(f"Unknown source: {args.source}. Known: {', '.join(sources)}", file=sys.stderr)
            return 1
        sources = {args.source: sources[args.source]}

    print(f"Normalizing labels in: {SOURCES_DIR}\n")
    for source_name, class_map in sources.items():
        normalize_source(source_name, class_map, dry_run=args.dry_run)

    print("\nDone. Next: python scripts/ppe_validate_labels.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
