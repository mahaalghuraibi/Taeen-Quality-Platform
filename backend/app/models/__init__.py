# Import order matters for SQLAlchemy mapper configuration (string-based relationships).
from app.models.tenant import Tenant  # noqa: F401
from app.models.user import User  # noqa: F401
from app.models.camera import Camera  # noqa: F401
from app.models.dish_record import DishRecord  # noqa: F401
from app.models.admin_request import AdminRequest  # noqa: F401
from app.models.meal_type import MealType  # noqa: F401
from app.models.monitoring_alert import MonitoringAlert  # noqa: F401
from app.models.system_setting import SystemSetting  # noqa: F401
from app.models.audit_log import AuditLog  # noqa: F401
from app.models.ai_inference_log import AIInferenceLog  # noqa: F401

__all__ = [
    "Tenant",
    "User",
    "Camera",
    "DishRecord",
    "AdminRequest",
    "MealType",
    "MonitoringAlert",
    "SystemSetting",
    "AuditLog",
    "AIInferenceLog",
]
