from contextlib import asynccontextmanager
import logging
import os
import traceback

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.trustedhost import TrustedHostMiddleware

import app.models  # noqa: F401 - register ORM mappers before routes import User
from app.api.router import api_router
from app.core.config import (
    database_host_from_url,
    sanitize_database_url_for_log,
    settings,
    validate_settings_for_startup,
)
from app.core.limiter import limiter
from app.db.session import init_db_with_retry
from app.middleware.security_headers import SecurityHeadersMiddleware

logger = logging.getLogger(__name__)

_DEV_CORS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5178",
    "http://127.0.0.1:5178",
]

# Always-allowed production frontend origins so the live mobile site keeps
# working even if CORS_ALLOW_ORIGINS is missing on the API service.
_PROD_FRONTEND_ALLOWLIST = [
    "https://taeen-quality-frontend.onrender.com",
    # Legacy Render service name (bookmark / old docs) — keep CORS working if revived.
    "https://ska-frontend.onrender.com",
]


def _cors_allow_origins() -> list[str]:
    raw = str(getattr(settings, "CORS_ALLOW_ORIGINS_RAW", "") or "").strip()
    if settings.is_production:
        configured = [p.strip() for p in raw.split(",") if p.strip()]
        merged = list(dict.fromkeys(configured + _PROD_FRONTEND_ALLOWLIST))
        if not configured:
            logger.warning(
                "CORS_ALLOW_ORIGINS not set — falling back to built-in frontend allowlist: %s",
                _PROD_FRONTEND_ALLOWLIST,
            )
        return merged
    if not raw:
        return list(_DEV_CORS)
    return [p.strip() for p in raw.split(",") if p.strip()]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    validate_settings_for_startup()

    _mon_dedicated = bool((os.getenv("MONITORING_GEMINI_API_KEY") or "").strip())
    _dish_dedicated = bool((os.getenv("DISH_GEMINI_API_KEY") or "").strip())
    _legacy_set = bool((os.getenv("GEMINI_API_KEY") or "").strip())

    monitoring_key_set = bool((settings.MONITORING_GEMINI_API_KEY or "").strip())
    dish_key_set = bool((settings.DISH_GEMINI_API_KEY or "").strip())
    monitoring_key_src = "dedicated" if _mon_dedicated else ("legacy-fallback" if _legacy_set else "MISSING")
    dish_key_src = "dedicated" if _dish_dedicated else ("legacy-fallback" if _legacy_set else "MISSING")

    monitoring_model = (settings.MONITORING_GEMINI_MODEL or settings.GEMINI_VISION_MODEL or "").strip()
    dish_model = (settings.DISH_GEMINI_MODEL or settings.GEMINI_VISION_MODEL or "").strip()
    demo_mode = settings.MONITORING_AI_DEMO_MODE

    from app.services.yolo_model_resolver import resolve_yolo_model_path, startup_log_lines

    yolo_resolved = resolve_yolo_model_path(allow_download=False)
    yolo_warning = (
        ""
        if yolo_resolved
        else "  *** YOLO weights not on disk yet (lazy load on first analyze-frame) ***"
    )
    waste_path = (settings.YOLO_WASTE_MODEL_PATH or "").strip()
    waste_status = waste_path if waste_path else "NOT_CONFIGURED"
    startup_lines = [f"  {line}" for line in startup_log_lines(yolo_resolved)]
    startup_lines.extend([
        f"  YOLO_WASTE_MODEL_PATH={waste_status}",
        f"  DISH_GEMINI_API_KEY_set={dish_key_set}  source={dish_key_src}",
        f"  DISH_GEMINI_MODEL={dish_model or '(none)'}",
        f"  MONITORING_GEMINI_API_KEY_set={monitoring_key_set}  source={monitoring_key_src}  (unused — YOLO handles monitoring)",
        f"  MONITORING_GEMINI_MODEL={monitoring_model or '(none)'}  (unused)",
        f"  MONITORING_AI_DEMO_MODE={demo_mode}",
        f"  ROBOFLOW_KEY_set={bool(settings.ROBOFLOW_API_KEY.strip())}",
    ])
    logger.info("  YOLO_ENABLED=%s (lazy load — no warmup at startup)", settings.YOLO_ENABLED)
    for line in startup_lines:
        logger.info(line.strip())
    if yolo_warning:
        logger.warning(yolo_warning.strip())

    _app.state.db_ready = False
    _app.state.runtime_host = database_host_from_url(settings.DATABASE_URL)
    _app.state.bootstrap_host = database_host_from_url(settings.DATABASE_BOOTSTRAP_URL)
    print(f"DATABASE_URL = {sanitize_database_url_for_log(settings.DATABASE_URL)}", flush=True)
    print(f"BOOTSTRAP_URL = {sanitize_database_url_for_log(settings.DATABASE_BOOTSTRAP_URL)}", flush=True)
    _app.state.db_last_error = None
    try:
        init_db_with_retry()
        _app.state.db_ready = True
    except Exception as exc:
        _app.state.db_last_error = f"{type(exc).__name__}: {exc}"
        logger.exception(
            "Database bootstrap failed at startup — API will retry on first auth request"
        )

    from app.services.dish_image_storage import dish_media_dir, migrate_legacy_dish_images_to_dishes

    dish_media_dir()
    migrated = migrate_legacy_dish_images_to_dishes()
    logger.info("DISH_MEDIA_DIR=%s (migrated %s legacy file(s))", settings.DISH_MEDIA_DIR, migrated)
    yield


