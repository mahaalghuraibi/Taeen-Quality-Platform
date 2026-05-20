from fastapi import APIRouter

from app.api.routes.admin_requests import router as admin_requests_router
from app.api.routes.mask_detection import router as mask_detection_router
from app.api.routes.admin_settings import router as admin_settings_router
from app.api.routes.auth import router as auth_router
from app.api.routes.cameras import router as cameras_router
from app.api.routes.detect_dish import router as detect_dish_router
from app.api.routes.dishes import router as dishes_router
from app.api.routes.me import profile_router, router as me_router
from app.api.routes.meal_types import router as meal_types_router
from app.api.routes.monitoring import router as monitoring_router
from app.api.routes.reports import router as reports_router
from app.api.routes.supervisor_reviews import router as supervisor_reviews_router
from app.api.routes.supervisor_dashboard import router as supervisor_dashboard_router
from app.api.routes.supervisor_cameras import router as supervisor_cameras_router
from app.api.routes.users import router as users_router
from app.api.routes.users_me import router as users_me_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
# Register /users/me before the admin /users router so the static "me" path always wins.
api_router.include_router(users_me_router)
api_router.include_router(me_router)
api_router.include_router(profile_router)
api_router.include_router(meal_types_router)
api_router.include_router(admin_requests_router)
api_router.include_router(dishes_router)
api_router.include_router(detect_dish_router)
api_router.include_router(monitoring_router)
api_router.include_router(cameras_router)
api_router.include_router(reports_router)
api_router.include_router(supervisor_dashboard_router)
api_router.include_router(supervisor_reviews_router)
api_router.include_router(supervisor_cameras_router)
api_router.include_router(users_router)
api_router.include_router(admin_settings_router)
api_router.include_router(mask_detection_router)
