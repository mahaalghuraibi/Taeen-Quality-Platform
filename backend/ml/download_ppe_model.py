"""
Downloads real PPE YOLO models for kitchen safety monitoring.

Primary model (keremberk_ppe.pt — YOLOv8m):
  Source : thalostech2025/keremberk_yolov8m_ppe on HuggingFace (public)
  Classes: glove, goggles, helmet, mask, no_* variants, shoes, etc.
  Size   : ~52 MB
  Use for: backend maps only kitchen checks (mask, gloves, headcover, uniform);
           goggles/shoes/trash outputs from weights are ignored in reports.

Fallback model (hansung_ppe.pt — YOLOv8n):
  Source : Hansung-Cho/yolov8-ppe-detection on HuggingFace (public)
  Classes: Hardhat, Mask, NO-Hardhat, NO-Mask, NO-Safety Vest,
           Person, Safety Cone, Safety Vest, machinery, vehicle
  Size   : ~6 MB
  Use for: lighter alternative; covers uniform/vest + person counting

Run from the backend/ directory:
  python3 ml/download_ppe_model.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

MODELS = [
    {
        "repo_id":   "thalostech2025/keremberk_yolov8m_ppe",
        "filename":  "best.pt",
        "dest_name": "keremberk_ppe.pt",
        "label":     "Primary (YOLOv8m — gloves + mask + headcover)",
        "primary":   True,
    },
    {
        "repo_id":   "Hansung-Cho/yolov8-ppe-detection",
        "filename":  "best.pt",
        "dest_name": "hansung_ppe.pt",
        "label":     "Fallback (YOLOv8n — mask + headcover + vest + person)",
        "primary":   False,
    },
]

EXPECTED_MIN_BYTES = 3_000_000


def _download_hf(repo_id: str, filename: str, dest: Path) -> bool:
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        print("  huggingface_hub not installed — pip install huggingface_hub")
        return False

    if dest.exists() and dest.stat().st_size >= EXPECTED_MIN_BYTES:
        print(f"  Already present: {dest}  ({dest.stat().st_size:,} bytes)")
        return True

    print(f"  Downloading {repo_id}/{filename} …", flush=True)
    try:
        cached = hf_hub_download(repo_id=repo_id, filename=filename, token=False)
        shutil.copy2(cached, dest)
        print(f"  Saved → {dest}  ({dest.stat().st_size:,} bytes)", flush=True)
        return True
    except Exception as exc:
        print(f"  FAILED: {exc}", flush=True)
        return False


def _verify(dest: Path) -> None:
    try:
        from ultralytics import YOLO
    except ImportError:
        print("  ultralytics not installed — pip install ultralytics")
        return

    model = YOLO(str(dest))
    names = model.names
    print(f"  Verified — {len(names)} classes: {list(names.values())}", flush=True)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Download PPE YOLO weights into backend/ml/models/")
    parser.add_argument(
        "--fallback-only",
        action="store_true",
        help="Download only hansung_ppe.pt (~6 MB) — recommended for Render build.",
    )
    args = parser.parse_args()
    specs = [m for m in MODELS if not m["primary"]] if args.fallback_only else MODELS

    any_failed = False

    for spec in specs:
        dest = MODELS_DIR / spec["dest_name"]
        print(f"\n=== {spec['label']} ===", flush=True)
        ok = _download_hf(spec["repo_id"], spec["filename"], dest)
        if not ok and dest.exists() and dest.stat().st_size >= EXPECTED_MIN_BYTES:
            print(f"  Using existing file: {dest}  ({dest.stat().st_size:,} bytes)", flush=True)
            ok = True
        if ok:
            _verify(dest)
        else:
            any_failed = True
            if spec.get("primary"):
                print("  ERROR: primary model download failed.", file=sys.stderr)

    primary = MODELS_DIR / MODELS[0]["dest_name"]
    fallback = MODELS_DIR / MODELS[1]["dest_name"]
    print("\n" + "=" * 60, flush=True)
    if args.fallback_only:
        if fallback.exists():
            print(f"Fallback model ready: {fallback.resolve()}", flush=True)
            print("Auto-discovered at startup as backend/ml/models/hansung_ppe.pt", flush=True)
        else:
            print("Fallback model NOT available. Check errors above.", file=sys.stderr)
            sys.exit(1)
    elif primary.exists():
        print(f"Primary model ready: {primary.resolve()}", flush=True)
        print(f"\nOptional .env:\n  YOLO_MODEL_PATH={primary.resolve()}", flush=True)
    else:
        print("Primary model NOT available. Check errors above.", file=sys.stderr)
        sys.exit(1)

    if any_failed:
        sys.exit(2)


if __name__ == "__main__":
    main()
