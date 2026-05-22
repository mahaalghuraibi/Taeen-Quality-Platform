"""Enrich DishRecord ORM rows for API responses."""

from app.models.dish_record import DishRecord
from app.schemas.dish_record import DishRecordOut
from app.services.dish_image_storage import (
    dish_storage_relative_path,
    dish_stored_file_exists,
)


def dish_record_to_out(dish: DishRecord) -> DishRecordOut:
    base = DishRecordOut.model_validate(dish)
    image_url = dish.image_url or ""
    return base.model_copy(
        update={
            "image_available": dish_stored_file_exists(image_url),
            "storage_path": dish_storage_relative_path(image_url),
        },
    )


def dish_records_to_out(rows: list[DishRecord]) -> list[DishRecordOut]:
    return [dish_record_to_out(d) for d in rows]
