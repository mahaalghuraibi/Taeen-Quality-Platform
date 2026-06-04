"""Encrypt camera RTSP URLs at rest (Fernet). Credentials never appear in API JSON."""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

logger = logging.getLogger(__name__)

_ENC_PREFIX = "enc:v1:"


def _fernet() -> Fernet | None:
    secret = (settings.SECRET_KEY or "").strip()
    if not secret or secret == "change-me":
        # Dev fallback — still encrypt locally; production MUST set SECRET_KEY.
        secret = "ska-dev-camera-encryption-fallback-change-in-production"
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    try:
        return Fernet(key)
    except Exception:
        logger.exception("camera stream_url Fernet init failed")
        return None


def encrypt_stream_url_for_storage(url: str | None) -> str | None:
    if url is None:
        return None
    s = str(url).strip()
    if not s:
        return None
    if s.startswith(_ENC_PREFIX):
        return s
    f = _fernet()
    if f is None:
        return s
    token = f.encrypt(s.encode("utf-8")).decode("ascii")
    return f"{_ENC_PREFIX}{token}"


def decrypt_stream_url_from_storage(value: str | None) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if not s.startswith(_ENC_PREFIX):
        return s
    f = _fernet()
    if f is None:
        return None
    try:
        return f.decrypt(s[len(_ENC_PREFIX) :].encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.warning("camera stream_url decrypt failed (wrong SECRET_KEY or corrupt row)")
        return None
    except Exception:
        logger.exception("camera stream_url decrypt error")
        return None
