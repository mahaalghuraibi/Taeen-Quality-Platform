"""
Resolve YOLO PPE weights for kitchen monitoring.

Search order:
  1) YOLO_MODEL_PATH env (absolute or relative to backend/)
  2) backend/ml/models/keremberk_ppe.pt
  3) backend/ml/models/hansung_ppe.pt
  4) any other *.pt in backend/ml/models/ (except person-only yolov8n.pt unless nothing else)
  5) optional auto-download (YOLO_AUTO_DOWNLOAD, default on in production)
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = _BACKEND_ROOT / "ml" / "models"

# Documented filenames (see ml/download_ppe_model.py)
PRIMARY_MODEL_FILENAME = "keremberk_ppe.pt"
FALLBACK_MODEL_FILENAME = "hansung_ppe.pt"
PERSON_MODEL_FILENAME = "yolov8n.pt"

PREFERRED_PPE_FILENAMES = (
    PRIMARY_MODEL_FILENAME,
    FALLBACK_MODEL_FILENAME,
    "best.pt",
)


def _parse_bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    s = str(raw).strip().lower()
    return s in ("1", "true", "yes", "on")


def get_models_dir() -> Path:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    return MODELS_DIR


def _resolve_configured_path(raw: str) -> Path | None:
    p = Path(raw.strip()).expanduser()
    if not p.is_absolute():
        p = (_BACKEND_ROOT / p).resolve()
    else:
        p = p.resolve()
    if p.is_file():
        return p
    logger.warning("YOLO_MODEL_PATH set but file not found: %s", p.as_posix())
    return None


def _discover_local_pt() -> Path | None:
    models_dir = get_models_dir()
    for name in PREFERRED_PPE_FILENAMES:
        candidate = models_dir / name
        if candidate.is_file():
            return candidate.resolve()

    others = sorted(
        (p.resolve() for p in models_dir.glob("*.pt") if p.is_file() and p.name != PERSON_MODEL_FILENAME),
        key=lambda p: p.name,
    )
    if others:
        return others[0]

    person_only = models_dir / PERSON_MODEL_FILENAME
    if person_only.is_file():
        logger.warning(
            "Only %s found in %s — PPE checks will be limited; run ml/download_ppe_model.py",
            PERSON_MODEL_FILENAME,
            models_dir.as_posix(),
        )
        return person_only.resolve()
    return None


def resolve_yolo_model_path(*, allow_download: bool = True) -> str:
    """
    Return absolute path to .pt weights, or empty string if unavailable.
    When allow_download is True, may fetch fallback weights on production.
    """
    configured = (settings.YOLO_MODEL_PATH or "").strip()
    if configured:
        found = _resolve_configured_path(configured)
        if found is not None:
            logger.info(
                "YOLO resolved via YOLO_MODEL_PATH → file=%s size=%s bytes",
                found.name,
                found.stat().st_size,
            )
            return found.as_posix()

    discovered = _discover_local_pt()
    if discovered is not None:
        logger.info(
            "YOLO resolved via ml/models → file=%s path=%s size=%s bytes",
            discovered.name,
            discovered.as_posix(),
            discovered.stat().st_size,
        )
        return discovered.as_posix()

    if allow_download and _parse_bool_env(
        "YOLO_AUTO_DOWNLOAD",
        default=settings.is_production,
    ):
        downloaded = _download_fallback_ppe_model()
        if downloaded:
            return downloaded.as_posix()

    return ""


_HF_PPE_URL = (
    "https://huggingface.co/Hansung-Cho/yolov8-ppe-detection/resolve/main/best.pt"
)


def _download_fallback_ppe_model() -> Path | None:
    """Download hansung_ppe.pt (~6 MB) from HuggingFace."""
    dest = get_models_dir() / FALLBACK_MODEL_FILENAME
    if dest.is_file() and dest.stat().st_size >= 3_000_000:
        logger.info("YOLO auto-download skipped — already present: %s", dest.as_posix())
        return dest.resolve()

    logger.info("YOLO auto-download starting → target=%s", dest.as_posix())

    try:
        from huggingface_hub import hf_hub_download
        import shutil

        cached = hf_hub_download(
            repo_id="Hansung-Cho/yolov8-ppe-detection",
            filename="best.pt",
            token=False,
        )
        shutil.copy2(cached, dest)
        logger.info(
            "YOLO auto-download (hub) complete → %s (%s bytes)",
            dest.as_posix(),
            dest.stat().st_size,
        )
        return dest.resolve()
    except Exception as exc:
        logger.warning("YOLO hub download failed (%s), trying direct URL", exc)

    try:
        import urllib.request

        tmp = dest.with_suffix(".pt.part")
        logger.info("YOLO direct download: %s", _HF_PPE_URL)
        with urllib.request.urlopen(_HF_PPE_URL, timeout=180) as resp, tmp.open("wb") as out:
            out.write(resp.read())
        tmp.replace(dest)
        if dest.stat().st_size < 3_000_000:
            dest.unlink(missing_ok=True)
            raise OSError(f"downloaded file too small: {dest}")
        logger.info(
            "YOLO direct download complete → %s (%s bytes)",
            dest.as_posix(),
            dest.stat().st_size,
        )
        return dest.resolve()
    except Exception as exc:
        logger.error("YOLO auto-download failed (hub + direct): %s", exc)
        return None


def missing_model_user_message() -> str:
    models_dir = get_models_dir()
    expected = ", ".join(PREFERRED_PPE_FILENAMES[:2])
    return (
        "YOLO model not configured. "
        f"Place {expected} under {models_dir.as_posix()} "
        "or set YOLO_MODEL_PATH. "
        "On Render, build should run: python ml/download_ppe_model.py --fallback-only"
    )


def startup_log_lines(resolved_path: str) -> list[str]:
    models_dir = get_models_dir()
    lines = [
        f"YOLO models directory: {models_dir.as_posix()}",
        f"YOLO expected filenames (priority): {', '.join(PREFERRED_PPE_FILENAMES[:2])}",
        f"YOLO_MODEL_PATH env: {(settings.YOLO_MODEL_PATH or '').strip() or '(unset)'}",
        f"YOLO resolved path: {resolved_path or 'NOT_CONFIGURED'}",
        f"YOLO_AUTO_DOWNLOAD: {_parse_bool_env('YOLO_AUTO_DOWNLOAD', settings.is_production)}",
    ]
    local_pts = sorted(p.name for p in models_dir.glob("*.pt") if p.is_file())
    lines.append(f"YOLO local .pt files: {local_pts or '(none)'}")
    return lines


def ensure_yolo_model_ready() -> str:
    """Resolve (and optionally download) weights; used at app startup."""
    return resolve_yolo_model_path(allow_download=True)
