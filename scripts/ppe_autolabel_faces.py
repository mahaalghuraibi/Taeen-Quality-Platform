#!/usr/bin/env python3
"""
Auto-label face bounding boxes for classification-only mask datasets.

The Kaggle/GitHub "Face Mask Detection" classification datasets (Prajna Bhandary)
have no bounding boxes — only raw images labelled by folder (with_mask / without_mask).
This script uses OpenCV's DNN face detector to locate each face and write YOLO labels.

Input:
  dataset/mask/raw/images/    → labeled as class 0 (mask)
  dataset/no_mask/raw/images/ → labeled as class 1 (no_mask)

  OR pass --source-dir with with_mask/ and without_mask/ subfolders.

Output (YOLO format):
  dataset/ppe_sources/kaggle_mask_labeled/mask/images/     + labels/
  dataset/ppe_sources/kaggle_mask_labeled/no_mask/images/  + labels/

The labels reference two classes per the PPE mask model convention:
  class 0 = mask
  class 1 = no_mask

Requires:
  pip install opencv-python-headless
  # Face detector weights are downloaded automatically on first run.

Usage:
  python scripts/ppe_autolabel_faces.py
  python scripts/ppe_autolabel_faces.py --source-dir ~/Desktop/data
  python scripts/ppe_autolabel_faces.py --conf 0.5 --dry-run
"""
from __future__ import annotations

import argparse
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = ROOT / "dataset" / "ppe_sources"
DATASET_ROOT = ROOT / "dataset"
OUT_DIR = SOURCES_DIR / "kaggle_mask_labeled"

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# OpenCV DNN face detector model files (Caffe model, accurate, no GPU required)
_PROTOTXT_URL = (
    "https://raw.githubusercontent.com/opencv/opencv/master/samples/dnn/"
    "face_detector/deploy.prototxt"
)
_CAFFEMODEL_URL = (
    "https://github.com/opencv/opencv_3rdparty/raw/dnn_samples_face_detector_20170830/"
    "res10_300x300_ssd_iter_140000.caffemodel"
)
_MODELS_CACHE = ROOT / ".cache" / "face_detector"


def _ensure_face_detector() -> tuple[Path, Path]:
    """Download face detector weights if not cached. Returns (prototxt, caffemodel)."""
    _MODELS_CACHE.mkdir(parents=True, exist_ok=True)
    proto = _MODELS_CACHE / "deploy.prototxt"
    caffe = _MODELS_CACHE / "res10_300x300_ssd.caffemodel"

    if not proto.is_file():
        print(f"Downloading face detector prototxt …")
        urllib.request.urlretrieve(_PROTOTXT_URL, str(proto))
    if not caffe.is_file():
        print(f"Downloading face detector weights (~2 MB) …")
        urllib.request.urlretrieve(_CAFFEMODEL_URL, str(caffe))
    return proto, caffe


def _detect_faces(img, net, conf_threshold: float) -> list[tuple[float, float, float, float]]:
    """Return list of (x_center, y_center, width, height) in [0,1] coords."""
    import cv2
    import numpy as np

    h, w = img.shape[:2]
    blob = cv2.dnn.blobFromImage(cv2.resize(img, (300, 300)), 1.0, (300, 300),
                                 (104.0, 177.0, 123.0))
    net.setInput(blob)
    detections = net.forward()

    boxes: list[tuple[float, float, float, float]] = []
    for i in range(detections.shape[2]):
        confidence = float(detections[0, 0, i, 2])
        if confidence < conf_threshold:
            continue
        x1 = max(0.0, float(detections[0, 0, i, 3]))
        y1 = max(0.0, float(detections[0, 0, i, 4]))
        x2 = min(1.0, float(detections[0, 0, i, 5]))
        y2 = min(1.0, float(detections[0, 0, i, 6]))
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2
        bw = x2 - x1
        bh = y2 - y1
        if bw > 0.01 and bh > 0.01:
            boxes.append((cx, cy, bw, bh))
    return boxes


def process_folder(
    images_dir: Path,
    out_img_dir: Path,
    out_lbl_dir: Path,
    class_id: int,
    net,
    conf_threshold: float,
    dry_run: bool,
) -> tuple[int, int, int]:
    """Returns (total, labeled, skipped_no_face)."""
    import cv2

    total = skipped = labeled = 0
    for img_path in sorted(images_dir.rglob("*")):
        if img_path.suffix.lower() not in IMAGE_EXT:
            continue
        total += 1

        img = cv2.imread(str(img_path))
        if img is None:
            skipped += 1
            continue

        faces = _detect_faces(img, net, conf_threshold)
        if not faces:
            skipped += 1
            continue

        stem = img_path.stem
        dest_img = out_img_dir / f"{stem}{img_path.suffix.lower()}"
        dest_lbl = out_lbl_dir / f"{stem}.txt"

        if not dry_run:
            out_img_dir.mkdir(parents=True, exist_ok=True)
            out_lbl_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(img_path, dest_img)
            lines = [f"{class_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}" for cx, cy, bw, bh in faces]
            dest_lbl.write_text("\n".join(lines) + "\n", encoding="utf-8")

        labeled += 1

    return total, labeled, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description="Auto-label face bboxes in mask datasets")
    parser.add_argument(
        "--source-dir", type=Path,
        help="Folder containing with_mask/ and without_mask/ (default: dataset/mask/raw and no_mask/raw)",
    )
    parser.add_argument("--conf", type=float, default=0.4,
                        help="Face detector confidence threshold (default: 0.4)")
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR,
                        help=f"Output directory (default: {OUT_DIR})")
    parser.add_argument("--dry-run", action="store_true", help="Count only, do not write files")
    args = parser.parse_args()

    try:
        import cv2
    except ImportError:
        print("ERROR: pip install opencv-python-headless", file=sys.stderr)
        return 1

    proto, caffe = _ensure_face_detector()
    net = cv2.dnn.readNetFromCaffe(str(proto), str(caffe))
    print("Face detector loaded.")

    if args.source_dir:
        mask_src = args.source_dir / "with_mask"
        no_mask_src = args.source_dir / "without_mask"
    else:
        mask_src = DATASET_ROOT / "mask" / "raw" / "images"
        no_mask_src = DATASET_ROOT / "no_mask" / "raw" / "images"

    out = args.out_dir
    mask_img_out = out / "mask" / "images"
    mask_lbl_out = out / "mask" / "labels"
    no_mask_img_out = out / "no_mask" / "images"
    no_mask_lbl_out = out / "no_mask" / "labels"

    if args.dry_run:
        print("(dry-run — no files written)")

    print(f"\nProcessing MASK images: {mask_src}")
    if mask_src.is_dir():
        t, l, s = process_folder(mask_src, mask_img_out, mask_lbl_out, 0, net, args.conf, args.dry_run)
        print(f"  Total: {t}  Labeled: {l}  Skipped (no face): {s}")
    else:
        print(f"  Not found: {mask_src}")
        l = 0

    print(f"\nProcessing NO_MASK images: {no_mask_src}")
    if no_mask_src.is_dir():
        t2, l2, s2 = process_folder(no_mask_src, no_mask_img_out, no_mask_lbl_out, 1, net, args.conf, args.dry_run)
        print(f"  Total: {t2}  Labeled: {l2}  Skipped (no face): {s2}")
    else:
        print(f"  Not found: {no_mask_src}")
        l2 = 0

    print(f"\nTotal labeled images: {l + l2}")
    if not args.dry_run:
        print(f"Output: {out}")
        print("\nNext: python scripts/ppe_normalize_labels.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
