"""Dedicated media routes for permanent dish images and agent evidence."""

from fastapi import APIRouter

from app.services.agent_evidence_storage import serve_agent_evidence_file
from app.services.dish_image_storage import serve_dish_image_file

router = APIRouter(prefix="/media", tags=["dish-media"])


@router.get("/dishes/{filename}")
def get_dish_image_media(filename: str):
    """Serve dish photo from backend/media/dishes/ (alias of /dishes/files/)."""
    return serve_dish_image_file(filename)


@router.get("/agent-evidence/{filename}")
def get_agent_evidence_media(filename: str):
    """Serve a local-agent evidence snapshot from backend/media/agent_evidence/."""
    return serve_agent_evidence_file(filename)
