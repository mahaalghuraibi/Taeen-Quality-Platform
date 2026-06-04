from pydantic import BaseModel, ConfigDict, Field, field_serializer
from typing import Literal

from app.security.stream_url import redact_stream_url_for_response

SecurityStatus = Literal["safe", "review", "danger"]


class CameraCreate(BaseModel):
    name: str
    location: str
    stream_url: str | None = None
    is_active: bool = True
    tenant_id: int


class CameraOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    location: str
    stream_url: str | None
    is_active: bool
    tenant_id: int
    security_status: SecurityStatus = "safe"
    security_status_ar: str = "آمن"
    security_warnings: list[str] = Field(default_factory=list)

    @field_serializer("stream_url")
    @classmethod
    def _redact_stream_url(cls, v: str | None) -> str | None:
        return redact_stream_url_for_response(v)

    @classmethod
    def from_camera(cls, camera) -> "CameraOut":
        from app.security.camera_security import assess_stored_camera

        sec = assess_stored_camera(camera).to_dict()
        return cls(
            id=camera.id,
            name=camera.name,
            location=camera.location,
            stream_url=camera.stream_url,
            is_active=camera.is_active,
            tenant_id=camera.tenant_id,
            security_status=sec["security_status"],
            security_status_ar=sec["security_status_ar"],
            security_warnings=sec["security_warnings"],
        )
