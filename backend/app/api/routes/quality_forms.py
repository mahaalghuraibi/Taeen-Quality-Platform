from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.db.session import get_db
from app.models.user import User
from app.schemas.quality_form import SessionCreate, SessionOut, StageDefinitionOut, StageOut, StageSubmitPayload
from app.services.quality_form_service import (
    get_or_create_session,
    get_session,
    get_stage_definitions,
    list_sessions,
    submit_stage,
)

router = APIRouter(
    prefix="/quality-forms",
    tags=["quality-forms"],
    dependencies=[Depends(require_roles("supervisor", "admin"))],
)


@router.get("/stage-definitions", response_model=list[StageDefinitionOut])
def list_stage_definitions() -> list[StageDefinitionOut]:
    return get_stage_definitions()


@router.get("/sessions", response_model=list[SessionOut])
def list_quality_sessions(
    meal_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SessionOut]:
    return list_sessions(db, current_user, meal_date=meal_date)


@router.post("/sessions", response_model=SessionOut, status_code=200)
def create_quality_session(
    payload: SessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SessionOut:
    return get_or_create_session(db, current_user, payload)


@router.get("/sessions/{session_id}", response_model=SessionOut)
def get_quality_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SessionOut:
    return get_session(db, current_user, session_id)


@router.post("/sessions/{session_id}/stages/{stage_number}", response_model=StageOut)
def submit_quality_stage(
    session_id: int,
    stage_number: int,
    payload: StageSubmitPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StageOut:
    return submit_stage(db, current_user, session_id, stage_number, payload)
