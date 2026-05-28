"""Branch (restaurant location) — master list managed by admin.

Notes
-----
- Replaces the hardcoded `branch_id` integers (1/2/3) on the signup page.
- `User.branch_id` / `DishRecord.branch_id` / `MonitoringAlert.branch_id` remain
  plain integers (not FKs) so existing rows are preserved during rollout; the
  Branch table is the **source of truth** going forward and the admin API
  enforces referential integrity application-side.
- `is_active=False` hides a branch from signup without deleting historical data.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id"), nullable=False, index=True, default=1
    )
    branch_name: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    city: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    created_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
