"""Permanent on-disk storage for dish documentation photos.

Files live under backend/media/dishes/ (configurable via DISH_MEDIA_DIR).
Public URLs: /api/v1/dishes/files/{uuid}.ext  and  /api/v1/media/dishes/{uuid}.ext
"""

from __future__ import annotations

import base64
import io
import re
import uuid
from pathlib import Path

from fastapi import HTTPException, status
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

from app.core.config import settings

_DATA_URL_RE = re.compile(r"^data:image/([\w+.-]+);base64,(.+)$", re.IGNORECASE | re.DOTALL)
_FILES_PUBLIC_PREFIX = "/api/v1/dishes/files/"
_MEDIA_PUBLIC_PREFIX = "/api/v1/media/dishes/"
_FILENAME_RE = re.compile(r"^[a-f0-9]{32}\.(png|jpg|jpeg|webp|gif)$", re.IGNORECASE)
_MAX_RAW_BYTES = 12_000_000


def dish_media_dir() -> Path:
    """Primary permanent storage: backend/media/dishes/"""
    d = settings.DISH_MEDIA_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def legacy_dish_media_dir() -> Path:
    """Old folder kept for one-time migration reads only."""
    backend_root = settings.DISH_MEDIA_DIR.parent.parent
    legacy = backend_root / "media" / "dish_images"
    return legacy


def extract_dish_filename(image_url: str) -> str | None:
    raw = (image_url or "").strip()
    for prefix in (_FILES_PUBLIC_PREFIX, _MEDIA_PUBLIC_PREFIX, "dishes/"):
        if raw.startswith(prefix):
            fname = raw[len(prefix) :].lstrip("/")
            if safe_dish_filename(fname):
                return fname
    if safe_dish_filename(raw):
        return raw
    return None


def dish_storage_relative_path(image_url: str) -> str | None:
    fname = extract_dish_filename(image_url)
    if not fname:
        return None
    return f"dishes/{fname}"


def resolve_dish_file_path(image_url: str) -> Path | None:
    """Resolve on-disk path; lazily copy from legacy dish_images/ if needed."""
    fname = extract_dish_filename(image_url)
    if not fname:
        return None
    primary = dish_media_dir() / fname
    if primary.is_file():
        return primary
    legacy = legacy_dish_media_dir() / fname
    if legacy.is_file():
        try:
            primary.write_bytes(legacy.read_bytes())
            return primary
        except OSError:
            return legacy
    return None


def dish_stored_file_exists(image_url: str) -> bool:
    raw = (image_url or "").strip()
    if not raw:
        return False
    if raw.startswith("data:image/"):
        return True
    return resolve_dish_file_path(raw) is not None


def materialize_dish_image_url(image_url: str) -> str:
    """
    Decode data:image/... URLs and persist under media/dishes/.
    Returns stable API path stored in dish_records.image_url.
    """
    raw = (image_url or "").strip()
    if not raw.startswith("data:image/"):
        return raw
    m = _DATA_URL_RE.match(raw)
    if not m:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="صورة الطبق غير صالحة (توقع data:image/...;base64,...).",
        )
    mime = m.group(1).lower()
    b64 = re.sub(r"\s+", "", m.group(2))
    try:
        data = base64.b64decode(b64, validate=True)
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="تعذر فك ترميز صورة الطبق.",
        ) from exc
    if len(data) > _MAX_RAW_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="صورة الطبق كبيرة جدًا. جرّب صورة أصغر أو أقل دقة.",
        )
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            pil_fmt = (im.format or "").upper()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ملف الصورة غير صالح أو تالف.",
        ) from exc

    if "png" in mime and pil_fmt == "PNG":
        ext = "png"
    elif "webp" in mime and pil_fmt == "WEBP":
        ext = "webp"
    elif "gif" in mime and pil_fmt == "GIF":
        ext = "gif"
    elif ("jpeg" in mime or mime == "jpg") and pil_fmt in ("JPEG", "MPO"):
        ext = "jpg"
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="نوع الصورة لا يطابق المحتوى. استخدم PNG أو JPEG أو WebP أو GIF.",
        )

    media_root = dish_media_dir()
    fname = f"{uuid.uuid4().hex}.{ext}"
    dest = media_root / fname
    dest.write_bytes(data)
    return f"{_FILES_PUBLIC_PREFIX}{fname}"


def try_delete_stored_dish_file(image_url: str) -> None:
    """Remove file when a dish record is deleted (does not touch unrelated files)."""
    path = resolve_dish_file_path(image_url)
    if path and path.is_file():
        try:
            path.unlink()
        except OSError:
            pass


def safe_dish_filename(filename: str) -> bool:
    return bool(_FILENAME_RE.match((filename or "").strip()))


def serve_dish_image_file(filename: str) -> FileResponse:
    """Safe read-only serve with long cache (UUID filenames are immutable)."""
    if not safe_dish_filename(filename):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    path = resolve_dish_file_path(f"{_FILES_PUBLIC_PREFIX}{filename}")
    if path is None or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    import mimetypes

    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


def migrate_legacy_dish_images_to_dishes() -> int:
    """Copy any files from media/dish_images/ → media/dishes/. Returns count copied."""
    legacy = legacy_dish_media_dir()
    if not legacy.is_dir():
        return 0
    dest_root = dish_media_dir()
    copied = 0
    for path in legacy.iterdir():
        if not path.is_file() or path.name.startswith("."):
            continue
        if not safe_dish_filename(path.name):
            continue
        target = dest_root / path.name
        if target.is_file():
            continue
        try:
            target.write_bytes(path.read_bytes())
            copied += 1
        except OSError:
            continue
    return copied
