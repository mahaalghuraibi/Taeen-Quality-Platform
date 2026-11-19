from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


class StageDefinitionOut(BaseModel):
    stage_number: int
    name_ar: str
    questions: list[dict[str, Any]] = Field(default_factory=list)


class SessionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    meal_date: date
    meal_period: Literal["breakfast", "lunch", "dinner"]
    # Admin only: specify a branch other than their own.
    # Supervisors: this field is always ignored — branch comes from the server-side user record.
    branch_id: int | None = Field(default=None, gt=0)


class StageSubmitPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    answers: dict[str, Any] = Field(default_factory=dict)
    measurements: dict[str, Any] | None = None
    notes: str | None = Field(default=None, max_length=2000)


class StageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    stage_number: int
    stage_name_ar: str
    submitted_by_name: str | None = None
    submitted_at: datetime
    answers: dict[str, Any] = Field(default_factory=dict)
    measurements: dict[str, Any] | None = None
    notes: str | None = None

    @field_serializer("submitted_at", when_used="json")
    def serialize_submitted_at(self, v: datetime) -> str:
        aware = v if v.tzinfo is not None else v.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @field_validator("answers", mode="before")
    @classmethod
    def parse_answers(cls, v: Any) -> dict[str, Any]:
        if isinstance(v, str):
            try:
                return json.loads(v) if v.strip() else {}
            except Exception:
                return {}
        return v or {}

    @field_validator("measurements", mode="before")
    @classmethod
    def parse_measurements(cls, v: Any) -> dict[str, Any] | None:
        if v is None:
            return None
        if isinstance(v, str):
            try:
                return json.loads(v) if v.strip() else None
            except Exception:
                return None
        return v


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tenant_id: int
    branch_id: int
    branch_name: str | None = None
    meal_date: date
    meal_period: str
    created_by_name: str | None = None
    created_at: datetime
    is_complete: bool
    completed_at: datetime | None = None
    stages: list[StageOut] = Field(default_factory=list)
    submitted_stage_numbers: list[int] = Field(default_factory=list)

    @field_serializer("created_at", when_used="json")
    def serialize_created_at(self, v: datetime) -> str:
        aware = v if v.tzinfo is not None else v.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @field_serializer("completed_at", when_used="json")
    def serialize_completed_at(self, v: datetime | None) -> str | None:
        if v is None:
            return None
        aware = v if v.tzinfo is not None else v.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
