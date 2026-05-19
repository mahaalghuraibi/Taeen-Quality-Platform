from typing import Any

from pydantic import BaseModel, Field


class MonitoringCheckOut(BaseModel):
    key: str
    label_ar: str
    status: str
    status_ar: str
    confidence: int = Field(ge=0, le=100)
    reason_ar: str


class MonitoringViolationOut(BaseModel):
    type: str
    label_ar: str
    confidence: int = Field(ge=0, le=100)
    reason_ar: str
    description: str = ""
    status: str = "new"
    person_index: int | None = None
    alias_of: str | None = None
    severity: str = "medium"        # low | medium | high
    category: str = "PPE"           # PPE | hygiene | waste | cleanliness | staff_behavior | food_safety
    suggested_action: str = ""


class MonitoringAnalyzeResponse(BaseModel):
    ok: bool = True
    status: str = "ok"
    provider: str
    camera_name: str | None = None
    location: str | None = None
    people_count: int = Field(ge=0, default=0)
    overall_confidence: int = Field(ge=0, le=100, default=0)
    needs_review: bool = False
    checks: list[MonitoringCheckOut]
    violations: list[MonitoringViolationOut]
    alerts_created: int = Field(default=0, ge=0)
    summary: str = ""
    frame_report: dict[str, Any] | None = None
    quality_pct: int = Field(ge=0, le=100, default=100)
    violation_count: int = Field(ge=0, default=0)
    overall_status: str = "clean"   # clean | warning | critical
