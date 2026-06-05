from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.supervisor_camera import SecurityStatus

ConnectionType = Literal["ip_camera", "rtsp_url"]


class MonitoringZoneConfigUpsert(BaseModel):
    camera_name: str = Field(min_length=1, max_length=255)
    connection_type: ConnectionType = "ip_camera"
    ip_address: str | None = Field(default=None, max_length=64)
    port: int = Field(default=554, ge=1, le=65535)
    username: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, max_length=255)
    clear_password: bool = False
    stream_path: str = Field(default="/stream1", max_length=255)
    rtsp_url: str | None = Field(default=None, max_length=500)
    linked_camera_id: int | None = None


class MonitoringZoneConnectionTest(BaseModel):
    ok: bool
    tested_at: datetime | None = None


class MonitoringZoneConfigOut(BaseModel):
    zone_id: str
    cam_code: str = ""
    zone_ar: str = ""
    camera_name: str
    connection_type: ConnectionType
    ip_address: str = ""
    port: int = 554
    username: str = ""
    has_password: bool = False
    stream_path: str = "/stream1"
    rtsp_url: str | None = None
    stream_url: str | None = None
    linked_camera_id: int | None = None
    last_connection_test_at: datetime | None = None
    last_connection_test_ok: bool | None = None
    saved_at: datetime | None = None
    updated_at: datetime | None = None
    security_status: SecurityStatus = "review"
    security_status_ar: str = "يحتاج مراجعة"
    security_warnings: list[str] = Field(default_factory=list)
    security_host_kind: str = "unknown"


class MonitoringZoneConfigListOut(BaseModel):
    branch_id: int
    tenant_id: int
    zones: list[MonitoringZoneConfigOut]


class LegacyZoneImportItem(BaseModel):
    camera_name: str | None = None
    ip_address: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None
    password_enc: str | None = None
    stream_path: str | None = None
    connection_type: ConnectionType | None = None
    rtsp_url: str | None = None


class LegacyZoneImportIn(BaseModel):
    configs: dict[str, LegacyZoneImportItem] = Field(default_factory=dict)
