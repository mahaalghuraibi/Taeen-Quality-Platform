from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.db.session import get_db
from app.models.dish_record import DishRecord
from app.models.user import User
from app.schemas.dish_record import DishRecordOut, SupervisorEditApprovePayload, SupervisorRejectPayload
from app.services.dish_record_serialize import dish_record_to_out, dish_records_to_out

router = APIRouter(
    prefix="/supervisor/reviews",
    tags=["supervisor-reviews"],
    dependencies=[Depends(require_roles("supervisor", "admin"))],
)
logger = logging.getLogger(__name__)


def _ensure_supervisor_branch(current_user: User) -> None:
    if current_user.role == "supervisor" and current_user.branch_id is None:
        raise HTTPException(status_code=400, detail="لم يتم تحديد الفرع لهذا الحساب")


def _q_for_tenant(db: Session, current_user: User):
    q = db.query(DishRecord).filter(DishRecord.tenant_id == current_user.tenant_id)
    if current_user.role == "supervisor":
        return q.filter(DishRecord.branch_id == current_user.branch_id)
    return q


def _get_or_404(db: Session, dish_id: int, current_user: User) -> DishRecord:
    dish = _q_for_tenant(db, current_user).filter(DishRecord.id == dish_id).first()
    if dish is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="السجل غير موجود.")
    return dish


@router.get("", response_model=list[DishRecordOut])
def list_review_records(
    employee: str | None = Query(default=None),
    dish_type: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    confidence_min: float | None = Query(default=None, ge=0, le=100),
    confidence_max: float | None = Query(default=None, ge=0, le=100),
    status_filter: str = Query(default="pending_review"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DishRecordOut]:
    _ensure_supervisor_branch(current_user)
    q = _q_for_tenant(db, current_user)
    if status_filter and status_filter != "all":
        if status_filter == "needs_review":
            q = q.filter(
                or_(
                    DishRecord.needs_review.is_(True),
                    DishRecord.status.in_(["needs_review", "pending_review"]),
                    DishRecord.ai_confidence < 0.75,
                )
            )
        else:
            q = q.filter(DishRecord.status == status_filter)
    if dish_type:
        key = dish_type.strip()
        if key:
            q = q.filter(DishRecord.confirmed_label.ilike(f"%{key}%"))
    if date_from is not None:
        q = q.filter(DishRecord.recorded_at >= date_from.replace(tzinfo=None))
    if date_to is not None:
        q = q.filter(DishRecord.recorded_at <= date_to.replace(tzinfo=None))
    if confidence_min is not None:
        q = q.filter((DishRecord.ai_confidence * 100.0) >= confidence_min)
    if confidence_max is not None:
        q = q.filter((DishRecord.ai_confidence * 100.0) <= confidence_max)

    rows = q.order_by(DishRecord.recorded_at.desc()).all()
    user_ids = {r.user_id for r in rows}
    users = db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else []
    user_map = {u.id: u for u in users}
    for r in rows:
        u = user_map.get(r.user_id)
        if u is not None:
            r.employee_name = u.full_name or u.username or u.email
            r.employee_email = u.email

    if not employee:
        return dish_records_to_out(rows)
    key = employee.strip().lower()
    if not key:
        return dish_records_to_out(rows)
    out: list[DishRecord] = []
    for r in rows:
        u = user_map.get(r.user_id)
        if u is None:
            continue
        if key in (u.email or "").lower() or key in (u.full_name or "").lower() or key in (u.username or "").lower():
            out.append(r)
    return dish_records_to_out(out)


@router.patch("/{dish_id}/approve", response_model=DishRecordOut)
def approve_review_record(
    dish_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DishRecordOut:
    _ensure_supervisor_branch(current_user)
    dish = _get_or_404(db, dish_id, current_user)
    old_status = dish.status
    old_needs_review = bool(dish.needs_review)
    dish.needs_review = False
    dish.status = "approved"
    dish.reviewed_by_id = current_user.id
    dish.reviewed_by_name = current_user.full_name or current_user.username or current_user.email
    dish.reviewed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    dish.rejected_reason = None
    db.add(dish)
    db.commit()
    db.refresh(dish)
    logger.warning(
        "supervisor_review approve dish_id=%s old_status=%s new_status=%s needs_review=%s",
        dish.id,
        old_status,
        dish.status,
        dish.needs_review,
    )
    if old_status == dish.status and old_needs_review == bool(dish.needs_review):
        logger.warning("supervisor_review approve no-state-change dish_id=%s", dish.id)
    return dish_record_to_out(dish)


@router.patch("/{dish_id}/reject", response_model=DishRecordOut)
def reject_review_record(
    dish_id: int,
    payload: SupervisorRejectPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DishRecordOut:
    _ensure_supervisor_branch(current_user)
    dish = _get_or_404(db, dish_id, current_user)
    old_status = dish.status
    old_needs_review = bool(dish.needs_review)
    dish.needs_review = False
    dish.status = "rejected"
    dish.rejected_reason = payload.reason.strip()
    if payload.supervisor_notes is not None:
        dish.supervisor_notes = payload.supervisor_notes.strip() or None
    dish.reviewed_by_id = current_user.id
    dish.reviewed_by_name = current_user.full_name or current_user.username or current_user.email
    dish.reviewed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(dish)
    db.commit()
    db.refresh(dish)
    logger.warning(
        "supervisor_review reject dish_id=%s old_status=%s new_status=%s needs_review=%s",
        dish.id,
        old_status,
        dish.status,
        dish.needs_review,
    )
    if old_status == dish.status and old_needs_review == bool(dish.needs_review):
        logger.warning("supervisor_review reject no-state-change dish_id=%s", dish.id)
    return dish_record_to_out(dish)


@router.patch("/{dish_id}/edit-approve", response_model=DishRecordOut)
def edit_approve_review_record(
    dish_id: int,
    payload: SupervisorEditApprovePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DishRecordOut:
    _ensure_supervisor_branch(current_user)
    dish = _get_or_404(db, dish_id, current_user)
    old_status = dish.status
    old_needs_review = bool(dish.needs_review)
    dish.confirmed_label = payload.dish_name.strip()
    dish.quantity = int(payload.quantity)
    dish.source_entity = payload.source.strip()
    dish.supervisor_notes = (payload.notes or "").strip() or None
    dish.needs_review = False
    dish.status = "approved"
    dish.rejected_reason = None
    dish.reviewed_by_id = current_user.id
    dish.reviewed_by_name = current_user.full_name or current_user.username or current_user.email
    dish.reviewed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(dish)
    db.commit()
    db.refresh(dish)
    logger.warning(
        "supervisor_review edit_approve dish_id=%s old_status=%s new_status=%s needs_review=%s",
        dish.id,
        old_status,
        dish.status,
        dish.needs_review,
    )
    if old_status == dish.status and old_needs_review == bool(dish.needs_review):
        logger.warning("supervisor_review edit_approve no-state-change dish_id=%s", dish.id)
    return dish_record_to_out(dish)
