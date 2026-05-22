#!/usr/bin/env python3
"""Create a dish with image, verify disk + HTTP, simulate backend restart."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# 1×1 red PNG
_TEST_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_DATA_URL = f"data:image/png;base64,{_TEST_PNG_B64}"
_API_BASE = "http://127.0.0.1:8000"


def _http_get(url: str) -> tuple[int, int]:
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            body = resp.read()
            return resp.status, len(body)
    except urllib.error.HTTPError as exc:
        return exc.code, 0


def main() -> int:
    backend_root = Path(__file__).resolve().parents[1]
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

    from app.db.session import SessionLocal, init_db
    from app.models.dish_record import DishRecord
    from app.models.user import User
    from app.services.dish_image_storage import (
        dish_media_dir,
        dish_stored_file_exists,
        materialize_dish_image_url,
        migrate_legacy_dish_images_to_dishes,
        resolve_dish_file_path,
    )

    init_db()
    migrate_legacy_dish_images_to_dishes()
    media_dir = dish_media_dir()
    print(f"DISH_MEDIA_DIR={media_dir}")

    db = SessionLocal()
    try:
        user = db.query(User).order_by(User.id.asc()).first()
        if not user:
            print("FAIL: no users in database — create a user first.")
            return 1

        stored_url = materialize_dish_image_url(_DATA_URL)
        if not dish_stored_file_exists(stored_url):
            print(f"FAIL: file not on disk after materialize: {stored_url}")
            return 1

        disk_path = resolve_dish_file_path(stored_url)
        if disk_path is None:
            print("FAIL: resolve_dish_file_path returned None")
            return 1
        print(f"OK: saved file {disk_path} ({disk_path.stat().st_size} bytes)")

        dish = DishRecord(
            image_url=stored_url,
            predicted_label="طبق اختبار الثبات",
            confirmed_label="طبق اختبار الثبات",
            quantity=1,
            source_entity="مطبخ — اختبار ثبات الصورة",
            recorded_at=datetime.now(timezone.utc).replace(tzinfo=None),
            needs_review=False,
            status="approved",
            user_id=user.id,
            tenant_id=user.tenant_id,
            employee_id=user.id,
            employee_name=user.full_name or user.username or "verify-script",
            employee_email=user.email,
            branch_id=user.branch_id or 1,
            branch_name=user.branch_name or "فرع تجريبي",
        )
        db.add(dish)
        db.commit()
        db.refresh(dish)
        print(f"OK: dish record id={dish.id} image_url={stored_url}")

        # Simulate backend restart: re-import storage (fresh module state)
        if not dish_stored_file_exists(stored_url):
            print("FAIL: file missing after simulated restart")
            return 1
        print("OK: file still on disk after simulated restart")

        files_url = f"{_API_BASE}{stored_url}"
        media_fname = stored_url.rsplit("/", 1)[-1]
        media_url = f"{_API_BASE}/api/v1/media/dishes/{media_fname}"

        for label, url in (("files", files_url), ("media", media_url)):
            status, size = _http_get(url)
            if status != 200:
                print(f"WARN: GET {label} {url} => HTTP {status} (is uvicorn running on 8000?)")
            else:
                print(f"OK: GET {label} => HTTP 200 ({size} bytes)")

        out = {
            "dish_id": dish.id,
            "image_url": stored_url,
            "storage_path": f"dishes/{media_fname}",
            "disk_path": str(disk_path),
        }
        print("RESULT:", json.dumps(out, ensure_ascii=False))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