_docs_url = None if settings.is_production else "/docs"
_redoc_url = None if settings.is_production else "/redoc"
_openapi_url = None if settings.is_production else "/openapi.json"

app = FastAPI(
    title=getattr(settings, "PROJECT_NAME", "API"),
    lifespan=lifespan,
    docs_url=_docs_url,
    redoc_url=_redoc_url,
    openapi_url=_openapi_url,
)
app.openapi_version = "3.0.2"

app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    _ = exc  # slowapi carries limit detail; do not echo to clients in production
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"detail": "تم تجاوز الحد المسموح للطلبات. حاول بعد قليل."},
    )

if settings.allowed_hosts_list:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts_list)

app.add_middleware(
    SecurityHeadersMiddleware,
    enable_hsts=bool(settings.ENABLE_HSTS),
    hsts_max_age=int(settings.HSTS_MAX_AGE),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "X-Requested-With",
    ],
)

app.include_router(api_router)


@app.exception_handler(RequestValidationError)
async def request_validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    if settings.is_production:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": "طلب غير صالح"},
        )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
    )


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_error_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    logger.warning("database error path=%s type=%s", request.url.path, type(exc).__name__)
    if settings.is_production:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "حدث خطأ أثناء معالجة الطلب"},
        )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": str(exc)},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error path=%s", request.url.path)
    if settings.is_production:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "حدث خطأ داخلي"},
        )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": f"{type(exc).__name__}",
            "trace": traceback.format_exc()[-4000:],
        },
    )


@app.get("/")
def root() -> dict[str, str]:
    return {"message": getattr(settings, "PROJECT_NAME", "API")}


@app.get("/health")
def health(request: Request) -> dict[str, str | bool]:
    """Lightweight liveness probe — must stay fast (no YOLO / DB migrations)."""
    payload: dict[str, str | bool] = {
        "status": "ok",
        "db": bool(getattr(request.app.state, "db_ready", False)),
        "runtime_host": str(getattr(request.app.state, "runtime_host", database_host_from_url(settings.DATABASE_URL))),
        "bootstrap_host": str(
            getattr(request.app.state, "bootstrap_host", database_host_from_url(settings.DATABASE_BOOTSTRAP_URL))
        ),
    }
    if not payload["db"]:
        err = getattr(request.app.state, "db_last_error", None)
        if err:
            payload["db_error"] = str(err)[:240]
    return payload
