from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.quality_form import QualityFormSession, QualityFormStageSubmission
from app.models.user import User
from app.schemas.quality_form import (
    SessionCreate,
    SessionOut,
    StageDefinitionOut,
    StageOut,
    StageSubmitPayload,
)

logger = logging.getLogger(__name__)

# Placeholder stage definitions — real inspection questions to be added after approval.
STAGE_DEFINITIONS: dict[int, dict] = {
    1: {"name_ar": "التأكد من جاهزية المواد", "questions": []},
    2: {"name_ar": "بداية عملية الطبخ", "questions": []},
    3: {
        "name_ar": "انتهاء عملية الطبخ",
        "questions": [
            {
                "id": "q1",
                "text_ar": "هل درجة حرارة البروتين بعد الطبخ أعلى من 75 درجة مئوية؟",
                "required": True,
            },
            {
                "id": "q2",
                "text_ar": "هل يوجد أي احتمالات لحدوث مخاطر غذائية؟",
                "required": True,
            },
            {
                "id": "q3",
                "text_ar": "هل فتحات الصرف الصحي مغلقة؟",
                "required": True,
            },
            {
                "id": "q4",
                "text_ar": "هل يتم تفريغ النفايات بشكل منتظم؟",
                "required": True,
            },
        ],
    },
    4: {"name_ar": "بداية مرحلة التعبئة", "questions": []},
    5: {"name_ar": "بداية عملية التوزيع", "questions": []},
}

TOTAL_STAGES = 5


def get_stage_definitions() -> list[StageDefinitionOut]:
    return [
        StageDefinitionOut(stage_number=n, name_ar=d["name_ar"], questions=d["questions"])
        for n, d in STAGE_DEFINITIONS.items()
    ]


