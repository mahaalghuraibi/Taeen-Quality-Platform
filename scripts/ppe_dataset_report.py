#!/usr/bin/env python3
"""
Dataset quality report for all PPE model data.

Scans dataset/ppe_sources/, dataset/manual_collection/, and
the merged dataset/ppe_{mask,headcover,gloves}/ splits.

Prints:
  - Source inventory with image counts per class
  - Class balance
  - License / public status
  - Weak or missing classes
  - Whether retraining is safe

Usage:
  python scripts/ppe_dataset_report.py
  python scripts/ppe_dataset_report.py --json report.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = ROOT / "dataset" / "ppe_sources"
MANUAL_DIR  = ROOT / "dataset" / "manual_collection"
PPE_DIR     = ROOT / "dataset"

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# Known dataset catalogue with license and class info
CATALOGUE: dict[str, dict] = {
    "rf_mask_militech": {
        "description": "Face Mask Detection (militech/Roboflow)",
        "license": "CC BY 4.0",
        "source": "Roboflow Universe",
        "classes": {"mask": "~600", "no_mask": "~253"},
        "total_est": 853,
        "format": "YOLOv8 (pre-labeled)",
        "kitchen_specific": False,
        "has_dark_headcover": False,
    },
    "rf_mask_joseph": {
        "description": "Mask Wearing (joseph-nelson/Roboflow)",
        "license": "CC BY 4.0",
        "source": "Roboflow Universe",
        "classes": {"mask": "~500", "no_mask": "~300"},
        "total_est": 800,
        "format": "YOLOv8 (pre-labeled)",
        "kitchen_specific": False,
        "has_dark_headcover": False,
    },
    "kaggle_mask_andrewmvd": {
        "description": "Face Mask Detection (andrewmvd/Kaggle)",
        "license": "CC BY 4.0",
        "source": "Kaggle",
        "classes": {"mask": "~600", "no_mask": "~140", "mask_weared_incorrect": "~113"},
        "total_est": 853,
        "format": "Pascal VOC XML (needs ppe_convert_voc.py)",
        "kitchen_specific": False,
        "has_dark_headcover": False,
    },
    "kaggle_mask_labeled": {
        "description": "Prajna Bhandary mask dataset (auto-labeled by ppe_autolabel_faces.py)",
        "license": "MIT / Public",
        "source": "Kaggle / GitHub",
        "classes": {"mask": "~3725", "no_mask": "~3828"},
        "total_est": 7553,
        "format": "Classification only — needs ppe_autolabel_faces.py for bboxes",
        "kitchen_specific": False,
        "has_dark_headcover": False,
    },
    "rf_gloves_ppe": {
        "description": "Gloves PPE Detection (Roboflow Universe)",
        "license": "CC BY 4.0",
        "source": "Roboflow Universe",
        "classes": {"gloves": "~500", "no_gloves": "~220"},
        "total_est": 720,
        "format": "YOLOv8 (pre-labeled)",
        "kitchen_specific": False,
        "has_dark_headcover": False,
    },
    "rf_gloves_medical": {
        "description": "Medical Gloves Detection (Roboflow Universe)",
        "license": "CC BY 4.0",
        "source": "Roboflow Universe",
        "classes": {"gloves": "~400", "no_gloves": "~200"},
        "total_est": 600,
        "format": "YOLOv8 (pre-labeled)",
        "kitchen_specific": False,
        "has_dark_headcover": False,
    },
    "rf_hairnet_maha": {
        "description": "Hairnet Detection (maha-alghuraibi/Roboflow)",
        "license": "CC BY 4.0",
        "source": "Roboflow Universe",
        "classes": {"headcover": "~400", "no_headcover": "~200"},
        "total_est": 600,
        "format": "YOLOv8 (pre-labeled)",
        "kitchen_specific": True,
        "has_dark_headcover": False,
        "notes": "Mostly white/light hairnets. ZERO dark headcovers.",
    },
    "rf_headcover_protection": {
        "description": "Head Protection PPE (Roboflow Universe)",
        "license": "CC BY 4.0",
        "source": "Roboflow Universe",
        "classes": {"headcover (helmet/chef hat)": "~350", "no_headcover": "~150"},
        "total_est": 500,
        "format": "YOLOv8 (pre-labeled)",
        "kitchen_specific": False,
        "has_dark_headcover": False,
        "notes": "Chef hats and hard hats. Very few dark-colored headcovers.",
    },
}


def _count_images(folder: Path) -> int:
    if not folder.is_dir():
        return 0
    return sum(1 for p in folder.rglob("*") if p.suffix.lower() in IMAGE_EXT)


def _count_labels(folder: Path) -> int:
    if not folder.is_dir():
        return 0
    return sum(1 for p in folder.rglob("*.txt") if p.name != "classes.txt")


def _count_split(base: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    for split in ("train", "valid", "test"):
        d = base / "images" / split
        counts[split] = _count_images(d)
    return counts


def run_report(as_json: bool = False) -> dict:
    report: dict = {}

    # ── Section 1: Source inventory ──────────────────────────────────────────
    print("\n" + "=" * 70)
    print("SECTION 1: SOURCE DATASET INVENTORY")
    print("=" * 70)
    print(f"\n{'Source':<35} {'Downloaded':>11} {'Est. Total':>11}")
    print("-" * 60)

    total_mask_est = total_gloves_est = total_headcover_est = 0
    source_report: dict[str, dict] = {}
    for src_name, info in CATALOGUE.items():
        folder = SOURCES_DIR / src_name
        actual = _count_images(folder)
        est = info["total_est"]
        status = f"{actual:,}" if actual > 0 else "NOT DOWNLOADED"
        print(f"  {src_name:<33} {status:>11}  (est ~{est:,})")

        # Accumulate estimates by model type
        if "mask" in src_name:
            total_mask_est += est
        elif "glove" in src_name:
            total_gloves_est += est
        elif "hairnet" in src_name or "headcover" in src_name:
            total_headcover_est += est

        source_report[src_name] = {
            "downloaded": actual,
            "estimated": est,
            "license": info["license"],
            "kitchen_specific": info["kitchen_specific"],
        }

    report["sources"] = source_report

    # ── Section 2: Manual collection ─────────────────────────────────────────
    print("\n" + "=" * 70)
    print("SECTION 2: MANUAL COLLECTION (real kitchen images)")
    print("=" * 70)

    manual_targets = {
        "headcover_dark":    {"target": 150, "priority": "CRITICAL"},
        "headcover_light":   {"target": 100, "priority": "HIGH"},
        "mask_kitchen":      {"target": 150, "priority": "HIGH"},
        "no_mask_kitchen":   {"target": 150, "priority": "HIGH"},
        "gloves_kitchen":    {"target": 150, "priority": "MEDIUM"},
        "no_gloves_kitchen": {"target": 150, "priority": "MEDIUM"},
    }

    manual_report: dict[str, dict] = {}
    print(f"\n{'Folder':<28} {'Collected':>10} {'Target':>8} {'Priority':<12} {'Status'}")
    print("-" * 70)

    for folder_name, meta in manual_targets.items():
        folder = MANUAL_DIR / folder_name / "images"
        count = _count_images(folder)
        target = meta["target"]
        pct = count / target if target > 0 else 0
        priority = meta["priority"]
        if count == 0:
            status = "EMPTY — must collect"
        elif count < target * 0.5:
            status = f"INSUFFICIENT ({pct:.0%})"
        elif count < target:
            status = f"PARTIAL ({pct:.0%})"
        else:
            status = "READY"
        print(f"  {folder_name:<26} {count:>10}  {target:>8}  {priority:<12}  {status}")
        manual_report[folder_name] = {"collected": count, "target": target, "status": status}

    report["manual_collection"] = manual_report

    # ── Section 3: Merged dataset splits ─────────────────────────────────────
    print("\n" + "=" * 70)
    print("SECTION 3: MERGED DATASET SPLITS (ready for training)")
    print("=" * 70)
    print(f"\n{'Model':<15} {'Train':>8} {'Valid':>8} {'Test':>8} {'Total':>8}")
    print("-" * 50)

    merged_report: dict[str, dict] = {}
    for model in ("mask", "headcover", "gloves"):
        base = PPE_DIR / f"ppe_{model}"
        splits = _count_split(base)
        total = sum(splits.values())
        merged_report[model] = splits
        print(f"  {model:<13} {splits.get('train',0):>8} {splits.get('valid',0):>8} "
              f"{splits.get('test',0):>8} {total:>8}")

    report["merged_datasets"] = merged_report

    # ── Section 4: Class balance ──────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("SECTION 4: PUBLIC DATASET SUMMARY BY MODEL")
    print("=" * 70)

    model_summary = {
        "mask": {
            "public_sources": 3,
            "estimated_total": total_mask_est,
            "positive_class": "mask (workers wearing mask)",
            "negative_class": "no_mask (bare faces)",
            "kitchen_specific_images": 0,
            "dark_variant": "N/A",
        },
        "headcover": {
            "public_sources": 2,
            "estimated_total": total_headcover_est,
            "positive_class": "headcover (hairnets, chef hats)",
            "negative_class": "no_headcover (bare heads)",
            "kitchen_specific_images": "~400 (rf_hairnet_maha)",
            "dark_variant": "0 — MISSING from all public datasets",
        },
        "gloves": {
            "public_sources": 2,
            "estimated_total": total_gloves_est,
            "positive_class": "gloves (kitchen/medical gloves)",
            "negative_class": "no_gloves (bare hands)",
            "kitchen_specific_images": 0,
            "dark_variant": "Minimal black gloves in public sets",
        },
    }

    for model, info in model_summary.items():
        print(f"\n  {model.upper()}:")
        for k, v in info.items():
            print(f"    {k:<30} {v}")

    report["model_summaries"] = model_summary

    # ── Section 5: Weak / missing classes ────────────────────────────────────
    print("\n" + "=" * 70)
    print("SECTION 5: WEAK AND MISSING CLASSES")
    print("=" * 70)

    weak_classes = [
        ("dark/navy headcovers",       "CRITICAL",  "0 images in ANY public dataset. Must collect manually."),
        ("black latex kitchen gloves", "HIGH",      "~50 images in public sets. Need 150+ kitchen-specific."),
        ("green rubber kitchen gloves","HIGH",      "Minimal in public sets. Need 100+ real images."),
        ("mask at CCTV angle",         "HIGH",      "Public datasets are selfie-angle. CCTV = top-down. Very different."),
        ("mask in bad lighting",       "MEDIUM",    "Dark kitchens, steam — not in any Roboflow dataset."),
        ("gloves near food/utensils",  "MEDIUM",    "Context-aware detection needs hands near food surfaces."),
        ("no_headcover (bald/shaved)", "MEDIUM",    "Absence class for workers without hair. Often misdetected."),
    ]

    for cls, severity, note in weak_classes:
        print(f"\n  [{severity}] {cls}")
        print(f"    {note}")

    report["weak_classes"] = [{"class": c, "severity": s, "note": n} for c, s, n in weak_classes]

    # ── Section 6: Retraining safety check ───────────────────────────────────
    print("\n" + "=" * 70)
    print("SECTION 6: IS RETRAINING SAFE?")
    print("=" * 70)

    checks = [
        ("Public datasets downloaded",
         any(_count_images(SOURCES_DIR / s) > 0 for s in CATALOGUE),
         "Run: python scripts/ppe_download_datasets.py"),
        ("Manual headcover_dark images collected",
         _count_images(MANUAL_DIR / "headcover_dark" / "images") >= 50,
         "Collect 150+ real dark headcover images from your kitchen camera"),
        ("Merged ppe_mask dataset exists",
         _count_images(PPE_DIR / "ppe_mask" / "images" / "train") >= 100,
         "Run: python scripts/ppe_build_split.py"),
        ("Merged ppe_headcover dataset exists",
         _count_images(PPE_DIR / "ppe_headcover" / "images" / "train") >= 100,
         "Run: python scripts/ppe_build_split.py"),
        ("Merged ppe_gloves dataset exists",
         _count_images(PPE_DIR / "ppe_gloves" / "images" / "train") >= 100,
         "Run: python scripts/ppe_build_split.py"),
    ]

    all_ready = True
    for check_name, passed, action in checks:
        status = "PASS" if passed else "FAIL"
        if not passed:
            all_ready = False
        print(f"  [{status}] {check_name}")
        if not passed:
            print(f"         Action: {action}")

    print()
    if all_ready:
        print("  >>> All checks pass. Retraining is SAFE to start.")
        print("      Run: python scripts/ppe_train_all.py")
    else:
        print("  >>> NOT ready for retraining. Complete the FAIL steps above first.")
        print("      Retraining on incomplete data produces worse models than current ones.")

    report["retraining_safe"] = all_ready

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="PPE dataset quality report")
    parser.add_argument("--json", type=Path, help="Save report as JSON to this path")
    args = parser.parse_args()

    report = run_report()

    if args.json:
        args.json.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"\nJSON report: {args.json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
