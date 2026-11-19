from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class QualityFormSession(Base):
    __tablename__ = "quality_form_sessions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "meal_date", "meal_period", name="uq_session_branch_date_period"),
        CheckConstraint("meal_period IN ('breakfast', 'lunch', 'dinner')", name="ck_meal_period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    branch_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    branch_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    meal_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    meal_period: Mapped[str] = mapped_column(String(20), nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    stages: Mapped[list[QualityFormStageSubmission]] = relationship(
        "QualityFormStageSubmission",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="QualityFormStageSubmission.stage_number",
    )


class QualityFormStageSubmission(Base):
    __tablename__ = "quality_form_stage_submissions"
    __table_args__ = (
        UniqueConstraint("session_id", "stage_number", name="uq_stage_per_session"),
        CheckConstraint("stage_number >= 1 AND stage_number <= 5", name="ck_stage_number_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("quality_form_sessions.id"), nullable=False, index=True
    )
    stage_number: Mapped[int] = mapped_column(Integer, nullable=False)
    stage_name_ar: Mapped[str] = mapped_column(String(100), nullable=False)
    submitted_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    submitted_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    answers: Mapped[str] = mapped_column(Text, nullable=False)
    measurements: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    session: Mapped[QualityFormSession] = relationship(
        "QualityFormSession", back_populates="stages"
    )
