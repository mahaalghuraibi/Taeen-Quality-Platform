"""Unit tests for quality forms — schema validation and authorization logic."""

from __future__ import annotations

from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas.quality_form import SessionCreate, StageSubmitPayload
from app.services.quality_form_service import (
    _resolve_branch_for_session,
    get_session,
    submit_stage,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_user(role: str, tenant_id: int = 1, branch_id: int | None = 10, branch_name: str | None = "Main") -> MagicMock:
    u = MagicMock()
    u.role = role
    u.tenant_id = tenant_id
    u.branch_id = branch_id
    u.branch_name = branch_name
    u.id = 1
    u.full_name = "Test User"
    u.username = "testuser"
    u.email = "test@example.com"
    return u


def _make_session_row(session_id: int = 5, tenant_id: int = 1, branch_id: int = 10, is_complete: bool = False) -> MagicMock:
    s = MagicMock()
    s.id = session_id
    s.tenant_id = tenant_id
    s.branch_id = branch_id
    s.branch_name = "Main"
    s.meal_date = date(2026, 1, 1)
    s.meal_period = "lunch"
    s.created_by_name = "Test User"
    s.created_at = datetime(2026, 1, 1, 12, 0, 0)
    s.is_complete = is_complete
    s.completed_at = None
    s.stages = []
    return s


def _make_stage_row(stage_number: int = 1, session_id: int = 5) -> MagicMock:
    s = MagicMock()
    s.id = 100
    s.session_id = session_id
    s.stage_number = stage_number
    s.stage_name_ar = "التأكد من جاهزية المواد"
    s.submitted_by_name = "Test User"
    s.submitted_at = datetime(2026, 1, 1, 13, 0, 0)
    s.answers = "{}"
    s.measurements = None
    s.notes = None
    return s


# ---------------------------------------------------------------------------
# Schema: SessionCreate
# ---------------------------------------------------------------------------

class TestSessionCreateSchema:
    def test_valid_all_periods(self):
        for period in ("breakfast", "lunch", "dinner"):
            sc = SessionCreate(meal_date=date(2026, 1, 1), meal_period=period)
            assert sc.meal_period == period

    def test_invalid_meal_period_rejected(self):
        with pytest.raises(ValidationError):
            SessionCreate(meal_date=date(2026, 1, 1), meal_period="brunch")

    def test_branch_id_optional(self):
        sc = SessionCreate(meal_date=date(2026, 1, 1), meal_period="lunch")
        assert sc.branch_id is None

    def test_branch_id_zero_rejected(self):
        with pytest.raises(ValidationError):
            SessionCreate(meal_date=date(2026, 1, 1), meal_period="lunch", branch_id=0)

    def test_branch_id_negative_rejected(self):
        with pytest.raises(ValidationError):
            SessionCreate(meal_date=date(2026, 1, 1), meal_period="lunch", branch_id=-1)

    def test_branch_id_positive_accepted(self):
        sc = SessionCreate(meal_date=date(2026, 1, 1), meal_period="lunch", branch_id=99)
        assert sc.branch_id == 99


# ---------------------------------------------------------------------------
# Schema: StageSubmitPayload
# ---------------------------------------------------------------------------

class TestStageSubmitPayloadSchema:
    def test_defaults(self):
        p = StageSubmitPayload()
        assert p.answers == {}
        assert p.measurements is None
        assert p.notes is None

    def test_notes_max_length(self):
        with pytest.raises(ValidationError):
            StageSubmitPayload(notes="x" * 2001)

    def test_notes_at_max_length_ok(self):
        p = StageSubmitPayload(notes="x" * 2000)
        assert len(p.notes) == 2000

    def test_answers_dict(self):
        p = StageSubmitPayload(answers={"q1": "yes"})
        assert p.answers["q1"] == "yes"


# ---------------------------------------------------------------------------
# Service: _resolve_branch_for_session
# ---------------------------------------------------------------------------

class TestResolveBranchForSession:
    def _make_db(self, branch_result=None):
        db = MagicMock()
        q = MagicMock()
        q.filter.return_value = q
        q.first.return_value = branch_result
        db.query.return_value = q
        return db

    def test_supervisor_uses_own_branch_ignores_payload(self):
        user = _make_user("supervisor", branch_id=10, branch_name="HQ")
        db = self._make_db()
        bid, bname = _resolve_branch_for_session(db, user, payload_branch_id=99)
        assert bid == 10
        assert bname == "HQ"

    def test_supervisor_no_branch_raises_400(self):
        user = _make_user("supervisor", branch_id=None)
        db = self._make_db()
        with pytest.raises(HTTPException) as exc_info:
            _resolve_branch_for_session(db, user, payload_branch_id=None)
        assert exc_info.value.status_code == 400

    def test_admin_valid_payload_branch_uses_it(self):
        fake_branch = SimpleNamespace(id=20, branch_name="Downtown", tenant_id=1)
        user = _make_user("admin", tenant_id=1, branch_id=10)
        db = self._make_db(branch_result=fake_branch)
        bid, bname = _resolve_branch_for_session(db, user, payload_branch_id=20)
        assert bid == 20
        assert bname == "Downtown"

    def test_admin_invalid_branch_raises_403(self):
        user = _make_user("admin", tenant_id=1, branch_id=10)
        db = self._make_db(branch_result=None)
        with pytest.raises(HTTPException) as exc_info:
            _resolve_branch_for_session(db, user, payload_branch_id=999)
        assert exc_info.value.status_code == 403

    def test_admin_no_payload_falls_back_to_user_branch(self):
        fake_branch = SimpleNamespace(id=10, branch_name="HQ", tenant_id=1)
        user = _make_user("admin", tenant_id=1, branch_id=10)
        db = self._make_db(branch_result=fake_branch)
        bid, bname = _resolve_branch_for_session(db, user, payload_branch_id=None)
        assert bid == 10

    def test_admin_no_payload_no_user_branch_raises_400(self):
        user = _make_user("admin", tenant_id=1, branch_id=None)
        db = self._make_db(branch_result=None)
        with pytest.raises(HTTPException) as exc_info:
            _resolve_branch_for_session(db, user, payload_branch_id=None)
        assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# Service: get_session — authorization
# ---------------------------------------------------------------------------

class TestGetSessionAuthorization:
    def _make_db_with_session(self, session_row):
        db = MagicMock()
        q = MagicMock()
        q.filter.return_value = q
        q.first.return_value = session_row
        db.query.return_value = q
        db.refresh = MagicMock()
        return db

    def test_supervisor_own_branch_allowed(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        row = _make_session_row(session_id=5, tenant_id=1, branch_id=10)
        db = self._make_db_with_session(row)
        result = get_session(db, user, session_id=5)
        assert result.id == 5

    def test_supervisor_other_branch_raises_403(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        row = _make_session_row(session_id=5, tenant_id=1, branch_id=20)
        db = self._make_db_with_session(row)
        with pytest.raises(HTTPException) as exc_info:
            get_session(db, user, session_id=5)
        assert exc_info.value.status_code == 403

    def test_admin_any_branch_in_tenant_allowed(self):
        user = _make_user("admin", tenant_id=1, branch_id=10)
        row = _make_session_row(session_id=5, tenant_id=1, branch_id=20)
        db = self._make_db_with_session(row)
        result = get_session(db, user, session_id=5)
        assert result.id == 5

    def test_cross_tenant_returns_404(self):
        user = _make_user("admin", tenant_id=1)
        db = self._make_db_with_session(None)
        with pytest.raises(HTTPException) as exc_info:
            get_session(db, user, session_id=99)
        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Service: submit_stage — authorization
# ---------------------------------------------------------------------------

class TestSubmitStageAuthorization:
    def _make_db(self, session_row=None, existing_stage=None, stage_count: int = 0):
        db = MagicMock()
        call_count = [0]

        def _query(model):
            call_count[0] += 1
            q = MagicMock()
            q.filter.return_value = q
            if call_count[0] == 1:
                q.first.return_value = session_row
            elif call_count[0] == 2:
                q.first.return_value = existing_stage
            else:
                q.count.return_value = stage_count
            return q

        db.query.side_effect = _query
        db.add = MagicMock()
        db.commit = MagicMock()
        db.refresh = MagicMock(side_effect=lambda obj: obj)
        return db

    def _payload(self):
        return StageSubmitPayload(notes="test")

    def test_invalid_stage_number_raises_400(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        db = MagicMock()
        with pytest.raises(HTTPException) as exc_info:
            submit_stage(db, user, session_id=5, stage_number=0, payload=self._payload())
        assert exc_info.value.status_code == 400

    def test_stage_number_above_max_raises_400(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        db = MagicMock()
        with pytest.raises(HTTPException) as exc_info:
            submit_stage(db, user, session_id=5, stage_number=6, payload=self._payload())
        assert exc_info.value.status_code == 400

    def test_session_not_found_raises_404(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        db = self._make_db(session_row=None)
        with pytest.raises(HTTPException) as exc_info:
            submit_stage(db, user, session_id=99, stage_number=1, payload=self._payload())
        assert exc_info.value.status_code == 404

    def test_supervisor_other_branch_raises_403(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        row = _make_session_row(session_id=5, tenant_id=1, branch_id=20)
        db = self._make_db(session_row=row)
        with pytest.raises(HTTPException) as exc_info:
            submit_stage(db, user, session_id=5, stage_number=1, payload=self._payload())
        assert exc_info.value.status_code == 403

    def test_duplicate_stage_raises_409(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        row = _make_session_row(session_id=5, tenant_id=1, branch_id=10)
        existing = _make_stage_row(stage_number=1, session_id=5)
        db = self._make_db(session_row=row, existing_stage=existing)
        with pytest.raises(HTTPException) as exc_info:
            submit_stage(db, user, session_id=5, stage_number=1, payload=self._payload())
        assert exc_info.value.status_code == 409

    def test_supervisor_own_branch_stage3_accepted(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        row = _make_session_row(session_id=5, tenant_id=1, branch_id=10)
        db = self._make_db(session_row=row, existing_stage=None, stage_count=0)
        db.refresh.side_effect = lambda obj: setattr(obj, "id", 100) or setattr(obj, "session_id", 5) or setattr(obj, "stage_number", 3) or setattr(obj, "stage_name_ar", "انتهاء عملية الطبخ") or setattr(obj, "submitted_by_name", "Test User") or setattr(obj, "submitted_at", datetime(2026, 1, 1, 13, 0, 0)) or setattr(obj, "answers", "{}") or setattr(obj, "measurements", None) or setattr(obj, "notes", None)
        payload = StageSubmitPayload(answers={"q1": "yes", "q2": "no", "q3": "yes", "q4": "yes"})
        result = submit_stage(db, user, session_id=5, stage_number=3, payload=payload)
        assert result.stage_number == 3


# ---------------------------------------------------------------------------
# Service: submit_stage — Stage 3 required-answer validation
# ---------------------------------------------------------------------------

VALID_STAGE3_ANSWERS = {"q1": "yes", "q2": "no", "q3": "yes", "q4": "yes"}


class TestSubmitStageStage3Validation:
    def _make_db(self, session_row=None, stage_count: int = 0):
        db = MagicMock()
        call_count = [0]

        def _query(model):
            call_count[0] += 1
            q = MagicMock()
            q.filter.return_value = q
            if call_count[0] == 1:
                q.first.return_value = session_row
            elif call_count[0] == 2:
                q.first.return_value = None  # no existing submission
            else:
                q.count.return_value = stage_count
            return q

        db.query.side_effect = _query
        db.add = MagicMock()
        db.commit = MagicMock()

        def _refresh(obj):
            obj.id = 200
            obj.session_id = 5
            obj.stage_number = 3
            obj.stage_name_ar = "انتهاء عملية الطبخ"
            obj.submitted_by_name = "Test User"
            obj.submitted_at = datetime(2026, 1, 1, 14, 0, 0)
            obj.answers = "{}"
            obj.measurements = None
            obj.notes = None

        db.refresh = MagicMock(side_effect=_refresh)
        return db

    def _session(self):
        return _make_session_row(session_id=5, tenant_id=1, branch_id=10)

    def test_stage3_all_valid_answers_accepted(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        db = self._make_db(session_row=self._session(), stage_count=0)
        payload = StageSubmitPayload(answers=VALID_STAGE3_ANSWERS)
        result = submit_stage(db, user, session_id=5, stage_number=3, payload=payload)
        assert result.stage_number == 3

    def test_stage3_missing_one_answer_raises_422(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        db = self._make_db(session_row=self._session())
        partial = {k: v for k, v in VALID_STAGE3_ANSWERS.items() if k != "q3"}
        payload = StageSubmitPayload(answers=partial)
        with pytest.raises(HTTPException) as exc_info:
            submit_stage(db, user, session_id=5, stage_number=3, payload=payload)
        assert exc_info.value.status_code == 422

    def test_stage3_empty_answers_raises_422(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        db = self._make_db(session_row=self._session())
        payload = StageSubmitPayload(answers={})
        with pytest.raises(HTTPException) as exc_info:
            submit_stage(db, user, session_id=5, stage_number=3, payload=payload)
        assert exc_info.value.status_code == 422

    def test_stage3_invalid_answer_value_raises_422(self):
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        db = self._make_db(session_row=self._session())
        bad = dict(VALID_STAGE3_ANSWERS)
        bad["q2"] = "maybe"
        payload = StageSubmitPayload(answers=bad)
        with pytest.raises(HTTPException) as exc_info:
            submit_stage(db, user, session_id=5, stage_number=3, payload=payload)
        assert exc_info.value.status_code == 422

    def test_stage1_no_questions_raises_422(self):
        """Stages without configured questions must be blocked from submission."""
        user = _make_user("supervisor", tenant_id=1, branch_id=10)
        db = self._make_db(session_row=self._session(), stage_count=0)
        payload = StageSubmitPayload(answers={})
        with pytest.raises(HTTPException) as exc_info:
            submit_stage(db, user, session_id=5, stage_number=1, payload=payload)
        assert exc_info.value.status_code == 422
