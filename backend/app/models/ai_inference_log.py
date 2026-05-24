"""
Persistent log of AI inference outcomes for monthly accuracy reports.

Complements the in-memory `ai_health_service` (which holds rolling FPS/latency)
by writing a durable row whenever a confirmed monitoring alert is created or
when AI returns a meaningful detection. Used by:
  - monthly accuracy reports (precision / recall vs supervisor feedback)
  - dataset drift detection (avg confidence per class over time)
  - retraining feedback loop (which frames produced low/false confirmations)

Heavy by design: write once per *confirmed* event, not once per frame, to
keep PostgreSQL volume bounded.
"""
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AIInferenceLog(Base):
    __tablename__ = "ai_inference_logs"
    __table_args__ = (
        Index("ix_ai_inf_tenant_created", "tenant_id", "created_at"),
        Index("ix_ai_inf_vtype_created", "violation_type", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    branch_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    camera_id: Mapped[int | None] = mapped_column(ForeignKey("cameras.id"), nullable=True)
    camera_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(96), nullable=True, index=True)
    model_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    violation_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    person_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    smoothed_confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    inference_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    priority: Mapped[str | None] = mapped_column(String(16), nullable=True)
    outcome: Mapped[str] = mapped_column(String(32), nullable=False, default="confirmed")
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("monitoring_alerts.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, index=True)
