#!/usr/bin/env python3
"""
AI Accuracy Validation — Local YOLO Agent (عين الجودة)
======================================================

Measures how accurately the two local YOLO models detect each violation type,
using a labelled validation dataset of REAL restaurant images.

This tool produces MEASURABLE accuracy reports. It deliberately does NOT and
cannot claim 100% accuracy — real-world CCTV detection always has error.

Dataset layout (see datasets/validation/README_AR.md):
    datasets/validation/
        ppe/{no_mask,mask_ok,no_gloves,gloves_ok,...}
        environment/{wet_floor,dry_floor,trash_on_floor,clean_floor,...}

For each violation class we build a binary confusion matrix:
    positive folder  → the violation SHOULD be detected   (TP if detected, FN if missed)
    negative folder  → the violation should NOT be detected (FP if detected, TN if clean)

Outputs:
    reports/AI_ACCURACY_REPORT_AR.md
    reports/AI_ACCURACY_RESULTS.csv
    reports/AI_ACCURACY_SUMMARY.json

Usage:
    python scripts/evaluate_local_yolo_accuracy.py
    python scripts/evaluate_local_yolo_accuracy.py --dataset datasets/validation
    python scripts/evaluate_local_yolo_accuracy.py --conf 0.45
    python scripts/evaluate_local_yolo_accuracy.py --config local_ai_agent/config.yaml
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths (resolve relative to repo root = parent of this scripts/ folder)
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = REPO_ROOT / "datasets" / "validation"
DEFAULT_CONFIG = REPO_ROOT / "local_ai_agent" / "config.yaml"
REPORTS_DIR = REPO_ROOT / "reports"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# ---------------------------------------------------------------------------
# Validation class definitions
# Each violation class maps to (positive_folder, negative_folder, group, threshold%)
# Thresholds are the production PASS bar for accuracy.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ClassSpec:
    violation_type: str
    group: str            # "ppe" | "environment"
    positive_dir: str     # folder with images where violation is present
    negative_dir: str     # folder with images where violation is absent
    threshold: float      # production accuracy threshold (percent)
    label_ar: str


CLASS_SPECS: list[ClassSpec] = [
    ClassSpec("no_mask", "ppe", "no_mask", "mask_ok", 90.0, "عدم ارتداء الكمامة"),
    ClassSpec("no_gloves", "ppe", "no_gloves", "gloves_ok", 75.0, "عدم ارتداء القفازات"),
    ClassSpec("no_headcover", "ppe", "no_headcover", "headcover_ok", 85.0, "عدم ارتداء غطاء الرأس"),
    ClassSpec("improper_uniform", "ppe", "improper_uniform", "uniform_ok", 80.0, "زي غير مطابق"),
    ClassSpec("wet_floor", "environment", "wet_floor", "dry_floor", 80.0, "أرضية مبللة"),
    ClassSpec("trash_on_floor", "environment", "trash_on_floor", "clean_floor", 80.0, "نفايات على الأرض"),
    ClassSpec("unclean_area", "environment", "unclean_area", "clean_area", 80.0, "منطقة غير نظيفة"),
    ClassSpec("blocked_path", "environment", "blocked_path", "clear_path", 80.0, "ممر مسدود"),
    ClassSpec("unsafe_area", "environment", "unsafe_area", "safe_area", 80.0, "منطقة غير آمنة"),
]

# Raw model class-name → canonical violation_type (mirror local_ai_agent/agent.py).
PPE_VIOLATION_CLASSES: dict[str, str] = {
    "no_gloves": "no_gloves", "no-glove": "no_gloves", "without_gloves": "no_gloves",
    "no_mask": "no_mask", "no-mask": "no_mask", "without_mask": "no_mask",
    "no_headcover": "no_headcover", "no-hardhat": "no_headcover", "no_hat": "no_headcover",
    "no_haircover": "no_headcover", "no_hairnet": "no_headcover",
    "improper_uniform": "improper_uniform", "no_uniform": "improper_uniform",
}
ENV_VIOLATION_CLASSES: dict[str, str] = {
    "wet_floor": "wet_floor", "wet-floor": "wet_floor", "water": "wet_floor",
    "trash": "trash_on_floor", "trash_on_floor": "trash_on_floor", "garbage": "trash_on_floor",
    "litter": "trash_on_floor",
    "unclean_area": "unclean_area", "dirty": "unclean_area", "stain": "unclean_area",
    "blocked_path": "blocked_path", "obstacle": "blocked_path", "blocked": "blocked_path",
    "unsafe_area": "unsafe_area", "hazard": "unsafe_area", "unsafe": "unsafe_area",
}


# ---------------------------------------------------------------------------
# Result containers
# ---------------------------------------------------------------------------
@dataclass
class ClassResult:
    violation_type: str
    group: str
    label_ar: str
    threshold: float
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0
    positive_images: int = 0
    negative_images: int = 0
    missing_dirs: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return self.tp + self.fp + self.fn + self.tn

    @property
    def accuracy(self) -> float | None:
        return None if self.total == 0 else 100.0 * (self.tp + self.tn) / self.total

    @property
    def precision(self) -> float | None:
        denom = self.tp + self.fp
        return None if denom == 0 else 100.0 * self.tp / denom

    @property
    def recall(self) -> float | None:
        denom = self.tp + self.fn
        return None if denom == 0 else 100.0 * self.tp / denom

    @property
    def status(self) -> str:
        if self.total == 0:
            return "NO_DATA"
        acc = self.accuracy or 0.0
        return "PASSED" if acc >= self.threshold else "NEEDS_RETRAINING"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _fmt(value: float | None) -> str:
    return "—" if value is None else f"{value:.1f}%"


def count_images(directory: Path) -> int:
    if not directory.is_dir():
        return 0
    return sum(1 for p in directory.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS)


def list_images(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS)


def load_agent_config(config_path: Path) -> dict[str, Any]:
    try:
        import yaml
    except ImportError:
        return {}
    if not config_path.is_file():
        return {}
    try:
        with config_path.open("r", encoding="utf-8") as fh:
            return yaml.safe_load(fh) or {}
    except Exception:
        return {}


def dataset_inventory(dataset_dir: Path) -> dict[str, int]:
    inv: dict[str, int] = {}
    for spec in CLASS_SPECS:
        pos = dataset_dir / spec.group / spec.positive_dir
        neg = dataset_dir / spec.group / spec.negative_dir
        inv[f"{spec.group}/{spec.positive_dir}"] = count_images(pos)
        inv[f"{spec.group}/{spec.negative_dir}"] = count_images(neg)
    return inv


# ---------------------------------------------------------------------------
# Inference engine (lazy — only loaded when there are images to test)
# ---------------------------------------------------------------------------
class DualYoloEvaluator:
    def __init__(self, ppe_model_path: Path, env_model_path: Path, conf: float, device: str):
        self.ppe_model_path = ppe_model_path
        self.env_model_path = env_model_path
        self.conf = conf
        self.device = device
        self._ppe = None
        self._env = None

    def resolve_device(self) -> str:
        if self.device in ("cpu", "cuda"):
            return self.device
        try:
            import torch
            return "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            return "cpu"

    def load(self) -> None:
        from ultralytics import YOLO
        self.device = self.resolve_device()
        self._ppe = YOLO(str(self.ppe_model_path))
        self._env = YOLO(str(self.env_model_path))

    def _detect(self, model, image_path: Path, class_map: dict[str, str]) -> set[str]:
        found: set[str] = set()
        results = model.predict(str(image_path), conf=self.conf, device=self.device, verbose=False)
        for res in results:
            names = res.names or {}
            for box in res.boxes or []:
                cls_id = int(box.cls[0])
                raw = str(names.get(cls_id, cls_id)).strip().lower()
                vt = class_map.get(raw)
                if vt:
                    found.add(vt)
        return found

    def detect_ppe(self, image_path: Path) -> set[str]:
        return self._detect(self._ppe, image_path, PPE_VIOLATION_CLASSES)

    def detect_env(self, image_path: Path) -> set[str]:
        return self._detect(self._env, image_path, ENV_VIOLATION_CLASSES)


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
def evaluate(
    dataset_dir: Path,
    evaluator: DualYoloEvaluator,
) -> list[ClassResult]:
    results: list[ClassResult] = []
    for spec in CLASS_SPECS:
        cr = ClassResult(
            violation_type=spec.violation_type,
            group=spec.group,
            label_ar=spec.label_ar,
            threshold=spec.threshold,
        )
        pos_dir = dataset_dir / spec.group / spec.positive_dir
        neg_dir = dataset_dir / spec.group / spec.negative_dir
        if not pos_dir.is_dir():
            cr.missing_dirs.append(f"{spec.group}/{spec.positive_dir}")
        if not neg_dir.is_dir():
            cr.missing_dirs.append(f"{spec.group}/{spec.negative_dir}")

        detect = evaluator.detect_ppe if spec.group == "ppe" else evaluator.detect_env

        for img in list_images(pos_dir):
            cr.positive_images += 1
            detected = spec.violation_type in detect(img)
            if detected:
                cr.tp += 1
            else:
                cr.fn += 1

        for img in list_images(neg_dir):
            cr.negative_images += 1
            detected = spec.violation_type in detect(img)
            if detected:
                cr.fp += 1
            else:
                cr.tn += 1

        results.append(cr)
    return results


# ---------------------------------------------------------------------------
# Report writers
# ---------------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def write_not_ready_reports(
    reports_dir: Path,
    dataset_dir: Path,
    inventory: dict[str, int],
    reason: str,
    missing: list[str],
    recommended_per_class: int,
) -> None:
    reports_dir.mkdir(parents=True, exist_ok=True)
    generated = _now_iso()

    summary = {
        "generated_at": generated,
        "status": "DATASET_NOT_READY",
        "dataset_ready": False,
        "reason": reason,
        "dataset_dir": str(dataset_dir),
        "recommended_min_images_per_class": recommended_per_class,
        "missing_or_empty": missing,
        "inventory": inventory,
        "classes": [],
        "disclaimer": "هذا النظام يقيس الدقة ولا يدّعي دقة 100%. النتائج الواقعية دائماً تحتوي نسبة خطأ.",
    }
    (reports_dir / "AI_ACCURACY_SUMMARY.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    with (reports_dir / "AI_ACCURACY_RESULTS.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["folder", "image_count", "status"])
        for folder, cnt in inventory.items():
            w.writerow([folder, cnt, "EMPTY" if cnt == 0 else "OK"])

    lines: list[str] = []
    lines.append("# تقرير دقة الذكاء الاصطناعي — الوكيل المحلي YOLO")
    lines.append("")
    lines.append(f"> تاريخ التوليد: {generated}")
    lines.append("> الحالة: **مجموعة البيانات غير جاهزة (DATASET NOT READY)**")
    lines.append("")
    lines.append("## ملاحظة مهمة")
    lines.append("")
    lines.append("هذا النظام يقيس الدقة بشكل قابل للقياس **ولا يدّعي دقة 100%**. "
                 "أنظمة الرؤية الحاسوبية الواقعية دائماً بها نسبة خطأ.")
    lines.append("")
    lines.append("## لماذا التقرير غير مكتمل؟")
    lines.append("")
    lines.append(f"{reason}")
    lines.append("")
    lines.append(f"**الحد الأدنى الموصى به:** {recommended_per_class} صورة لكل فئة.")
    lines.append("")
    lines.append("## المجلدات المفقودة أو الفارغة")
    lines.append("")
    if missing:
        lines.append("| المجلد | عدد الصور |")
        lines.append("|--------|-----------|")
        for folder in missing:
            lines.append(f"| `datasets/validation/{folder}` | {inventory.get(folder, 0)} |")
    else:
        lines.append("لا يوجد.")
    lines.append("")
    lines.append("## جرد كامل لمجموعة البيانات")
    lines.append("")
    lines.append("| المجلد | عدد الصور | الحالة |")
    lines.append("|--------|-----------|--------|")
    for folder, cnt in inventory.items():
        state = "❌ فارغ" if cnt == 0 else f"✅ {cnt}"
        lines.append(f"| `{folder}` | {cnt} | {state} |")
    lines.append("")
    lines.append("## الخطوات التالية")
    lines.append("")
    lines.append("1. أضف صور اختبار حقيقية من كاميرات المطعم إلى المجلدات أعلاه.")
    lines.append("2. راجع `docs/AI_VALIDATION_GUIDE_AR.md` لمعرفة كيفية جمع الصور.")
    lines.append("3. أعد تشغيل: `python scripts/evaluate_local_yolo_accuracy.py`")
    lines.append("")
    (reports_dir / "AI_ACCURACY_REPORT_AR.md").write_text("\n".join(lines), encoding="utf-8")


def write_full_reports(
    reports_dir: Path,
    dataset_dir: Path,
    results: list[ClassResult],
    conf: float,
    device: str,
    ppe_model: str,
    env_model: str,
) -> dict[str, Any]:
    reports_dir.mkdir(parents=True, exist_ok=True)
    generated = _now_iso()

    tested = [r for r in results if r.total > 0]
    passed = [r for r in tested if r.status == "PASSED"]
    failed = [r for r in tested if r.status == "NEEDS_RETRAINING"]
    no_data = [r for r in results if r.total == 0]

    overall_status = "PASSED" if tested and not failed and not no_data else (
        "PARTIAL" if tested else "DATASET_NOT_READY"
    )

    # JSON summary
    classes_json = []
    for r in results:
        classes_json.append({
            "violation_type": r.violation_type,
            "group": r.group,
            "label_ar": r.label_ar,
            "threshold_pct": r.threshold,
            "total_tested_images": r.total,
            "positive_images": r.positive_images,
            "negative_images": r.negative_images,
            "true_positives": r.tp,
            "false_positives": r.fp,
            "false_negatives": r.fn,
            "true_negatives": r.tn,
            "accuracy_pct": None if r.accuracy is None else round(r.accuracy, 2),
            "precision_pct": None if r.precision is None else round(r.precision, 2),
            "recall_pct": None if r.recall is None else round(r.recall, 2),
            "status": r.status,
        })

    summary = {
        "generated_at": generated,
        "status": overall_status,
        "dataset_ready": bool(tested),
        "dataset_dir": str(dataset_dir),
        "confidence_threshold": conf,
        "device": device,
        "models": {"ppe_model": ppe_model, "environment_model": env_model},
        "totals": {
            "classes_total": len(results),
            "classes_tested": len(tested),
            "classes_passed": len(passed),
            "classes_needs_retraining": len(failed),
            "classes_no_data": len(no_data),
            "images_tested": sum(r.total for r in results),
        },
        "classes": classes_json,
        "disclaimer": "هذا النظام يقيس الدقة ولا يدّعي دقة 100%. النتائج الواقعية دائماً تحتوي نسبة خطأ.",
    }
    (reports_dir / "AI_ACCURACY_SUMMARY.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # CSV
    with (reports_dir / "AI_ACCURACY_RESULTS.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow([
            "violation_type", "group", "threshold_pct", "total_images",
            "positive_images", "negative_images",
            "true_positives", "false_positives", "false_negatives", "true_negatives",
            "accuracy_pct", "precision_pct", "recall_pct", "status",
        ])
        for r in results:
            w.writerow([
                r.violation_type, r.group, f"{r.threshold:.0f}", r.total,
                r.positive_images, r.negative_images,
                r.tp, r.fp, r.fn, r.tn,
                "" if r.accuracy is None else f"{r.accuracy:.1f}",
                "" if r.precision is None else f"{r.precision:.1f}",
                "" if r.recall is None else f"{r.recall:.1f}",
                r.status,
            ])

    # Markdown
    status_ar = {
        "PASSED": "✅ اجتاز",
        "PARTIAL": "⚠️ جزئي — بعض الفئات تحتاج عمل",
        "DATASET_NOT_READY": "❌ البيانات غير جاهزة",
    }[overall_status]

    lines: list[str] = []
    lines.append("# تقرير دقة الذكاء الاصطناعي — الوكيل المحلي YOLO")
    lines.append("")
    lines.append(f"> تاريخ التوليد: {generated}")
    lines.append(f"> الحالة العامة: **{status_ar}**")
    lines.append(f"> عتبة الثقة: {conf} · الجهاز: {device}")
    lines.append("")
    lines.append("## ملاحظة مهمة عن الدقة")
    lines.append("")
    lines.append("هذا التقرير يقدّم أرقاماً **قابلة للقياس** عن أداء النماذج. "
                 "**لا ندّعي دقة 100%** — جميع أنظمة الرؤية الحاسوبية بها نسبة خطأ، "
                 "وتتأثر بالإضاءة وزاوية الكاميرا والحركة وعدد الأشخاص.")
    lines.append("")
    lines.append("## الملخص")
    lines.append("")
    lines.append(f"- إجمالي الفئات: **{len(results)}**")
    lines.append(f"- فئات تم اختبارها: **{len(tested)}**")
    lines.append(f"- فئات اجتازت العتبة: **{len(passed)}**")
    lines.append(f"- فئات تحتاج إعادة تدريب: **{len(failed)}**")
    lines.append(f"- فئات بدون بيانات: **{len(no_data)}**")
    lines.append(f"- إجمالي الصور المُختبرة: **{sum(r.total for r in results)}**")
    lines.append("")
    lines.append("## النتائج لكل فئة")
    lines.append("")
    lines.append("| المخالفة | المجموعة | صور | الدقة | الدقة الإيجابية (Precision) | الاستدعاء (Recall) | FP | FN | العتبة | الحالة |")
    lines.append("|----------|----------|-----|-------|------|------|----|----|--------|--------|")
    for r in results:
        st = {
            "PASSED": "✅ اجتاز",
            "NEEDS_RETRAINING": "❌ يحتاج إعادة تدريب",
            "NO_DATA": "➖ لا بيانات",
        }[r.status]
        lines.append(
            f"| {r.label_ar} (`{r.violation_type}`) | {r.group} | {r.total} | "
            f"{_fmt(r.accuracy)} | {_fmt(r.precision)} | {_fmt(r.recall)} | "
            f"{r.fp} | {r.fn} | {r.threshold:.0f}% | {st} |"
        )
    lines.append("")
    lines.append("### شرح المقاييس")
    lines.append("")
    lines.append("- **الدقة (Accuracy):** نسبة التصنيفات الصحيحة (مخالفة وسليم) من الإجمالي.")
    lines.append("- **الدقة الإيجابية (Precision):** من بين ما اعتُبر مخالفة، كم كان فعلاً مخالفة (يقيس الإنذارات الكاذبة).")
    lines.append("- **الاستدعاء (Recall):** من بين المخالفات الحقيقية، كم اكتشفها النموذج (يقيس المخالفات الفائتة).")
    lines.append("- **FP:** إنذارات كاذبة · **FN:** مخالفات فائتة.")
    lines.append("")

    if failed:
        lines.append("## فئات تحتاج إعادة تدريب")
        lines.append("")
        for r in failed:
            lines.append(
                f"- **{r.label_ar}** (`{r.violation_type}`): الدقة {_fmt(r.accuracy)} "
                f"أقل من العتبة {r.threshold:.0f}%. راجع قسم \"ماذا تفعل عند فشل فئة\" في "
                "`docs/AI_VALIDATION_GUIDE_AR.md`."
            )
        lines.append("")

    if no_data:
        lines.append("## فئات بدون بيانات (أضف صوراً)")
        lines.append("")
        for r in no_data:
            lines.append(f"- `{r.violation_type}` — لم تُضَف صور بعد.")
        lines.append("")

    lines.append("## ملفات التقرير")
    lines.append("")
    lines.append("- `reports/AI_ACCURACY_REPORT_AR.md` (هذا الملف)")
    lines.append("- `reports/AI_ACCURACY_RESULTS.csv`")
    lines.append("- `reports/AI_ACCURACY_SUMMARY.json`")
    lines.append("")
    (reports_dir / "AI_ACCURACY_REPORT_AR.md").write_text("\n".join(lines), encoding="utf-8")

    return summary


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="تقييم دقة نماذج YOLO المحلية")
    parser.add_argument("--dataset", default=str(DEFAULT_DATASET), help="مجلد بيانات التحقق")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="مسار config.yaml للوكيل المحلي")
    parser.add_argument("--conf", type=float, default=None, help="عتبة الثقة (تتجاوز config.yaml)")
    parser.add_argument("--device", default=None, help="auto | cuda | cpu")
    parser.add_argument("--reports", default=str(REPORTS_DIR), help="مجلد حفظ التقارير")
    parser.add_argument("--min-images", type=int, default=20, help="الحد الأدنى الموصى به للصور لكل فئة")
    args = parser.parse_args(argv)

    dataset_dir = Path(args.dataset).resolve()
    reports_dir = Path(args.reports).resolve()
    config_path = Path(args.config).resolve()

    cfg = load_agent_config(config_path)
    models_cfg = cfg.get("models") or {}
    detection_cfg = cfg.get("detection") or {}
    advanced_cfg = cfg.get("advanced") or {}

    conf = args.conf if args.conf is not None else float(detection_cfg.get("confidence_threshold", 0.45))
    device = args.device or str(advanced_cfg.get("device", "auto")).lower()

    # Model paths are relative to local_ai_agent/ by convention.
    agent_dir = config_path.parent
    ppe_model = (agent_dir / str(models_cfg.get("ppe_model", "models/ppe_yolo.pt"))).resolve()
    env_model = (agent_dir / str(models_cfg.get("environment_model", "models/environment_yolo.pt"))).resolve()

    inventory = dataset_inventory(dataset_dir)
    total_images = sum(inventory.values())
    empty_folders = [folder for folder, cnt in inventory.items() if cnt == 0]

    print(f"[validation] dataset={dataset_dir}")
    print(f"[validation] total images found: {total_images}")

    # --- Empty / not-ready dataset → graceful report, exit 0 -----------------
    if total_images == 0:
        reason = (
            "مجلدات بيانات التحقق فارغة — لم تُضَف أي صور اختبار بعد. "
            "لا يمكن قياس الدقة بدون صور حقيقية من كاميرات المطعم."
        )
        write_not_ready_reports(reports_dir, dataset_dir, inventory, reason, empty_folders, args.min_images)
        print("[validation] DATASET NOT READY — generated guidance report (no failure).")
        print(f"[validation] reports written to: {reports_dir}")
        return 0

    # --- Models missing → not-ready report -----------------------------------
    missing_models = [str(p) for p in (ppe_model, env_model) if not p.is_file()]
    if missing_models:
        reason = (
            "صور التحقق موجودة لكن نماذج YOLO غير موجودة على القرص: "
            + "، ".join(missing_models)
            + ". ضع ملفات .pt في local_ai_agent/models/ ثم أعد التشغيل."
        )
        write_not_ready_reports(reports_dir, dataset_dir, inventory, reason, missing_models, args.min_images)
        print("[validation] MODELS MISSING — generated guidance report (no failure).")
        print(f"[validation] reports written to: {reports_dir}")
        return 0

    # --- Run real evaluation -------------------------------------------------
    evaluator = DualYoloEvaluator(ppe_model, env_model, conf, device)
    try:
        evaluator.load()
    except ImportError:
        reason = (
            "حزم الاستدلال غير مثبتة (ultralytics / torch). "
            "ثبّت متطلبات الوكيل: pip install -r local_ai_agent/requirements.txt"
        )
        write_not_ready_reports(reports_dir, dataset_dir, inventory, reason, [], args.min_images)
        print("[validation] DEPENDENCIES MISSING — generated guidance report (no failure).")
        return 0
    except Exception as exc:
        reason = f"تعذّر تحميل النماذج: {exc}"
        write_not_ready_reports(reports_dir, dataset_dir, inventory, reason, [], args.min_images)
        print(f"[validation] MODEL LOAD FAILED — {exc}")
        return 0

    resolved_device = evaluator.resolve_device()
    print(f"[validation] device={resolved_device} conf={conf}")
    print(f"[validation] running inference on {total_images} images ...")

    results = evaluate(dataset_dir, evaluator)
    summary = write_full_reports(
        reports_dir, dataset_dir, results, conf, resolved_device,
        str(ppe_model), str(env_model),
    )

    print(f"[validation] overall status: {summary['status']}")
    print(f"[validation] passed={summary['totals']['classes_passed']} "
          f"needs_retraining={summary['totals']['classes_needs_retraining']} "
          f"no_data={summary['totals']['classes_no_data']}")
    print(f"[validation] reports written to: {reports_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
