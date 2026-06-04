"""Camera / RTSP network security assessment for عين الجودة."""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from app.security.stream_url_crypto import decrypt_stream_url_from_storage

# Status codes (API + UI)
SECURITY_SAFE = "safe"
SECURITY_REVIEW = "review"
SECURITY_DANGER = "danger"

STATUS_AR = {
    SECURITY_SAFE: "آمن",
    SECURITY_REVIEW: "يحتاج مراجعة",
    SECURITY_DANGER: "خطر",
}

# Common factory / weak credentials — never log the actual password value.
_WEAK_PASSWORDS = frozenset(
    {
        "",
        "admin",
        "123456",
        "12345",
        "password",
        "1234",
        "123",
        "admin123",
        "888888",
        "666666",
        "000000",
        "111111",
        "root",
        "pass",
        "camera",
        "12345678",
        "user",
        "default",
        "administrator",
        "hikvision",
        "dahua",
        "123456789",
        "qwerty",
    }
)

_WEAK_USERNAMES = frozenset({"admin", "root", "user", "administrator", "default", ""})


@dataclass
class CameraSecurityAssessment:
    status: str = SECURITY_SAFE
    status_ar: str = STATUS_AR[SECURITY_SAFE]
    warnings: list[str] = field(default_factory=list)
    host_kind: str = "unknown"  # private | public | localhost | hostname | none

    def to_dict(self) -> dict[str, Any]:
        return {
            "security_status": self.status,
            "security_status_ar": self.status_ar,
            "security_warnings": list(self.warnings),
            "security_host_kind": self.host_kind,
        }


def _classify_host(hostname: str) -> tuple[str, bool]:
    """
    Returns (host_kind, is_private_or_local).
    is_private_or_local=True means acceptable for on-prem RTSP without VPN.
    """
    h = (hostname or "").strip().lower()
    if not h:
        return "none", True
    if h in ("localhost", "127.0.0.1", "::1"):
        return "localhost", True
    if h.endswith(".local"):
        return "hostname", True
    try:
        addr = ipaddress.ip_address(h)
        if addr.is_private or addr.is_loopback or addr.is_link_local:
            return "private", True
        return "public", False
    except ValueError:
        # DNS name — treat as needing review (may be DDNS / public host)
        return "hostname", False


def _extract_rtsp_credentials(url: str) -> tuple[str | None, str | None]:
    try:
        p = urlparse(url)
        user = p.username
        pwd = p.password
        return user, pwd
    except Exception:
        return None, None


def _password_is_weak(password: str | None, username: str | None = None) -> bool:
    if password is None:
        return False
    p = str(password)
    if p.lower() in _WEAK_PASSWORDS:
        return True
    if len(p) < 8:
        return True
    u = (username or "").strip().lower()
    if u in _WEAK_USERNAMES and p.lower() in _WEAK_PASSWORDS:
        return True
    return False


