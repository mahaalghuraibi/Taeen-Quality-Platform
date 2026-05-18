"""
Resolve YOLO PPE weights for kitchen monitoring.

Search order:
  1) YOLO_MODEL_PATH env (absolute or relative to backend/)
  2) backend/ml/models/hansung_ppe.pt (lightweight, preferred on Render)
  3) backend/ml/models/keremberk_ppe.pt
  4) any other *.pt in backend/ml/models/
  5) runtime download of hansung_ppe.pt when YOLO_AUTO_DOWNLOAD=true (default in production)

Weights are NOT downloaded at Render build time — first analyze-frame may fetch once.
"""
from __future__ import annotations

import logging
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = _BACKEND_ROOT / "ml" / "models"

PRIMARY_MODEL_FILENAME = "keremberk_ppe.pt"
FALLBACK_MODEL_FILENAME = "hansung_ppe.pt"
PERSON_MODEL_FILENAME = "yolov8n.pt"

PREFERRED_PPE_FILENAMES = (
    FALLBACK_MODEL_FILENAME,
    PRIMARY_MODEL_FILENAME,
    "best.pt",
)

_HF_PPE_URL = (
    "https://huggingface.co/Hansung-Cho/yolov8-ppe-detection/resolve/main/best.pt"
)
_EXPECTED_MIN_BYTES = 3_000_000
_DOWNLOAD_TIMEOUT_SEC = 240
_DOWNLOAD_MAX_RETRIES = 3


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
        if candidate.is_file() and candidate.stat().st_size >= _EXPECTED_MIN_BYTES:
            return candidate.resolve()

    others = sorted(
        (
            p.resolve()
            for p in models_dir.glob("*.pt")
            if p.is_file() and p.name != PERSON_MODEL_FILENAME and p.stat().st_size >= _EXPECTED_MIN_BYTES
        ),
        key=lambda p: p.name,
    )
    if others:
        return others[0]

    person_only = models_dir / PERSON_MODEL_FILENAME
    if person_only.is_file() and person_only.stat().st_size >= _EXPECTED_MIN_BYTES:
        logger.warning(
            "Only %s found in %s — PPE checks will be limited",
            PERSON_MODEL_FILENAME,
            models_dir.as_posix(),
        )
        return person_only.resolve()
    return None


def _download_via_hub(dest: Path) -> bool:
    try:
        from huggingface_hub import hf_hub_download
        import shutil

        cached = hf_hub_download(
            repo_id="Hansung-Cho/yolov8-ppe-detection",
            filename="best.pt",
            token=False,
        )
        shutil.copy2(cached, dest)
        return dest.is_file() and dest.stat().st_size >= _EXPECTED_MIN_BYTES
    except Exception as exc:
        logger.warning("YOLO runtime hub download failed: %s", exc)
        return False


def _download_via_direct_url(dest: Path) -> bool:
    tmp = dest.with_suffix(".pt.part")
    for attempt in range(1, _DOWNLOAD_MAX_RETRIES + 1):
        try:
            logger.info("YOLO runtime direct download attempt %d/%d", attempt, _DOWNLOAD_MAX_RETRIES)
            req = urllib.request.Request(
                _HF_PPE_URL,
                headers={"User-Agent": "taeen-quality-platform/1.0"},
            )
            with urllib.request.urlopen(req, timeout=_DOWNLOAD_TIMEOUT_SEC) as resp, tmp.open("wb") as out:
                while True:
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
            if tmp.stat().st_size < _EXPECTED_MIN_BYTES:
                tmp.unlink(missing_ok=True)
                raise OSError(f"downloaded file too small ({tmp.stat().st_size} bytes)")
            tmp.replace(dest)
            return True
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            logger.warning("YOLO runtime direct download attempt %d failed: %s", attempt, exc)
            tmp.unlink(missing_ok=True)
            if attempt < _DOWNLOAD_MAX_RETRIES:
                time.sleep(2 * attempt)
    return False


def _download_fallback_ppe_model() -> Path | None:
    """Download hansung_ppe.pt (~6 MB) at runtime into backend/ml/models/."""
    dest = get_models_dir() / FALLBACK_MODEL_FILENAME
    if dest.is_file() and dest.stat().st_size >= _EXPECTED_MIN_BYTES:
        logger.info("YOLO runtime download skipped — already cached: %s", dest.as_posix())
        return dest.resolve()

    logger.info("YOLO runtime download started → target=%s", dest.as_posix())

    ok = _download_via_hub(dest)
    if not ok:
        ok = _download_via_direct_url(dest)

    if ok and dest.is_file():
        logger.info(
            "YOLO runtime download completed → %s (%s bytes)",
            dest.as_posix(),
            dest.stat().st_size,
        )
        return dest.resolve()

    logger.error("YOLO runtime download failed after hub + direct URL attempts")
    dest.unlink(missing_ok=True)
    return None


def resolve_yolo_model_path(*, allow_download: bool = True) -> str:
    """
    Return absolute path to .pt weights, or empty string if unavailable.
    When allow_download is True, may fetch hansung_ppe.pt at runtime (not at startup).
    """
    configured = (settings.YOLO_MODEL_PATH or "").strip()
    if configured:
        found = _resolve_configured_path(configured)
        if found is not None:
            logger.info(
                "YOLO resolved via YOLO_MODEL_PATH → file=%s path=%s",
                found.name,
                found.as_posix(),
            )
            return found.as_posix()

    discovered = _discover_local_pt()
    if discovered is not None:
        logger.info(
            "YOLO resolved via ml/models → file=%s path=%s",
            discovered.name,
            discovered.as_posix(),
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


def missing_model_user_message() -> str:
    return (
        "تعذر تحميل نموذج YOLO للمراقبة. تحقق من اتصال الخادم بالإنترنت وأعد المحاولة بعد دقيقة. "
        "إذا استمر الخطأ، راجع سجلات الخادم (Render Logs)."
    )


def startup_log_lines(resolved_path: str) -> list[str]:
    models_dir = get_models_dir()
    lines = [
        f"YOLO models directory: {models_dir.as_posix()}",
        f"YOLO expected filenames (priority): {', '.join(PREFERRED_PPE_FILENAMES[:2])}",
        f"YOLO_MODEL_PATH env: {(settings.YOLO_MODEL_PATH or '').strip() or '(unset)'}",
        f"YOLO resolved path at startup: {resolved_path or '(none — runtime download on first analyze)'}",
        f"YOLO_AUTO_DOWNLOAD: {_parse_bool_env('YOLO_AUTO_DOWNLOAD', settings.is_production)}",
        "YOLO preload at startup: disabled",
    ]
    local_pts = sorted(p.name for p in models_dir.glob("*.pt") if p.is_file())
    lines.append(f"YOLO local .pt files: {local_pts or '(none)'}")
    return lines
