"""Build RTSP URLs and map monitoring zone rows for API responses."""

from __future__ import annotations

from datetime import datetime
from urllib.parse import quote

from app.constants.monitoring_zones import (
    CONNECTION_TYPE_IP,
    CONNECTION_TYPE_RTSP,
    MONITORING_ZONE_DEFAULTS,
    MONITORING_ZONE_IDS,
)
from app.models.monitoring_zone_config import MonitoringZoneConfig
from app.security.camera_security import assess_camera_stream_url
from app.security.stream_url import redact_stream_url_for_response
from app.security.stream_url_crypto import (
    decrypt_stream_url_from_storage,
    encrypt_stream_url_for_storage,
)


def resolve_branch_scope(branch_id: int | None) -> int:
    return int(branch_id) if branch_id is not None else 0


def normalize_port(raw: int | str | None) -> int:
    try:
        p = int(raw) if raw is not None else 554
    except (TypeError, ValueError):
        return 554
    return p if 1 <= p <= 65535 else 554


def build_rtsp_from_parts(
    *,
    ip_address: str | None,
    port: int,
    username: str | None,
    password: str | None,
    stream_path: str,
) -> str:
    host = (ip_address or "").strip()
    if not host:
        return ""
    path = (stream_path or "/stream1").strip()
    if not path.startswith("/"):
        path = f"/{path}"
    user = (username or "").strip()
    pwd = (password or "").strip()
    auth = ""
    if user or pwd:
        auth = f"{quote(user, safe='')}:{quote(pwd, safe='')}@"
    port_part = f":{port}" if port else ":554"
    return f"rtsp://{auth}{host}{port_part}{path}"


def effective_stream_url_plain(
    *,
    connection_type: str,
    ip_address: str | None,
    port: int,
    username: str | None,
    password_plain: str | None,
    stream_path: str,
    rtsp_url_plain: str | None,
    stored_stream_url: str | None = None,
) -> str | None:
    if connection_type == CONNECTION_TYPE_RTSP:
        plain = (rtsp_url_plain or "").strip()
        if plain:
            return plain
        if stored_stream_url:
            return decrypt_stream_url_from_storage(stored_stream_url)
        return None
    built = build_rtsp_from_parts(
        ip_address=ip_address,
        port=port,
        username=username,
        password=password_plain,
        stream_path=stream_path,
    )
    return built or None


def decrypt_password(stored: str | None) -> str | None:
    if not stored:
        return None
    return decrypt_stream_url_from_storage(stored)


def encrypt_secret(value: str | None) -> str | None:
    if not value or not str(value).strip():
        return None
    return encrypt_stream_url_for_storage(str(value).strip())


def zone_row_to_api_dict(row: MonitoringZoneConfig | None, zone_id: str) -> dict:
    defaults = MONITORING_ZONE_DEFAULTS.get(zone_id, {})
    display = defaults.get("display_name_ar", zone_id)

    if row is None:
        return {
            "zone_id": zone_id,
            "cam_code": defaults.get("cam_code", ""),
            "zone_ar": defaults.get("zone_ar", ""),
            "camera_name": display,
            "connection_type": CONNECTION_TYPE_IP,
            "ip_address": "",
            "port": 554,
            "username": "",
            "has_password": False,
            "stream_path": "/stream1",
            "rtsp_url": None,
            "stream_url": None,
            "linked_camera_id": None,
            "last_connection_test_at": None,
            "last_connection_test_ok": None,
            "saved_at": None,
            "updated_at": None,
            "security_status": "review",
            "security_status_ar": "يحتاج مراجعة",
            "security_warnings": ["لم يُضبط رابط البث بعد — استخدم IP محلي داخل شبكة المطعم."],
            "security_host_kind": "none",
        }

    pwd_plain = decrypt_password(row.password_encrypted)
    rtsp_plain = None
    if row.connection_type == CONNECTION_TYPE_RTSP and row.rtsp_url_encrypted:
        rtsp_plain = decrypt_stream_url_from_storage(row.rtsp_url_encrypted)

    eff = effective_stream_url_plain(
        connection_type=row.connection_type,
        ip_address=row.ip_address,
        port=row.port,
        username=row.username,
        password_plain=pwd_plain,
        stream_path=row.stream_path,
        rtsp_url_plain=rtsp_plain,
        stored_stream_url=row.stream_url,
    )

    sec = assess_camera_stream_url(eff, username=row.username, password=pwd_plain)
    sec_d = sec.to_dict()

    redacted_rtsp = redact_stream_url_for_response(rtsp_plain) if rtsp_plain else None
    redacted_stream = redact_stream_url_for_response(row.stream_url) if row.stream_url else None

    return {
        "zone_id": row.zone_id,
        "cam_code": defaults.get("cam_code", ""),
        "zone_ar": defaults.get("zone_ar", ""),
        "camera_name": row.camera_name,
        "connection_type": row.connection_type,
        "ip_address": row.ip_address or "",
        "port": row.port,
        "username": row.username or "",
        "has_password": bool(row.password_encrypted),
        "stream_path": row.stream_path,
        "rtsp_url": redacted_rtsp,
        "stream_url": redacted_stream,
        "linked_camera_id": row.linked_camera_id,
        "last_connection_test_at": row.last_connection_test_at,
        "last_connection_test_ok": row.last_connection_test_ok,
        "saved_at": row.updated_at,
        "updated_at": row.updated_at,
        **sec_d,
    }


def merge_zone_configs(rows: list[MonitoringZoneConfig]) -> list[dict]:
    by_zone = {r.zone_id: r for r in rows}
    return [zone_row_to_api_dict(by_zone.get(zid), zid) for zid in MONITORING_ZONE_IDS]


def apply_upsert_fields(
    row: MonitoringZoneConfig,
    *,
    camera_name: str,
    connection_type: str,
    ip_address: str | None,
    port: int,
    username: str | None,
    password_plain: str | None,
    clear_password: bool,
    stream_path: str,
    rtsp_url_plain: str | None,
    linked_camera_id: int | None,
    updated_by_id: int | None,
    now: datetime,
) -> None:
    row.camera_name = camera_name
    row.connection_type = connection_type
    row.ip_address = (ip_address or "").strip() or None
    row.port = normalize_port(port)
    row.username = (username or "").strip() or None
    row.stream_path = (stream_path or "/stream1").strip() or "/stream1"
    row.linked_camera_id = linked_camera_id
    row.updated_by_id = updated_by_id
    row.updated_at = now

    if clear_password:
        row.password_encrypted = None
    elif password_plain and str(password_plain).strip():
        row.password_encrypted = encrypt_secret(str(password_plain).strip())

    pwd = decrypt_password(row.password_encrypted)

    if connection_type == CONNECTION_TYPE_RTSP:
        plain_rtsp = (rtsp_url_plain or "").strip() or None
        row.rtsp_url_encrypted = encrypt_secret(plain_rtsp) if plain_rtsp else None
        eff = plain_rtsp
    else:
        row.rtsp_url_encrypted = None
        eff = build_rtsp_from_parts(
            ip_address=row.ip_address,
            port=row.port,
            username=row.username,
            password=pwd,
            stream_path=row.stream_path,
        )

    row.stream_url = encrypt_secret(eff) if eff else None
