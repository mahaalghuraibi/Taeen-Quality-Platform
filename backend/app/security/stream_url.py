"""Camera stream URL safety: redact credentials in API responses; validate writes."""

from __future__ import annotations

from urllib.parse import urlparse, urlunparse

from fastapi import HTTPException, status

from app.security.stream_url_crypto import decrypt_stream_url_from_storage, encrypt_stream_url_for_storage


def redact_stream_url_for_response(url: str | None) -> str | None:
    """
    Strip username/password from rtsp/rtsps URLs so API JSON does not echo credentials.
    Non-RTSP values are returned unchanged (e.g. placeholder labels).
    """
    if url is None:
        return None
    s = decrypt_stream_url_from_storage(str(url).strip()) or str(url).strip()
    if not s:
        return None
    lower = s.lower()
    if not (lower.startswith("rtsp://") or lower.startswith("rtsps://")):
        return s
    try:
        parsed = urlparse(s)
        if not parsed.hostname:
            return "rtsp://***:***@…"
        if parsed.username is None and parsed.password is None:
            return s
        host = parsed.hostname
        port = parsed.port
        netloc = f"{host}:{port}" if port else host
        userinfo = "***:***"
        new_netloc = f"{userinfo}@{netloc}"
        return urlunparse((parsed.scheme, new_netloc, parsed.path or "", parsed.params, parsed.query, parsed.fragment))
    except Exception:
        return "rtsp://***:***@…"


def validate_camera_stream_url(url: str | None, *, max_len: int = 500) -> str | None:
    """Reject control chars and obvious path traversal in stream URLs before DB storage."""
    if url is None:
        return None
    s = str(url).strip()
    if not s:
        return None
    if len(s) > max_len:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="رابط البث أطول من المسموح.",
        )
    if "\n" in s or "\r" in s or "\x00" in s:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="رابط البث يحتوي على أحرف غير مسموحة.",
        )
    lower = s.lower()
    if "://" in lower and ".." in s:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="مسار البث غير صالح.",
        )
    if lower.startswith("rtsp://") or lower.startswith("rtsps://"):
        try:
            p = urlparse(s)
            if not p.hostname:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="عنوان الخادم في رابط RTSP غير صالح.",
                )
            if p.port is not None and not (1 <= p.port <= 65535):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="منفذ رابط RTSP غير صالح.",
                )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="رابط RTSP غير صالح.",
            ) from exc
    return s


def prepare_stream_url_for_storage(url: str | None, *, max_len: int = 500) -> str | None:
    """Validate then encrypt for database storage (never log return value)."""
    validated = validate_camera_stream_url(url, max_len=max_len)
    return encrypt_stream_url_for_storage(validated)