def assess_camera_stream_url(
    stream_url: str | None,
    *,
    username: str | None = None,
    password: str | None = None,
    from_storage: bool = False,
) -> CameraSecurityAssessment:
    """
    Evaluate RTSP/network exposure for a camera configuration.

    Parameters
    ----------
    stream_url:
        RTSP URL (optionally encrypted at rest if from_storage=True).
    username / password:
        Optional separate form fields (merged into assessment if URL lacks creds).
    from_storage:
        Decrypt Fernet-prefixed values before parsing.
    """
    result = CameraSecurityAssessment()

    raw = stream_url
    if from_storage and raw:
        raw = decrypt_stream_url_from_storage(raw)
    s = (raw or "").strip()
    if not s:
        result.warnings.append("لم يُضبط رابط البث بعد — يُفضّل استخدام عنوان IP محلي (192.168.x.x) داخل شبكة المطعم.")
        result.status = SECURITY_REVIEW
        result.status_ar = STATUS_AR[SECURITY_REVIEW]
        result.host_kind = "none"
        return result

    lower = s.lower()
    if lower.startswith("http://"):
        result.warnings.append("رابط HTTP غير مشفّر — يُمنع تعريض بث الكاميرا على الإنترنت العام.")
        _bump(result, SECURITY_DANGER)
    elif lower.startswith("https://"):
        result.warnings.append("بث HTTPS عبر الإنترنت العام يحتاج VPN أو وكيل محلي — راجع دليل أمان الكاميرات.")
        _bump(result, SECURITY_REVIEW)

    if not (lower.startswith("rtsp://") or lower.startswith("rtsps://")):
        result.warnings.append("نوع الرابط غير RTSP — تأكد أن الكاميرا داخل الشبكة المحلية فقط.")
        _bump(result, SECURITY_REVIEW)
        return _finalize(result)

    try:
        parsed = urlparse(s)
    except Exception:
        result.warnings.append("رابط RTSP غير صالح.")
        _bump(result, SECURITY_DANGER)
        return _finalize(result)

    host = parsed.hostname or ""
    host_kind, is_private = _classify_host(host)
    result.host_kind = host_kind

    if host_kind == "public":
        result.warnings.append(
            "عنوان IP عام مكشوف — يُمنع فتح منفذ RTSP (554) على الإنترنت. "
            "استخدم شبكة محلية (LAN/VLAN) أو VPN فقط."
        )
        _bump(result, SECURITY_DANGER)
    elif host_kind == "hostname":
        result.warnings.append(
            "اسم مضيف (DNS) قد يكون متاحاً من الإنترنت — يُفضّل عنوان IP محلي 192.168.x.x "
            "داخل شبكة المطعم."
        )
        _bump(result, SECURITY_REVIEW)
    elif host_kind == "localhost":
        result.warnings.append("عنوان localhost — للاختبار فقط، ليس للإنتاج في المطعم.")
        _bump(result, SECURITY_REVIEW)
    elif is_private:
        # Good baseline — still check credentials
        pass

    url_user, url_pass = _extract_rtsp_credentials(s)
    eff_user = url_user if url_user is not None else username
    eff_pass = url_pass if url_pass is not None else password

    if eff_pass is not None and _password_is_weak(eff_pass, eff_user):
        result.warnings.append(
            "كلمة مرور الكاميرا ضعيفة أو افتراضية — غيّرها فوراً ولا تستخدم admin/123456."
        )
        _bump(result, SECURITY_DANGER)

    if eff_user and str(eff_user).lower() in _WEAK_USERNAMES:
        result.warnings.append("اسم مستخدم افتراضي للكاميرا — غيّر اسم المستخدم عن admin/root.")
        _bump(result, SECURITY_REVIEW)

    if lower.startswith("rtsp://") and not lower.startswith("rtsps://") and is_private:
        result.warnings.append(
            "RTSP غير مشفّر داخل LAN مقبول — تأكد من حظر المنفذ 554 من الجدار الناري الخارجي."
        )

    # Obvious port-forward / DDNS patterns in path or host
    if re.search(r"ddns|no-ip|duckdns|myfritz|synology", host, re.I):
        result.warnings.append("يبدو أن الرابط يستخدم DDNS عاماً — يُنصح بـ VPN بدلاً من تعريض RTSP.")
        _bump(result, SECURITY_DANGER)

    return _finalize(result)


def _bump(result: CameraSecurityAssessment, level: str) -> None:
    order = {SECURITY_SAFE: 0, SECURITY_REVIEW: 1, SECURITY_DANGER: 2}
    if order.get(level, 0) > order.get(result.status, 0):
        result.status = level
        result.status_ar = STATUS_AR[level]


def _finalize(result: CameraSecurityAssessment) -> CameraSecurityAssessment:
    if not result.warnings and result.status == SECURITY_SAFE:
        result.warnings.append("الإعداد يتبع الشبكة المحلية — حافظ على حظر RTSP من الإنترنت العام.")
    return result


def assess_stored_camera(camera) -> CameraSecurityAssessment:
    """Assess a Camera ORM row (stream_url may be encrypted)."""
    return assess_camera_stream_url(camera.stream_url, from_storage=True)
