import os
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parents[2]

load_dotenv(_backend_dir / ".env", override=True)


def _parse_bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    s = str(raw).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off", ""):
        return False
    return default


def prefer_render_internal_database_url(url: str) -> str:
    """On Render, use internal DB hostname (dpg-xxx-a) instead of external regional FQDN."""
    if not url or not url.startswith("postgresql"):
        return url
    on_render = bool(os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID"))
    if not on_render:
        return url
    return re.sub(
        r"@(dpg-[a-z0-9]+-a)\.[^/:]+",
        r"@\1",
        url,
        count=1,
        flags=re.IGNORECASE,
    )


def _strip_url_query_keys(url: str, *keys: str) -> str:
    parsed = urlparse(url)
    if not parsed.query:
        return url
    drop = {k.lower() for k in keys}
    kept = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k.lower() not in drop]
    return urlunparse(parsed._replace(query=urlencode(kept)))


def normalize_database_url(raw: str) -> str:
    """Render/Heroku often supply postgres:// — SQLAlchemy needs postgresql+psycopg2://."""
    url = (raw or "").strip()
    if not url:
        return url
    if url.startswith("postgres://"):
        url = "postgresql+psycopg2://" + url[len("postgres://") :]
    elif url.startswith("postgresql://") and "+psycopg2" not in url.split("://", 1)[0]:
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)

    url = prefer_render_internal_database_url(url)

    # sslmode is applied via psycopg2 connect_args — keep URL clean to avoid conflicts.
    url = _strip_url_query_keys(url, "sslmode")
    return url


