"""Branch management API.

Endpoints
---------
Public:
  GET    /api/v1/branches/public              → list active branches (signup dropdown)
  POST   /api/v1/branches/requests            → submit a branch request (public)

Authenticated (any role):
  GET    /api/v1/branches/requests/mine       → list my submitted requests

Admin-only:
  GET    /api/v1/branches                     → list all branches (incl. inactive)
  POST   /api/v1/branches                     → create branch
  PATCH  /api/v1/branches/{id}                → edit name / city / active
  DELETE /api/v1/branches/{id}                → hard delete (only if unused)
  PATCH  /api/v1/branches/{id}/disable        → soft-disable
  PATCH  /api/v1/branches/{id}/enable         → re-enable
  GET    /api/v1/branches/requests            → list all branch requests
  PATCH  /api/v1/branches/requests/{id}       → approve / reject request
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_optional, get_current_user
from app.api.rbac import require_roles
from app.db.session import get_db
from app.models.branch import Branch
from app.models.branch_request import BranchRequest
from app.models.dish_record import DishRecord
from app.models.monitoring_alert import MonitoringAlert
from app.models.user import User
from app.schemas.branch import (
    BranchCreate,
    BranchOut,
    BranchPublicOut,
    BranchRequestCreate,
    BranchRequestDecision,
    BranchRequestOut,
    BranchUpdate,
)
from app.services.auth_service import normalize_email

router = APIRouter(prefix="/branches", tags=["branches"])


# ── Helpers ──────────────────────────────────────────────────────────────────


def _display_name(user: User | None) -> str | None:
    if user is None:
        return None
    return (user.full_name or "").strip() or (user.username or "").strip() or user.email


def _propagate_branch_rename(db: Session, branch_id: int, new_name: str) -> None:
    """Keep denormalized `branch_name` columns in sync after a rename."""
    new_name = (new_name or "").strip()
    if not new_name:
        return
    db.query(User).filter(User.branch_id == branch_id).update(
        {User.branch_name: new_name}, synchronize_session=False
    )
    db.query(DishRecord).filter(DishRecord.branch_id == branch_id).update(
        {DishRecord.branch_name: new_name}, synchronize_session=False
    )
    db.query(MonitoringAlert).filter(MonitoringAlert.branch_id == branch_id).update(
        {MonitoringAlert.branch_name: new_name}, synchronize_session=False
    )


def _branch_is_in_use(db: Session, branch_id: int) -> bool:
    if db.query(User.id).filter(User.branch_id == branch_id).first() is not None:
        return True
    if db.query(DishRecord.id).filter(DishRecord.branch_id == branch_id).first() is not None:
        return True
    if db.query(MonitoringAlert.id).filter(MonitoringAlert.branch_id == branch_id).first() is not None:
        return True
    return False


# ── Public ───────────────────────────────────────────────────────────────────


@router.get("/public", response_model=list[BranchPublicOut])
def list_public_branches(db: Session = Depends(get_db)) -> list[Branch]:
    """Active branches only — safe to expose to the public signup page."""
    return (
        db.query(Branch)
        .filter(Branch.is_active.is_(True))
        .order_by(Branch.id.asc())
        .all()
    )


@router.post(
    "/requests",
    response_model=BranchRequestOut,
    status_code=status.HTTP_201_CREATED,
)
def submit_branch_request(
    payload: BranchRequestCreate,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> BranchRequest:
    """Public: submit a request to add a new branch (requires admin approval).

    - Authenticated users: identified via JWT (requested_by_id, name copied from profile).
    - Anonymous users (signup flow): must provide requested_by_name + requested_by_email.
    """
    branch_name = payload.branch_name.strip()

    # Reject if a branch with that name already exists (admin should enable it instead).
    existing = (
        db.query(Branch).filter(func.lower(Branch.branch_name) == branch_name.lower()).first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="هذا الفرع موجود بالفعل في النظام.",
        )

    req_email: str | None = None
    req_name: str | None = None
    requested_by_id: int | None = None

    if current_user is not None:
        requested_by_id = current_user.id
        req_name = _display_name(current_user)
        req_email = current_user.email
    else:
        req_name = (payload.requested_by_name or "").strip() or None
        if payload.requested_by_email is not None:
            req_email = normalize_email(str(payload.requested_by_email))
        if not req_name or not req_email:
            raise HTTPException(
                status_code=400,
                detail="الرجاء إدخال الاسم والبريد الإلكتروني لمتابعة الطلب.",
            )

    req = BranchRequest(
        branch_name=branch_name,
        city=(payload.city or "").strip() or None,
        reason=(payload.reason or "").strip() or None,
        requested_by_id=requested_by_id,
        requested_by_name=req_name,
        requested_by_email=req_email,
        status="pending",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


# ── Authenticated (any role) ─────────────────────────────────────────────────


@router.get("/requests/mine", response_model=list[BranchRequestOut])
def list_my_branch_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BranchRequest]:
    q = db.query(BranchRequest).filter(
        (BranchRequest.requested_by_id == current_user.id)
        | (func.lower(BranchRequest.requested_by_email) == current_user.email.lower())
    )
    return q.order_by(BranchRequest.created_at.desc()).all()


# ── Admin: branches CRUD ─────────────────────────────────────────────────────


@router.get(
    "",
    response_model=list[BranchOut],
    dependencies=[Depends(require_roles("admin"))],
)
def list_branches(db: Session = Depends(get_db)) -> list[Branch]:
    return db.query(Branch).order_by(Branch.id.asc()).all()


@router.post(
    "",
    response_model=BranchOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin"))],
)
def create_branch(
    payload: BranchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Branch:
    name = payload.branch_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم الفرع مطلوب.")
    if db.query(Branch).filter(func.lower(Branch.branch_name) == name.lower()).first() is not None:
        raise HTTPException(status_code=409, detail="يوجد فرع آخر بنفس الاسم.")
    branch = Branch(
        tenant_id=current_user.tenant_id or 1,
        branch_name=name,
        city=(payload.city or "").strip() or None,
        is_active=bool(payload.is_active),
        created_by_id=current_user.id,
        created_by_name=_display_name(current_user),
    )
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


@router.patch(
    "/{branch_id}",
    response_model=BranchOut,
    dependencies=[Depends(require_roles("admin"))],
)
def update_branch(
    branch_id: int,
    payload: BranchUpdate,
    db: Session = Depends(get_db),
) -> Branch:
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if branch is None:
        raise HTTPException(status_code=404, detail="الفرع غير موجود.")

    if payload.branch_name is not None:
        new_name = payload.branch_name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="اسم الفرع مطلوب.")
        if (
            db.query(Branch)
            .filter(
                func.lower(Branch.branch_name) == new_name.lower(),
                Branch.id != branch_id,
            )
            .first()
            is not None
        ):
            raise HTTPException(status_code=409, detail="يوجد فرع آخر بنفس الاسم.")
        if new_name != branch.branch_name:
            branch.branch_name = new_name
            _propagate_branch_rename(db, branch_id, new_name)

    if payload.city is not None:
        branch.city = payload.city.strip() or None

    if payload.is_active is not None:
        branch.is_active = bool(payload.is_active)

    db.commit()
    db.refresh(branch)
    return branch


@router.patch(
    "/{branch_id}/disable",
    response_model=BranchOut,
    dependencies=[Depends(require_roles("admin"))],
)
def disable_branch(branch_id: int, db: Session = Depends(get_db)) -> Branch:
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if branch is None:
        raise HTTPException(status_code=404, detail="الفرع غير موجود.")
    branch.is_active = False
    db.commit()
    db.refresh(branch)
    return branch


@router.patch(
    "/{branch_id}/enable",
    response_model=BranchOut,
    dependencies=[Depends(require_roles("admin"))],
)
def enable_branch(branch_id: int, db: Session = Depends(get_db)) -> Branch:
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if branch is None:
        raise HTTPException(status_code=404, detail="الفرع غير موجود.")
    branch.is_active = True
    db.commit()
    db.refresh(branch)
    return branch


@router.delete(
    "/{branch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("admin"))],
)
def delete_branch(branch_id: int, db: Session = Depends(get_db)) -> None:
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if branch is None:
        raise HTTPException(status_code=404, detail="الفرع غير موجود.")
    if _branch_is_in_use(db, branch_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "لا يمكن حذف هذا الفرع لأن مستخدمين أو سجلات أطباق أو تنبيهات مرتبطة به. "
                "قم بتعطيله بدلاً من الحذف للحفاظ على السجل التاريخي."
            ),
        )
    db.delete(branch)
    db.commit()
    return None


# ── Admin: branch requests ───────────────────────────────────────────────────


@router.get(
    "/requests",
    response_model=list[BranchRequestOut],
    dependencies=[Depends(require_roles("admin"))],
)
def list_branch_requests(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
) -> list[BranchRequest]:
    q = db.query(BranchRequest)
    if status_filter in {"pending", "approved", "rejected"}:
        q = q.filter(BranchRequest.status == status_filter)
    return q.order_by(BranchRequest.created_at.desc()).all()


@router.patch(
    "/requests/{request_id}",
    response_model=BranchRequestOut,
    dependencies=[Depends(require_roles("admin"))],
)
def decide_branch_request(
    request_id: int,
    payload: BranchRequestDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BranchRequest:
    req = db.query(BranchRequest).filter(BranchRequest.id == request_id).first()
    if req is None:
        raise HTTPException(status_code=404, detail="الطلب غير موجود.")
    if req.status != "pending":
        raise HTTPException(
            status_code=409,
            detail="هذا الطلب تمت معالجته مسبقاً.",
        )

    now = datetime.utcnow()
    reviewer_name = _display_name(current_user)

    if payload.status == "approved":
        target_name = (payload.branch_name or req.branch_name or "").strip()
        if not target_name:
            raise HTTPException(status_code=400, detail="اسم الفرع مطلوب.")

        # Idempotent: reuse an existing branch with the same name.
        existing = (
            db.query(Branch)
            .filter(func.lower(Branch.branch_name) == target_name.lower())
            .first()
        )
        if existing is None:
            existing = Branch(
                tenant_id=current_user.tenant_id or 1,
                branch_name=target_name,
                city=(payload.city or req.city or "").strip() or None,
                is_active=True,
                created_by_id=current_user.id,
                created_by_name=reviewer_name,
            )
            db.add(existing)
            db.flush()
        elif not existing.is_active:
            existing.is_active = True

        req.branch_id = existing.id

    req.status = payload.status
    req.review_note = (payload.review_note or "").strip() or None
    req.reviewed_at = now
    req.reviewed_by_id = current_user.id
    req.reviewed_by_name = reviewer_name

    db.commit()
    db.refresh(req)
    return req
