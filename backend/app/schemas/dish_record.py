from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator


class DishSuggestionItem(BaseModel):
    name: str
    confidence: float = Field(ge=0.0, le=1.0, description="0–1 probability; values >1 are treated as percent/100.")
    reason: str = ""

    @field_validator("confidence", mode="before")
    @classmethod
    def normalize_confidence(cls, v: object) -> float:
        """Accept 0.615 or 61.5 (percent) from models; always store 0–1."""
        if v is None:
            return 0.0
        try:
            n = float(v)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 0.0
        if n > 1.0 and n <= 100.0:
            return max(0.0, min(1.0, n / 100.0))
        if n > 100.0:
            return 1.0
        return max(0.0, min(1.0, n))


# Base64 data URLs for dish photos; cap size for SQLite/API stability (~4–5 MB image as string).
_MAX_DISH_IMAGE_URL_LEN = 6_000_000


class DishRecordCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    # Send image in `image_url` and/or `image_data_url` (e.g. split payload).
    image_url: str = Field(..., min_length=1, max_length=_MAX_DISH_IMAGE_URL_LEN)
    image_data_url: str | None = Field(None, max_length=_MAX_DISH_IMAGE_URL_LEN)
    predicted_label: str = Field(..., min_length=1, max_length=255)
    confirmed_label: str | None = Field(None, max_length=255)
    quantity: int = Field(default=1, ge=1)
    source_entity: str = Field(..., min_length=1, max_length=100)
    ai_suggestions: list[DishSuggestionItem] | None = None
    ai_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    needs_review: bool | None = None
    # Optional; server fills from current instant if omitted (see dishes route).
    recorded_at: datetime | None = Field(default=None, description="Omit or null to let server set time.")
    employee_id: int | None = None
    employee_name: str | None = None
    employee_email: str | None = None
    branch_id: int | None = None
    branch_name: str | None = None
    user_id: int | None = None
    tenant_id: int | None = None

    @model_validator(mode="before")
    @classmethod
    def merge_image_url_sources(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        url = str(d.get("image_url") or "").strip()
        alt = str(d.get("image_data_url") or "").strip()
        chosen = alt if alt else url
        if not chosen:
            raise ValueError("يرجى إرسال صورة الطبق في image_url أو image_data_url.")
        d["image_url"] = chosen
        d.pop("image_data_url", None)
        return d

    @field_validator("recorded_at", mode="before")
    @classmethod
    def empty_recorded_at(cls, v: object) -> datetime | None:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v  # type: ignore[return-value]

    @field_validator("confirmed_label", mode="before")
    @classmethod
    def empty_confirmed_to_none(cls, v: object) -> str | None:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v  # type: ignore[return-value]

    @field_validator("quantity", mode="before")
    @classmethod
    def coerce_quantity(cls, v: object) -> int:
        """Accept JSON floats/strings from forms (e.g. 1.0) and coerce to int ≥ 1."""
        if v is None:
            return 1
        if isinstance(v, bool):
            raise ValueError("quantity must be a number")
        try:
            n = int(float(v))
        except (TypeError, ValueError):
            raise ValueError("quantity must be a positive integer")
        return max(1, n)


class DishRecordUpdate(BaseModel):
    """Partial update for a dish record (staff/supervisor/admin within tenant)."""

    model_config = ConfigDict(str_strip_whitespace=True)

    confirmed_label: str | None = Field(None, max_length=255)
    quantity: int | None = Field(None, ge=1)
    source_entity: str | None = Field(None, min_length=1, max_length=100)
    supervisor_notes: str | None = Field(None, max_length=2000)

    @field_validator("confirmed_label", mode="before")
    @classmethod
    def strip_confirmed(cls, v: object) -> str | None:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v  # type: ignore[return-value]

    @field_validator("quantity", mode="before")
    @classmethod
    def coerce_quantity_optional(cls, v: object) -> int | None:
        if v is None:
            return None
        if isinstance(v, bool):
            raise ValueError("quantity must be a number")
        try:
            n = int(float(v))
        except (TypeError, ValueError):
            raise ValueError("quantity must be a positive integer")
        return max(1, n)


class DishRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    image_url: str
    # False when image_url points at /api/v1/dishes/files/... but the file is missing on disk.
    image_available: bool = True
    # On-disk path relative to backend/media/, e.g. dishes/{uuid}.jpg
    storage_path: str | None = None
    predicted_label: str
    confirmed_label: str | None
    quantity: int
    source_entity: str
    recorded_at: datetime
    needs_review: bool
    status: str
    reviewed_by_id: int | None = None
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    rejected_reason: str | None = None
    supervisor_notes: str | None = None
    ai_suggestions: list[DishSuggestionItem] = Field(default_factory=list)
    ai_confidence: float | None = None
    employee_name: str | None = None
    employee_email: str | None = None
    employee_id: int | None = None
    branch_id: int | None = None
    branch_name: str | None = None
    user_id: int
    tenant_id: int

    @field_serializer("recorded_at", when_used="json")
    def serialize_recorded_at_iso(self, v: datetime) -> str:
        """UTC instant as ISO-8601 with Z for consistent client parsing."""
        aware = v if v.tzinfo is not None else v.replace(tzinfo=timezone.utc)
        utc = aware.astimezone(timezone.utc)
        return utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @field_serializer("reviewed_at", when_used="json")
    def serialize_reviewed_at_iso(self, v: datetime | None) -> str | None:
        if v is None:
            return None
        aware = v if v.tzinfo is not None else v.replace(tzinfo=timezone.utc)
        utc = aware.astimezone(timezone.utc)
        return utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @field_validator("ai_suggestions", mode="before")
    @classmethod
    def parse_ai_suggestions(cls, v: object) -> list[DishSuggestionItem]:
        if v is None:
            return []
        if isinstance(v, list):
            return v  # type: ignore[return-value]
        if isinstance(v, str):
            import json

            s = v.strip()
            if not s:
                return []
            try:
                raw = json.loads(s)
            except Exception:
                return []
            if isinstance(raw, list):
                return raw  # type: ignore[return-value]
        return []


class DishDetectResponse(BaseModel):
    detected: str
    alternatives: list[str]
    confidence: float | None = None
    provider: str


class SupervisorRejectPayload(BaseModel):
    reason: str = Field(..., min_length=2, max_length=2000)
    supervisor_notes: str | None = Field(default=None, max_length=2000)


class SupervisorEditApprovePayload(BaseModel):
    dish_name: str = Field(..., min_length=1, max_length=255)
    quantity: int = Field(default=1, ge=1)
    source: str = Field(..., min_length=1, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)


class DetectDishResponse(BaseModel):
    dish_name: str
    dish_name_ar: str | None = None
    confidence: float
    suggestions: list[DishSuggestionItem] = Field(
        default_factory=list,
        description="Top 3 dish names sorted by confidence (highest first).",
    )
    labels: list[str] = []
    detected_classes: list[str] = []
    suggestion_reason: str = ""
    suggested_name: str | None = None
    suggested_options: list[str] = []
    experimental: bool = False
    protein_type: str = "unknown"
    visual_reason: str = ""
    needs_review: bool = Field(
        default=False,
        description="True when top confidence is below ~45% or protein conflict among suggestions.",
    )
    protein_conflict: bool = Field(
        default=False,
        description="Conflicting protein signals (e.g. fish + meat or fish + chicken) in top suggestions.",
    )
    vision_model: str | None = None
