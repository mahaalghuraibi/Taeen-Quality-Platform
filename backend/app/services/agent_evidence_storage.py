"""On-disk storage for evidence snapshots pushed by the local AI agent.

Files live under backend/media/agent_evidence/ (configurable via AGENT_EVIDENCE_DIR).
Public URL: /api/v1/media/agent-evidence/{uuid}.ext
"""

from __future__ import annotations

import base64
import binascii
import io
import re
import uuid
from pathlib import Path

from fastapi import HTTPException, status
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

from app.core.config import settings

_DATA_URL_RE = re.compile(r"^data:image/([\w+.-]+);base64,(.+)$", re.IGNORECASE | re.DOTALL)
_PUBLIC_PREFIX = "/api/v1/media/agent-evidence/"
_FILENAME_RE = re.compile(r"^[a-f0-9]{32}\.(png|jpg|jpeg|webp)$", re.IGNORECASE)
_EXT_BY_FORMAT = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


def agent_evidence_dir() -> Path:
    d = settings.AGENT_EVIDENCE_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def safe_evidence_filename(name: str) -> bool:
    return bool(_FILENAME_RE.match((name or "").strip()))


def _decode_evidence(raw: str) -> bytes:
    """Accept a data URL or a bare base64 string; return decoded image bytes."""
    s = (raw or "").strip()
    if not s:
        raise HTTPException(status_code=400, detail="صورة الدليل مفقودة.")
    m = _DATA_URL_RE.match(s)
    b64 = m.group(2) if m else s
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="ترميز صورة الدليل غير صالح.") from exc
    max_b = int(getattr(settings, "AGENT_EVIDENCE_MAX_BYTES", 6 * 1024 * 1024) or 6 * 1024 * 1024)
    if len(data) > max_b:
        raise HTTPException(status_code=413, detail="حجم صورة الدليل يتجاوز الحد المسموح.")
    return data


def store_agent_evidence(raw: str | None) -> str | None:
    """Persist an evidence image and return its public URL, or None if no image supplied.

    Re-encodes through Pillow to strip metadata and guarantee a valid image.
    """
    if not raw or not str(raw).strip():
        return None
    data = _decode_evidence(str(raw))
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="صورة الدليل غير صالحة.") from exc

    fmt = (img.format or "JPEG").upper()
    if fmt not in _EXT_BY_FORMAT:
        fmt = "JPEG"
    ext = _EXT_BY_FORMAT[fmt]
    if fmt == "JPEG" and img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    fname = f"{uuid.uuid4().hex}.{ext}"
    dest = agent_evidence_dir() / fname
    save_kwargs: dict = {}
    if fmt == "JPEG":
        save_kwargs = {"quality": 85, "optimize": True}
    img.save(dest, format=fmt, **save_kwargs)
    return f"{_PUBLIC_PREFIX}{fname}"


def serve_agent_evidence_file(filename: str) -> FileResponse:
    if not safe_evidence_filename(filename):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="غير موجود")
    path = agent_evidence_dir() / filename
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="غير موجود")
    return FileResponse(path)
