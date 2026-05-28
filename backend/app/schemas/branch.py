"""Pydantic schemas for the Branch management API."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# ── Branch (admin CRUD) ──────────────────────────────────────────────────────


class BranchPublicOut(BaseModel):
    """Minimal public payload — used by the signup branch dropdown."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    branch_name: str
    city: str | None = None
    is_active: bool


class BranchOut(BranchPublicOut):
    """Full branch payload — admin only."""

    tenant_id: int
    created_at: datetime
    created_by_id: int | None = None
    created_by_name: str | None = None


class BranchCreate(BaseModel):
    branch_name: str = Field(min_length=2, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    is_active: bool = True


class BranchUpdate(BaseModel):
    branch_name: str | None = Field(default=None, min_length=2, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None


# ── Branch requests (public submit, admin approve/reject) ───────────────────


class BranchRequestCreate(BaseModel):
    branch_name: str = Field(min_length=2, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    reason: str | None = Field(default=None, max_length=2000)
    # Required when the submitter is not authenticated (public signup flow).
    requested_by_name: str | None = Field(default=None, max_length=255)
    requested_by_email: EmailStr | None = None


class BranchRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    branch_name: str
    city: str | None = None
    reason: str | None = None

    requested_by_id: int | None = None
    requested_by_name: str | None = None
    requested_by_email: str | None = None

    status: str
    review_note: str | None = None

    created_at: datetime
    reviewed_at: datetime | None = None
    reviewed_by_id: int | None = None
    reviewed_by_name: str | None = None
    branch_id: int | None = None


class BranchRequestDecision(BaseModel):
    status: Literal["approved", "rejected"]
    review_note: str | None = Field(default=None, max_length=2000)
    # Only used when approving: optional override (defaults to the requested name/city).
    branch_name: str | None = Field(default=None, min_length=2, max_length=255)
    city: str | None = Field(default=None, max_length=255)


class BranchRequestActionResponse(BaseModel):
    """Returned after admin approves/rejects a branch request."""

    ok: bool = True
    message: str
    request: BranchRequestOut
