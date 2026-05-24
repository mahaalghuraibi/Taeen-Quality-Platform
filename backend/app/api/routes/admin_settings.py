"""
Tenant-scoped admin settings persisted in PostgreSQL (`system_settings` table).

Replaces the previous placeholder + browser-localStorage flow. Frontend can:
  GET  /api/v1/admin/settings           → all key/value pairs for the tenant
  PUT  /api/v1/admin/settings           → upsert {key: value, ...}
  DELETE /api/v1/admin/settings/{key}   → remove a setting

Values are stored as JSON-encoded strings so the frontend can round-trip
nested objects (e.g. ai.violations) without schema migrations.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.db.session import get_db
from app.models.system_setting import SystemSetting
from app.models.user import User

router = APIRouter(
    prefix="/admin/settings",
    tags=["admin-settings"],
    dependencies=[Depends(require_roles("admin"))],
)


def _decode_value(raw: str) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return raw


@router.get("")
def get_admin_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    rows = (
        db.query(SystemSetting)
        .filter(SystemSetting.tenant_id == current_user.tenant_id)
        .all()
    )
    settings_map: dict[str, Any] = {row.key: _decode_value(row.value) for row in rows}
    return {
        "tenant_id": current_user.tenant_id,
        "settings": settings_map,
        "count": len(settings_map),
    }


@router.put("")
def upsert_admin_settings(
    payload: dict[str, Any] = Body(..., embed=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not isinstance(payload, dict) or not payload:
        raise HTTPException(status_code=400, detail="الحمولة فارغة أو غير صالحة")

    now = datetime.utcnow()
    written = 0
    for key, value in payload.items():
        clean_key = str(key).strip()[:128]
        if not clean_key:
            continue
        encoded = json.dumps(value, ensure_ascii=False)
        row = (
            db.query(SystemSetting)
            .filter(
                SystemSetting.tenant_id == current_user.tenant_id,
                SystemSetting.key == clean_key,
            )
            .first()
        )
        if row is None:
            row = SystemSetting(
                tenant_id=current_user.tenant_id,
                key=clean_key,
                value=encoded,
                created_by_id=current_user.id,
                updated_by_id=current_user.id,
                created_at=now,
                updated_at=now,
            )
        else:
            row.value = encoded
            row.updated_by_id = current_user.id
            row.updated_at = now
        db.add(row)
        written += 1

    db.commit()
    return {"ok": True, "written": written, "tenant_id": current_user.tenant_id}


@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    row = (
        db.query(SystemSetting)
        .filter(
            SystemSetting.tenant_id == current_user.tenant_id,
            SystemSetting.key == key,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="الإعداد غير موجود")
    db.delete(row)
    db.commit()
