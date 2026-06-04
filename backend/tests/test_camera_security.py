"""Unit tests for camera RTSP security assessment."""

from app.security.camera_security import (
    SECURITY_DANGER,
    SECURITY_REVIEW,
    SECURITY_SAFE,
    assess_camera_stream_url,
)
from app.security.stream_url_crypto import decrypt_stream_url_from_storage, encrypt_stream_url_for_storage


def test_private_rtsp_is_safe_or_review():
    r = assess_camera_stream_url("rtsp://admin:StrongPass9!@192.168.1.50:554/stream1")
    assert r.status in (SECURITY_SAFE, SECURITY_REVIEW)
    assert r.status != SECURITY_DANGER


def test_public_ip_is_danger():
    r = assess_camera_stream_url("rtsp://admin:admin@203.0.113.10:554/live")
    assert r.status == SECURITY_DANGER
    assert any("عام" in w or "554" in w for w in r.warnings)


def test_weak_password_is_danger():
    r = assess_camera_stream_url("rtsp://admin:123456@192.168.1.10:554/stream1")
    assert r.status == SECURITY_DANGER


def test_empty_url_is_review():
    r = assess_camera_stream_url(None)
    assert r.status == SECURITY_REVIEW


def test_encrypt_roundtrip():
    plain = "rtsp://user:secret@192.168.0.5:554/h264"
    enc = encrypt_stream_url_for_storage(plain)
    assert enc.startswith("enc:v1:")
    assert decrypt_stream_url_from_storage(enc) == plain


def test_assess_from_storage_encrypted():
    plain = "rtsp://admin:123456@192.168.1.20:554/1"
    enc = encrypt_stream_url_for_storage(plain)
    r = assess_camera_stream_url(enc, from_storage=True)
    assert r.status == SECURITY_DANGER