class Settings:
    PROJECT_NAME: str = os.getenv("PROJECT_NAME", "Quality Platform API")
    # production | development — controls error detail exposure
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development").strip().lower()
    # Comma-separated origins; empty → dev defaults applied in main.py
    CORS_ALLOW_ORIGINS_RAW: str = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    # Max POST body for monitoring frame analyze (bytes)
    MONITORING_UPLOAD_MAX_BYTES: int = int(os.getenv("MONITORING_UPLOAD_MAX_BYTES", str(8 * 1024 * 1024)))
    _default_sqlite_path: str = (_backend_dir / "test.db").resolve().as_posix()
    _raw_database_url: str = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{_default_sqlite_path}",
    )
    if _raw_database_url.startswith("sqlite:///./"):
        _rel = _raw_database_url.removeprefix("sqlite:///./")
        DATABASE_URL: str = f"sqlite:///{(_backend_dir / _rel).resolve().as_posix()}"
    else:
        DATABASE_URL: str = normalize_database_url(_raw_database_url)
    SECRET_KEY: str = os.getenv("SECRET_KEY", "change-me")
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    DEV_AUTH_BYPASS: bool = _parse_bool_env("DEV_AUTH_BYPASS", False)
    # SQLite only: create first admin if DB has zero users (local dev convenience).
    SEED_DEV_ADMIN: bool = _parse_bool_env("SEED_DEV_ADMIN", True)
    SEED_DEV_SUPERVISOR: bool = _parse_bool_env("SEED_DEV_SUPERVISOR", True)
    SEED_ADMIN_EMAIL: str = os.getenv("SEED_ADMIN_EMAIL", "admin@test.com")
    SEED_ADMIN_PASSWORD: str = os.getenv("SEED_ADMIN_PASSWORD", "admin123")
    SEED_SUPERVISOR_USERNAME: str = os.getenv("SEED_SUPERVISOR_USERNAME", "supervisor")
    SEED_SUPERVISOR_EMAIL: str = os.getenv("SEED_SUPERVISOR_EMAIL", "xjo21000@gmail.com")
    SEED_SUPERVISOR_EMAIL_ALT: str = os.getenv("SEED_SUPERVISOR_EMAIL_ALT", "xjojo2000@outlook.com")
    SEED_SUPERVISOR_EMAIL_ALT2: str = os.getenv("SEED_SUPERVISOR_EMAIL_ALT2", "xhoor2000@outlook.com")
    SEED_SUPERVISOR_PASSWORD: str = os.getenv("SEED_SUPERVISOR_PASSWORD", "123456")
    GOOGLE_VISION_API_KEY: str = os.getenv("GOOGLE_VISION_API_KEY", "")
    ROBOFLOW_API_KEY: str = os.getenv("ROBOFLOW_API_KEY", "")
    ROBOFLOW_API_URL: str = os.getenv("ROBOFLOW_API_URL", "https://serverless.roboflow.com")
    ROBOFLOW_MODEL_ID: str = os.getenv("ROBOFLOW_MODEL_ID", "food-types-po0yz/2")
    ROBOFLOW_FOOD_TYPES_URL: str = os.getenv(
        "ROBOFLOW_FOOD_TYPES_URL",
        "https://serverless.roboflow.com/food-types-po0yz/2",
    )
    # Professional vision stack (image-only; no filename heuristics in classifier)
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_VISION_MODEL: str = os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
    # Shared/legacy Gemini envs (kept for backward compatibility).
    _GEMINI_LEGACY_RAW: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_API_KEY: str = _GEMINI_LEGACY_RAW.strip()
    GEMINI_VISION_MODEL: str = os.getenv("GEMINI_VISION_MODEL", "gemini-2.0-flash")
    # Dish vision: optional dedicated model id (falls back to GEMINI_VISION_MODEL).
    DISH_GEMINI_MODEL: str = os.getenv(
        "DISH_GEMINI_MODEL",
        os.getenv("GEMINI_VISION_MODEL", "gemini-2.0-flash"),
    )
    # Split keys by domain (dish vs monitoring) with safe fallback to legacy key.
    DISH_GEMINI_API_KEY: str = (os.getenv("DISH_GEMINI_API_KEY") or "").strip() or GEMINI_API_KEY
    MONITORING_GEMINI_API_KEY: str = (os.getenv("MONITORING_GEMINI_API_KEY") or "").strip() or GEMINI_API_KEY
    # Monitoring model prefers dedicated env first, then legacy model env.
    MONITORING_GEMINI_MODEL: str = os.getenv(
        "MONITORING_GEMINI_MODEL",
        os.getenv("GEMINI_VISION_MODEL", "gemini-2.0-flash"),
    )
    YOLO_ENABLED: bool = _parse_bool_env("YOLO_ENABLED", True)
    YOLO_MODEL_PATH: str = os.getenv("YOLO_MODEL_PATH", "")
    # Longest image side sent to YOLO (downscale only). Lower = less RAM on Render free tier.
    YOLO_MAX_EDGE: int = max(320, min(1280, int(os.getenv("YOLO_MAX_EDGE", "640"))))
    # Second YOLO for COCO person boxes doubles memory — off by default in production.
    YOLO_USE_PERSON_DETECTOR: bool = _parse_bool_env("YOLO_USE_PERSON_DETECTOR", False)
    # Standard COCO person detector (yolov8n/s); worker localization separate from PPE weights.
    # Default: backend/ml/models/yolov8n.pt if present, else Ultralytics auto-download "yolov8n.pt".
    PERSON_MODEL_PATH: str = os.getenv("PERSON_MODEL_PATH", "").strip()
    # Optional second weights trained on trash / bins / floor litter (improves hygiene alerts).
    YOLO_WASTE_MODEL_PATH: str = os.getenv("YOLO_WASTE_MODEL_PATH", "").strip()
    YOLO_CONF_THRESHOLD: float = float(os.getenv("YOLO_CONF_THRESHOLD", "0.35"))
    FOOD101_HF_MODEL_ID: str = os.getenv("FOOD101_HF_MODEL_ID", "nateraw/vit-base-food101")
    # Optional on-prem 9-class ResNet18 (see ml/custom_food/README.md). Inference only; no auto-train.
    SKA_CUSTOM_FOOD_MODEL_PATH: str = os.getenv("SKA_CUSTOM_FOOD_MODEL_PATH", "")
    SKA_CUSTOM_FOOD_LABEL_MAP_PATH: str = os.getenv("SKA_CUSTOM_FOOD_LABEL_MAP_PATH", "")
    # Permanent dish photos — NOT temp/cache. Render: mount persistent disk to this path.
    # Example: DISH_MEDIA_DIR=/var/data/ska/media/dishes
    DISH_MEDIA_DIR: Path = Path(
        os.getenv("DISH_MEDIA_DIR", str(_backend_dir / "media" / "dishes")),
    ).resolve()
    # Camera monitoring AI (separate from dish Roboflow serverless URL)
    ROBOFLOW_MONITORING_MODEL_URL: str = os.getenv("ROBOFLOW_MONITORING_MODEL_URL", "").strip()
    MONITORING_AI_DEMO_MODE: bool = _parse_bool_env("MONITORING_AI_DEMO_MODE", False)
    MONITORING_IMAGE_DATA_URL_MAX_CHARS: int = int(os.getenv("MONITORING_IMAGE_DATA_URL_MAX_CHARS", "400000"))
    # Production AI mode: stricter validation, real photos only, no demo paths.
    PRODUCTION_AI_MODE: bool = _parse_bool_env("PRODUCTION_AI_MODE", False)
    # Local AI Agent (on-prem YOLO) → backend alert ingestion.
    # Shared secret the agent must send in the X-Agent-Key header. Empty disables the endpoint.
    AGENT_API_KEY: str = os.getenv("AGENT_API_KEY", "").strip()
    # Evidence snapshots pushed by the local agent. Render: mount a persistent disk here.
    AGENT_EVIDENCE_DIR: Path = Path(
        os.getenv("AGENT_EVIDENCE_DIR", str(_backend_dir / "media" / "agent_evidence")),
    ).resolve()
    # Max evidence image size accepted from the agent (decoded bytes).
    AGENT_EVIDENCE_MAX_BYTES: int = int(os.getenv("AGENT_EVIDENCE_MAX_BYTES", str(6 * 1024 * 1024)))
    # Server-side duplicate-alert cooldown (seconds) per camera+violation_type for agent alerts.
    AGENT_ALERT_COOLDOWN_SECONDS: int = int(os.getenv("AGENT_ALERT_COOLDOWN_SECONDS", "60"))
    # TrustedHostMiddleware — comma-separated hosts; empty disables host validation (typical behind nginx).
    ALLOWED_HOSTS_RAW: str = os.getenv("ALLOWED_HOSTS", "").strip()
    # Send Strict-Transport-Security only when the API is reachable exclusively via HTTPS.
    ENABLE_HSTS: bool = _parse_bool_env("ENABLE_HSTS", False)
    HSTS_MAX_AGE: int = int(os.getenv("HSTS_MAX_AGE", "63072000"))

    @property
    def is_production(self) -> bool:
        return str(self.ENVIRONMENT).strip().lower() == "production"

    @property
    def allowed_hosts_list(self) -> list[str]:
        raw = (self.ALLOWED_HOSTS_RAW or "").strip()
        if not raw:
            return []
        return [h.strip() for h in raw.split(",") if h.strip()]

    @property
    def effective_dev_auth_bypass(self) -> bool:
        """Never honor DEV_AUTH_BYPASS in production (privilege escalation guard)."""
        if self.is_production:
            return False
        return bool(self.DEV_AUTH_BYPASS)


settings = Settings()


def validate_settings_for_startup() -> None:
    """Fail fast in production when JWT signing material is unsafe."""
    if not settings.is_production:
        return
    key = (settings.SECRET_KEY or "").strip()
    weak = {"", "change-me", "changeme", "secret", "test", "dev"}
    if len(key) < 32 or key.lower() in weak:
        raise RuntimeError(
            "ENVIRONMENT=production requires SECRET_KEY to be a strong random value (≥32 characters, not a placeholder)."
        )
