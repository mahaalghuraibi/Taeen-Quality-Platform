from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

AgentSource = Literal["local_ai_agent"]


class LocalAgentViolation(BaseModel):
    """A single violation detected by the local agent for one frame."""

    camera_id: int | None = Field(default=None)
    branch_id: int | None = Field(default=None)
    zone_id: str | None = Field(default=None, max_length=32)
    camera_name: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    violation_type: str = Field(min_length=1, max_length=64)
    label_ar: str | None = Field(default=None, max_length=255)
    confidence: float = Field(ge=0, le=100)
    reason_ar: str | None = Field(default=None, max_length=1000)
    detected_at: datetime | None = Field(default=None)
    # Base64 string or data URL of the evidence snapshot.
    evidence_image: str | None = Field(default=None)
    source: AgentSource = "local_ai_agent"


class LocalAgentAlertBatch(BaseModel):
    """One POST may carry several violations from the same detection cycle."""

    branch_id: int | None = Field(default=None)
    agent_version: str | None = Field(default=None, max_length=32)
    violations: list[LocalAgentViolation] = Field(min_length=1, max_length=50)


class LocalAgentAlertResult(BaseModel):
    violation_type: str
    camera_id: int | None = None
    zone_id: str | None = None
    accepted: bool
    alert_id: int | None = None
    reason: str | None = None


class LocalAgentAlertResponse(BaseModel):
    ok: bool
    received: int
    created: int
    duplicates: int
    rejected: int
    results: list[LocalAgentAlertResult]


class LocalAgentPingResponse(BaseModel):
    ok: bool
    message: str
    server_time: datetime
