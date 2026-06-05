"""Per-zone CCTV configuration persisted in PostgreSQL (replaces browser localStorage)."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MonitoringZoneConfig(Base):
    __tablename__ = "monitoring_zone_configs"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "branch_id",
            "zone_id",
            name="uq_monitoring_zone_configs_tenant_branch_zone",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    # 0 = tenant-wide default when user has no branch_id (admin); else supervisor branch.
    branch_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    zone_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    camera_name: Mapped[str] = mapped_column(String(255), nullable=False)
    connection_type: Mapped[str] = mapped_column(String(32), nullable=False, default="ip_camera")

    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    port: Mapped[int] = mapped_column(Integer, nullable=False, default=554)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    stream_path: Mapped[str] = mapped_column(String(255), nullable=False, default="/stream1")
    rtsp_url_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    stream_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    linked_camera_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True, index=True
    )

    last_connection_test_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_connection_test_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    updated_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
