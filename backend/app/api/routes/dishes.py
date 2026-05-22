import logging
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import ROLE_STAFF, require_roles
from app.core.limiter import limiter
from app.db.session import get_db
from app.models.dish_record import DishRecord
from app.models.user import User
from app.schemas.dish_record import DishDetectResponse, DishRecordCreate, DishRecordOut, DishRecordUpdate
from app.services.dish_detection_service import detect_dish_from_image
from app.services.dish_image_storage import (
    materialize_dish_image_url,
    serve_dish_image_file,
    try_delete_stored_dish_file,
)
from app.services.dish_record_serialize import dish_record_to_out, dish_records_to_out

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dishes", tags=["dishes"])

_DISH_DETECT_UPLOAD_MAX_BYTES = 12_000_000

_RIYADH = ZoneInfo("Asia/Riyadh")


def _recorded_at_naive_utc_now() -> datetime:
    """Current instant (wall clock in Riyadh → same instant) stored as naive UTC for SQLite."""
    return datetime.now(_RIYADH).astimezone(timezone.utc).replace(tzinfo=None)


@router.get("/files/{filename}")
def get_dish_image_file(filename: str) -> FileResponse:
    """Serve permanent dish image from backend/media/dishes/."""
    return serve_dish_image_file(filename)


@router.get(
    "",
    response_model=list[DishRecordOut],
    dependencies=[Depends(require_roles("admin", "supervisor", "staff"))],
)
def list_dishes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DishRecordOut]:
    query = db.query(DishRecord).filter(DishRecord.tenant_id == current_user.tenant_id)
    if current_user.role == ROLE_STAFF:
        query = query.filter(DishRecord.user_id == current_user.id)
    elif current_user.role == "supervisor":
        query = query.filter(DishRecord.branch_id == current_user.branch_id)
    return dish_records_to_out(query.all())


@router.post(
    "",
    response_model=DishRecordOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin", "supervisor", "staff"))],
)
def create_dish(
    payload: DishRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DishRecordOut:
    values = payload.model_dump(exclude={"user_id", "tenant_id", "recorded_at", "image_data_url"})
    values["user_id"] = current_user.id
    values["tenant_id"] = current_user.tenant_id
    values["employee_id"] = current_user.id
    values["employee_name"] = current_user.full_name or current_user.username or current_user.email
    values["employee_email"] = current_user.email
    values["branch_id"] = current_user.branch_id or 1
    values["branch_name"] = current_user.branch_name or "فرع تجريبي"
    # Always server clock (Riyadh wall-clock instant → UTC naive) — client recorded_at ignored.
    values["recorded_at"] = _recorded_at_naive_utc_now()
    # Persist data URLs to disk so GET /dishes stays small and <img> uses a short URL.
    values["image_url"] = materialize_dish_image_url(values["image_url"])
    # Staff confirmed the dish name on save — auto-approve, no review needed.
    values["needs_review"] = False
    values["status"] = "approved"
    if payload.ai_suggestions is not None:
        values["ai_suggestions"] = json.dumps([s.model_dump() for s in payload.ai_suggestions], ensure_ascii=False)
    else:
        values["ai_suggestions"] = None
    logger.info(
        "create_dish user_id=%s tenant_id=%s predicted=%r confirmed=%r quantity=%s source_entity_len=%s stored_image_url_len=%s",
        current_user.id,
        current_user.tenant_id,
        payload.predicted_label,
        payload.confirmed_label,
        payload.quantity,
        len(payload.source_entity),
        len(values["image_url"]),
    )
    dish = DishRecord(**values)
    db.add(dish)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.warning("create_dish integrity_error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="تعذر حفظ السجل: تعارض في البيانات أو مرجع غير صالح. أعد المحاولة أو تواصل مع الإدارة.",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("create_dish database_error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="خطأ في قاعدة البيانات أثناء حفظ الطبق.",
        ) from exc
    db.refresh(dish)
    logger.info("create_dish success id=%s", dish.id)
    return dish_record_to_out(dish)


@router.post(
    "/detect",
    response_model=DishDetectResponse,
    dependencies=[Depends(require_roles("admin", "supervisor", "staff"))],
)
@limiter.limit("48/minute")
async def detect_dish(
    request: Request,
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> DishDetectResponse:
    _ = current_user
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="الملف المرفوع ليس صورة صالحة.")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="الصورة فارغة.")
    if len(image_bytes) > _DISH_DETECT_UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail="حجم الصورة يتجاوز الحد المسموح.")

    detected, alternatives, confidence, provider = detect_dish_from_image(image_bytes, image.filename or "")
    return DishDetectResponse(
        detected=detected,
        alternatives=alternatives[:3],
        confidence=confidence,
        provider=provider,
    )


def _get_dish_for_user(db: Session, dish_id: int, current_user: User) -> DishRecord | None:
    q = db.query(DishRecord).filter(DishRecord.id == dish_id, DishRecord.tenant_id == current_user.tenant_id)
    if current_user.role == ROLE_STAFF:
        q = q.filter(DishRecord.user_id == current_user.id)
    elif current_user.role == "supervisor":
        q = q.filter(DishRecord.branch_id == current_user.branch_id)
    return q.first()


@router.patch(
    "/{dish_id}",
    response_model=DishRecordOut,
    dependencies=[Depends(require_roles("admin", "supervisor", "staff"))],
)
def update_dish(
    dish_id: int,
    payload: DishRecordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DishRecordOut:
    dish = _get_dish_for_user(db, dish_id, current_user)
    if dish is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="السجل غير موجود.")
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(dish, key, value)
    try:
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("update_dish database_error id=%s", dish_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="خطأ في قاعدة البيانات أثناء تحديث الطبق.",
        ) from exc
    db.refresh(dish)
    logger.info("update_dish success id=%s", dish_id)
    return dish_record_to_out(dish)


@router.delete(
    "/{dish_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("admin", "supervisor", "staff"))],
)
def delete_dish(
    dish_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    dish = _get_dish_for_user(db, dish_id, current_user)
    if dish is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="السجل غير موجود.")
    try_delete_stored_dish_file(dish.image_url)
    try:
        db.delete(dish)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("delete_dish database_error id=%s", dish_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="خطأ في قاعدة البيانات أثناء حذف الطبق.",
        ) from exc
    logger.info("delete_dish success id=%s", dish_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
