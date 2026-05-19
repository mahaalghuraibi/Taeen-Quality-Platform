#!/usr/bin/env python3
"""
Organize per-class dataset folders and build a unified YOLOv8 export.

Reads from (in order of preference per class):
  1) dataset/<class>/labeled/images + labeled/labels
  2) dataset/<class>/raw/images        (images only — skipped if no labels)

Writes:
  - dataset/<class>/train|valid/images|labels  (per-class split)
  - dataset/yolo_export/images|labels/train|val  (merged, remapped class ids)

Usage:
  python scripts/organize_dataset.py --val-ratio 0.2 --seed 42
  python scripts/organize_dataset.py --dry-run
"""
from __future__ import annotations

import argparse
import random
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = ROOT / "dataset"
YAML_PATH = DATASET_ROOT / "dataset.yaml"

CLASSES = (
    # Presence / safe-state classes (indices 0–6)
    "helmet",
    "mask",
    "gloves",
    "hairnet",
    "trash",
    "dirty_surface",
    "improper_uniform",
    # Explicit violation / absence classes (indices 7–10)
    "no_mask",
    "no_gloves",
    "no_hairnet",
    "wet_floor",
)

CLASS_TO_ID = {name: idx for idx, name in enumerate(CLASSES)}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _list_images(images_dir: Path) -> list[Path]:
    if not images_dir.is_dir():
        return []
    return sorted(p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES)


def _collect_pairs(class_name: str) -> list[tuple[Path, Path | None]]:
    """Return (image_path, label_path or None) for a class."""
    labeled_img = DATASET_ROOT / class_name / "labeled" / "images"
    labeled_lbl = DATASET_ROOT / class_name / "labeled" / "labels"
    pairs: list[tuple[Path, Path | None]] = []

    for img in _list_images(labeled_img):
        lbl = labeled_lbl / f"{img.stem}.txt"
        pairs.append((img, lbl if lbl.is_file() else None))

    # Raw images without labels are ignored (training requires labels)
    return pairs


def _remap_label_lines(text: str, global_class_id: int) -> str:
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        # Per-class folders use local id 0; overwrite with global id
        out.append(
            f"{global_class_id} {parts[1]} {parts[2]} {parts[3]} {parts[4]}"
            + (" " + " ".join(parts[5:]) if len(parts) > 5 else "")
        )
    return "\n".join(out) + ("\n" if out else "")


def _write_pair(
    img: Path,
    lbl: Path | None,
    *,
    global_class_id: int,
    dest_img: Path,
    dest_lbl: Path,
    dry_run: bool,
) -> bool:
    if lbl is None or not lbl.is_file():
        return False
    if dry_run:
        return True
    dest_img.parent.mkdir(parents=True, exist_ok=True)
    dest_lbl.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(img, dest_img)
    raw = lbl.read_text(encoding="utf-8")
    dest_lbl.write_text(_remap_label_lines(raw, global_class_id), encoding="utf-8")
    return True


def _clear_dir(path: Path, dry_run: bool) -> None:
    if dry_run or not path.exists():
        return
    for child in path.iterdir():
        if child.name == ".gitkeep":
            continue
        if child.is_file():
            child.unlink()
        elif child.is_dir():
            shutil.rmtree(child)


def organize(*, val_ratio: float, seed: int, dry_run: bool) -> dict[str, int]:
    rng = random.Random(seed)
    stats = {"pairs": 0, "train": 0, "val": 0, "skipped_no_label": 0}

    export_img_train = DATASET_ROOT / "yolo_export" / "images" / "train"
    export_lbl_train = DATASET_ROOT / "yolo_export" / "labels" / "train"
    export_img_val = DATASET_ROOT / "yolo_export" / "images" / "val"
    export_lbl_val = DATASET_ROOT / "yolo_export" / "labels" / "val"

    if not dry_run:
        for p in (export_img_train, export_lbl_train, export_img_val, export_lbl_val):
            _clear_dir(p, dry_run=False)
            p.mkdir(parents=True, exist_ok=True)

    for class_name in CLASSES:
        pairs = _collect_pairs(class_name)
        if not pairs:
            print(f"  [{class_name}] no labeled pairs — skip")
            continue

        labeled_only = [(img, lbl) for img, lbl in pairs if lbl is not None]
        stats["skipped_no_label"] += len(pairs) - len(labeled_only)
        if not labeled_only:
            print(f"  [{class_name}] no labels found — skip")
            continue

        if not dry_run:
            for split in ("train", "valid"):
                for sub in ("images", "labels"):
                    _clear_dir(DATASET_ROOT / class_name / split / sub, dry_run=False)

        order = list(range(len(labeled_only)))
        rng.shuffle(order)
        n_val = max(1, int(round(len(labeled_only) * val_ratio))) if len(labeled_only) > 1 else 0
        val_indices = set(order[:n_val])
        global_id = CLASS_TO_ID[class_name]

        for i, (img, lbl) in enumerate(labeled_only):
            is_val = i in val_indices
            split = "valid" if is_val else "train"

            stem = f"{class_name}_{img.stem}"
            per_img = DATASET_ROOT / class_name / split / "images" / f"{stem}{img.suffix.lower()}"
            per_lbl = DATASET_ROOT / class_name / split / "labels" / f"{stem}.txt"
            exp_img = (export_img_val if is_val else export_img_train) / f"{stem}{img.suffix.lower()}"
            exp_lbl = (export_lbl_val if is_val else export_lbl_train) / f"{stem}.txt"

            ok = _write_pair(
                img,
                lbl,
                global_class_id=global_id,
                dest_img=per_img,
                dest_lbl=per_lbl,
                dry_run=dry_run,
            )
            if not ok:
                stats["skipped_no_label"] += 1
                continue

            _write_pair(
                img,
                lbl,
                global_class_id=global_id,
                dest_img=exp_img,
                dest_lbl=exp_lbl,
                dry_run=dry_run,
            )
            stats["pairs"] += 1
            if is_val:
                stats["val"] += 1
            else:
                stats["train"] += 1

        print(f"  [{class_name}] {len(labeled_only)} pairs → train/valid + yolo_export (id={global_id})")

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Split and merge dataset into YOLOv8 layout")
    parser.add_argument("--val-ratio", type=float, default=0.2, help="Fraction for validation (0–0.5)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducible splits")
    parser.add_argument("--dry-run", action="store_true", help="Count only; do not copy files")
    args = parser.parse_args()

    if not 0.05 <= args.val_ratio <= 0.5:
        print("--val-ratio should be between 0.05 and 0.5", file=sys.stderr)
        return 1

    if not DATASET_ROOT.is_dir():
        print(f"Dataset root not found: {DATASET_ROOT}", file=sys.stderr)
        return 1

    print(f"Dataset root: {DATASET_ROOT}")
    print(f"YOLO config:  {YAML_PATH}")
    stats = organize(val_ratio=args.val_ratio, seed=args.seed, dry_run=args.dry_run)

    print(
        f"\nSummary: {stats['pairs']} labeled pairs → "
        f"train={stats['train']} val={stats['val']} "
        f"(skipped {stats['skipped_no_label']} without labels)"
    )
    if not args.dry_run:
        print("\nTrain with:")
        print(f"  yolo detect train data={YAML_PATH} model=yolov8n.pt epochs=100 imgsz=640")
        print("\nDeploy best.pt to backend/ml/models/ and set YOLO_MODEL_PATH in production.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