def _resolve_branch_for_session(
    db: Session,
    current_user: User,
    payload_branch_id: int | None,
) -> tuple[int, str | None]:
    """Return (branch_id, branch_name) validated for the requesting user.

    Supervisor: ignores payload_branch_id — always uses their own assigned branch.
    Admin: validates payload_branch_id against the branches table in their tenant;
           falls back to current_user.branch_id when payload is None.

    Raises HTTPException on any authorization or configuration failure.
    """
    from app.models.branch import Branch

    if current_user.role == "supervisor":
        if current_user.branch_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="لم يتم تحديد الفرع لهذا الحساب",
            )
        return current_user.branch_id, current_user.branch_name

    # Admin path — resolve the target branch.
    target_id: int | None = payload_branch_id or current_user.branch_id
    if not target_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="يجب تحديد رقم الفرع",
        )

    # Always validate the target branch against the admin's tenant,
    # regardless of whether it came from the payload or the user record.
    branch = (
        db.query(Branch)
        .filter(
            Branch.id == target_id,
            Branch.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if branch is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="الفرع غير موجود أو لا ينتمي لمؤسستك",
        )
    return branch.id, branch.branch_name


def _stage_to_out(stage: QualityFormStageSubmission) -> StageOut:
    return StageOut(
        id=stage.id,
        session_id=stage.session_id,
        stage_number=stage.stage_number,
        stage_name_ar=stage.stage_name_ar,
        submitted_by_name=stage.submitted_by_name,
        submitted_at=stage.submitted_at,
        answers=json.loads(stage.answers) if stage.answers else {},
        measurements=json.loads(stage.measurements) if stage.measurements else None,
        notes=stage.notes,
    )


def _session_to_out(session: QualityFormSession) -> SessionOut:
    stages_out = [_stage_to_out(s) for s in (session.stages or [])]
    return SessionOut(
        id=session.id,
        tenant_id=session.tenant_id,
        branch_id=session.branch_id,
        branch_name=session.branch_name,
        meal_date=session.meal_date,
        meal_period=session.meal_period,
        created_by_name=session.created_by_name,
        created_at=session.created_at,
        is_complete=session.is_complete,
        completed_at=session.completed_at,
        stages=stages_out,
        submitted_stage_numbers=[s.stage_number for s in (session.stages or [])],
    )


def list_sessions(
    db: Session,
    current_user: User,
    meal_date: date | None = None,
) -> list[SessionOut]:
    """Return sessions scoped to current_user's tenant (and branch for supervisors)."""
    q = db.query(QualityFormSession).filter(
        QualityFormSession.tenant_id == current_user.tenant_id,
    )
    if current_user.role == "supervisor":
        if current_user.branch_id is None:
            return []
        q = q.filter(QualityFormSession.branch_id == current_user.branch_id)
    if meal_date is not None:
        q = q.filter(QualityFormSession.meal_date == meal_date)
    rows = q.order_by(QualityFormSession.meal_date.desc(), QualityFormSession.id.desc()).all()
    return [_session_to_out(s) for s in rows]


def get_or_create_session(
    db: Session,
    current_user: User,
    payload: SessionCreate,
) -> SessionOut:
    """Return the existing session for (tenant, branch, date, period) or create it.

    Branch is resolved server-side:
    - Supervisor: always their own branch; payload.branch_id is never used.
    - Admin: validates payload.branch_id against the branches table, falls back
      to current_user.branch_id when payload.branch_id is None.
    """
    branch_id, branch_name = _resolve_branch_for_session(
        db, current_user, payload.branch_id
    )

    existing = (
        db.query(QualityFormSession)
        .filter(
            QualityFormSession.tenant_id == current_user.tenant_id,
            QualityFormSession.branch_id == branch_id,
            QualityFormSession.meal_date == payload.meal_date,
            QualityFormSession.meal_period == payload.meal_period,
        )
        .first()
    )
    if existing is not None:
        db.refresh(existing)
        return _session_to_out(existing)

    session = QualityFormSession(
        tenant_id=current_user.tenant_id,
        branch_id=branch_id,
        branch_name=branch_name,
        meal_date=payload.meal_date,
        meal_period=payload.meal_period,
        created_by_id=current_user.id,
        created_by_name=current_user.full_name or current_user.username or current_user.email,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        is_complete=False,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.info(
        "quality_form session created id=%s branch=%s date=%s period=%s by=%s",
        session.id,
        branch_id,
        payload.meal_date,
        payload.meal_period,
        current_user.id,
    )
    return _session_to_out(session)


def get_session(
    db: Session,
    current_user: User,
    session_id: int,
) -> SessionOut:
    """Fetch one session, enforcing tenant isolation and supervisor branch scope."""
    session = (
        db.query(QualityFormSession)
        .filter(
            QualityFormSession.id == session_id,
            QualityFormSession.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الجلسة غير موجودة")
    if current_user.role == "supervisor" and session.branch_id != current_user.branch_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="غير مصرح بالوصول")
    db.refresh(session)
    return _session_to_out(session)


def submit_stage(
    db: Session,
    current_user: User,
    session_id: int,
    stage_number: int,
    payload: StageSubmitPayload,
) -> StageOut:
    """Submit one stage for a session, enforcing tenant isolation and supervisor branch scope."""
    if stage_number < 1 or stage_number > TOTAL_STAGES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"رقم المرحلة يجب أن يكون بين 1 و {TOTAL_STAGES}",
        )

    session = (
        db.query(QualityFormSession)
        .filter(
            QualityFormSession.id == session_id,
            QualityFormSession.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الجلسة غير موجودة")
    if current_user.role == "supervisor" and session.branch_id != current_user.branch_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="غير مصرح بالوصول")

    already = (
        db.query(QualityFormStageSubmission)
        .filter(
            QualityFormStageSubmission.session_id == session_id,
            QualityFormStageSubmission.stage_number == stage_number,
        )
        .first()
    )
    if already is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="هذه المرحلة تم تسليمها مسبقاً",
        )

    stage_def = STAGE_DEFINITIONS[stage_number]

    if not stage_def.get("questions"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="لم يتم إعداد أسئلة هذه المرحلة بعد — لا يمكن التسليم",
        )

    # Validate required answers.
    _VALID_YESNO = frozenset({"yes", "no"})
    required_ids = [q["id"] for q in stage_def.get("questions", []) if q.get("required")]
    if required_ids:
        invalid = [
            qid for qid in required_ids
            if str(payload.answers.get(qid, "")).lower() not in _VALID_YESNO
        ]
        if invalid:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="يجب الإجابة على جميع الأسئلة الإلزامية بـ نعم أو لا",
            )

    stage = QualityFormStageSubmission(
        session_id=session_id,
        stage_number=stage_number,
        stage_name_ar=stage_def["name_ar"],
        submitted_by_id=current_user.id,
        submitted_by_name=current_user.full_name or current_user.username or current_user.email,
        submitted_at=datetime.now(timezone.utc).replace(tzinfo=None),
        answers=json.dumps(payload.answers, ensure_ascii=False),
        measurements=(
            json.dumps(payload.measurements, ensure_ascii=False)
            if payload.measurements is not None
            else None
        ),
        notes=payload.notes,
    )
    db.add(stage)

    submitted_count = (
        db.query(QualityFormStageSubmission)
        .filter(QualityFormStageSubmission.session_id == session_id)
        .count()
    )
    if submitted_count + 1 >= TOTAL_STAGES:
        session.is_complete = True
        session.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(session)

    db.commit()
    db.refresh(stage)
    logger.info(
        "quality_form stage submitted session=%s stage=%s by=%s",
        session_id,
        stage_number,
        current_user.id,
    )
    return _stage_to_out(stage)
