"""Dedicated media route for permanent dish images."""

from fastapi import APIRouter

from app.services.dish_image_storage import serve_dish_image_file

router = APIRouter(prefix="/media", tags=["dish-media"])


@router.get("/dishes/{filename}")
def get_dish_image_media(filename: str):
    """Serve dish photo from backend/media/dishes/ (alias of /dishes/files/)."""
    return serve_dish_image_file(filename)
