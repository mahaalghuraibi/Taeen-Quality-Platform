from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.db.session import get_db
from app.models.camera import Camera
from app.models.user import User
from app.schemas.camera import CameraCreate, CameraOut
from app.security.stream_url import prepare_stream_url_for_storage

router = APIRouter(prefix="/cameras", tags=["cameras"])


@router.get(
    "",
    response_model=list[CameraOut],
    dependencies=[Depends(require_roles("admin", "supervisor"))],
)
def list_cameras(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[CameraOut]:
    rows = db.query(Camera).filter(Camera.tenant_id == current_user.tenant_id).all()
    return [CameraOut.from_camera(c) for c in rows]


@router.post(
    "",
    response_model=CameraOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin", "supervisor"))],
)
def create_camera(payload: CameraCreate, db: Session = Depends(get_db)) -> CameraOut:
    data = payload.model_dump()
    data["stream_url"] = prepare_stream_url_for_storage(data.get("stream_url"))
    camera = Camera(**data)
    db.add(camera)
    db.commit()
    db.refresh(camera)
    return CameraOut.from_camera(camera)
