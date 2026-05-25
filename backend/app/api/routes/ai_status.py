"""
AI model status + health endpoints.

Reports:
  - Monitoring YOLO model (keremberk_ppe.pt / YOLO_MODEL_PATH) — covers mask, gloves, headcover, uniform.
  - Person detector model (yolov8n.pt / PERSON_MODEL_PATH) — required for PPE geometric validation.
  - Per-image upload violation models (glove_best.pt, hairnet_best.pt) — used by /violations/detect endpoint.
  - Live runtime health: FPS, inference latency, dropped frames, model load state, tracker metrics.
  - Background warmup: trigger first YOLO model load before user clicks "بدء المراقبة".
"""
import logging
import threading
import time
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends

from app.api.deps import get_current_user
from app.api.rbac import require_roles
from app.core.config import settings
from app.models.user import User
from app.services.ai_health_service import ai_health
from app.services.violation_tracker import default_tracker as _violation_tracker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai-status"])

# ── Background warmup state (process-local, single warmup at a time) ──────────
_WARMUP_LOCK = threading.Lock()
_WARMUP_STATE: dict = {
    "status": "idle",        # idle | loading | ready | failed
    "started_at": None,
    "finished_at": None,
    "error": None,
    "model_path": None,
}


def _set_warmup_state(**fields) -> None:
    with _WARMUP_LOCK:
        _WARMUP_STATE.update(fields)


def _warmup_yolo_background() -> None:
    """Run inside a worker thread — load YOLO once so the first analyze-frame is fast."""
    started = time.time()
    _set_warmup_state(status="loading", started_at=started, finished_at=None, error=None)
    try:
        # Local imports keep import time of this module fast (used by readiness probes too).
        from app.services.yolo_model_resolver import resolve_yolo_model_path  # type: ignore
        from app.services.yolo_monitoring_service import _load_yolo  # type: ignore

        model_path = resolve_yolo_model_path(allow_download=True)
        if not model_path:
            _set_warmup_state(
                status="failed",
                finished_at=time.time(),
                error="نموذج YOLO غير متوفر — تحقق من إعدادات النشر.",
            )
            return
        _load_yolo(model_path)  # populates the cache + ai_health model state
        _set_warmup_state(
            status="ready",
            finished_at=time.time(),
            model_path=model_path,
            error=None,
        )
        logger.info("AI warmup complete in %.1fs path=%s", time.time() - started, model_path)
    except Exception as exc:  # noqa: BLE001 — surface details to operators
        logger.exception("AI warmup failed")
        _set_warmup_state(
            status="failed",
            finished_at=time.time(),
            error=f"{type(exc).__name__}: {exc}"[:300],
        )

_MODELS_DIR = Path(__file__).resolve().parents[2] / "ml" / "models"


def _resolve_monitoring_model_path() -> Path | None:
    """Resolve the YOLO monitoring model path from settings or default location."""
    configured = (getattr(settings, "YOLO_MODEL_PATH", "") or "").strip()
    if configured:
        p = Path(configured).expanduser()
        if p.is_file():
            return p
    # Default search order
    for name in ("keremberk_ppe.pt", "hansung_ppe.pt"):
        p = _MODELS_DIR / name
        if p.is_file():
            return p
    return None


def _resolve_person_model_path() -> Path | None:
    configured = (getattr(settings, "PERSON_MODEL_PATH", "") or "").strip()
    if configured:
        p = Path(configured).expanduser()
        if p.is_file():
            return p
    p = _MODELS_DIR / "yolov8n.pt"
    if p.is_file():
        return p
    return None


@router.get(
    "/status",
    dependencies=[Depends(require_roles("supervisor", "admin"))],
    summary="Check which AI models are configured and available on disk",
)
def get_ai_status(current_user: User = Depends(get_current_user)) -> dict:
    monitoring_model_path = _resolve_monitoring_model_path()
    monitoring_configured = monitoring_model_path is not None
    person_model_path = _resolve_person_model_path()
    person_configured = person_model_path is not None
    yolo_use_person = bool(getattr(settings, "YOLO_USE_PERSON_DETECTOR", False))

    # The monitoring YOLO model handles mask/gloves/headcover/uniform in one model.
    # Per-image upload models are separate (glove_best.pt, hairnet_best.pt).
    glove_upload_path = _MODELS_DIR / "glove_best.pt"
    hairnet_upload_path = _MODELS_DIR / "hairnet_best.pt"
    mask_upload_path = _MODELS_DIR / "mask_best.pt"

    # Labels are written for kitchen / food-service supervisors:
    # no model technology names (YOLO / COCO / yolov8n / PPE) are exposed.
    models = [
        {
            "key": "monitoring_yolo",
            "label_ar": "نظام رصد معدات السلامة",
            "configured": monitoring_configured,
            "model_path": str(monitoring_model_path) if monitoring_model_path else None,
            "covers": ["no_gloves", "no_headcover", "no_mask", "improper_uniform"],
            "note": "يفحص الكمامة والقفازات وغطاء الرأس والزي أثناء المراقبة المباشرة.",
        },
        {
            "key": "person_detector",
            "label_ar": "نظام رصد العاملين في الكاميرا",
            "configured": person_configured,
            "enabled": yolo_use_person,
            "model_path": str(person_model_path) if person_model_path else None,
            "note": "يحدد مواقع العاملين أمام الكاميرا لربط المخالفات بكل شخص.",
        },
        {
            "key": "no_gloves",
            "label_ar": "فحص القفازات (الصور)",
            "configured": glove_upload_path.is_file(),
            "model_path": str(glove_upload_path) if glove_upload_path.is_file() else None,
            "note": "يُستخدم عند تحليل صورة مرفوعة من المراقبة.",
        },
        {
            "key": "no_headcover",
            "label_ar": "فحص غطاء الرأس (الصور)",
            "configured": hairnet_upload_path.is_file(),
            "model_path": str(hairnet_upload_path) if hairnet_upload_path.is_file() else None,
            "note": "يُستخدم عند تحليل صورة مرفوعة من المراقبة.",
        },
        {
            "key": "no_mask",
            "label_ar": "فحص الكمامة (الصور)",
            "configured": mask_upload_path.is_file(),
            "model_path": str(mask_upload_path) if mask_upload_path.is_file() else None,
            "note": "يُستخدم عند تحليل صورة مرفوعة من المراقبة.",
        },
        {
            "key": "no_uniform",
            "label_ar": "فحص الزي الرسمي",
            "configured": (_MODELS_DIR / "uniform_best.pt").is_file(),
            "model_path": str(_MODELS_DIR / "uniform_best.pt") if (_MODELS_DIR / "uniform_best.pt").is_file() else None,
            "note": "حالياً: فحص لوني تقريبي للجذع (يحتاج مراجعة) — في انتظار نموذج CCTV مُدرَّب.",
        },
        {
            "key": "trash_on_floor",
            "label_ar": "النفايات على الأرض",
            "configured": (_MODELS_DIR / "trash_best.pt").is_file(),
            "model_path": str(_MODELS_DIR / "trash_best.pt") if (_MODELS_DIR / "trash_best.pt").is_file() else None,
            "note": "حالياً: كشف تقريبي للأجسام الصغيرة على الأرض (يحتاج مراجعة). يحتاج بيانات CCTV لتدريب نموذج موثوق.",
        },
        {
            "key": "wet_floor",
            "label_ar": "أرضية مبللة",
            "configured": (_MODELS_DIR / "wet_floor_best.pt").is_file(),
            "model_path": str(_MODELS_DIR / "wet_floor_best.pt") if (_MODELS_DIR / "wet_floor_best.pt").is_file() else None,
            "note": "حالياً: كشف الانعكاسات اللامعة على الأرض (يحتاج مراجعة). يحتاج بيانات CCTV لتدريب نموذج موثوق.",
        },
    ]

    configured_count = sum(1 for m in models if m["configured"])
    return {
        "models": models,
        "configured_count": configured_count,
        "total_count": len(models),
        "monitoring_model_ready": monitoring_configured,
        "person_detector_ready": person_configured and yolo_use_person,
        "yolo_enabled": bool(getattr(settings, "YOLO_ENABLED", True)),
        "yolo_use_person_detector": yolo_use_person,
    }


@router.post(
    "/warmup",
    dependencies=[Depends(require_roles("supervisor", "admin"))],
    summary="Trigger background YOLO warmup so the first analyze-frame is fast",
)
def post_ai_warmup(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Start a background warmup if one is not already running or completed."""
    _ = current_user  # auth gate only
    with _WARMUP_LOCK:
        st = dict(_WARMUP_STATE)
    if st["status"] == "loading":
        return {"ok": True, "started": False, "status": "loading", "message": "جاري التحميل بالفعل."}
    if st["status"] == "ready":
        return {"ok": True, "started": False, "status": "ready", "message": "النموذج جاهز."}
    background_tasks.add_task(_warmup_yolo_background)
    return {"ok": True, "started": True, "status": "loading", "message": "بدأ تحميل النموذج في الخلفية."}


@router.get(
    "/warmup",
    dependencies=[Depends(require_roles("supervisor", "admin"))],
    summary="Get current YOLO warmup state (idle/loading/ready/failed)",
)
def get_ai_warmup(current_user: User = Depends(get_current_user)) -> dict:
    """Lightweight, non-blocking — safe to poll from the dashboard every 5s."""
    _ = current_user
    with _WARMUP_LOCK:
        st = dict(_WARMUP_STATE)
    duration_s = None
    if st.get("started_at"):
        end = st.get("finished_at") or time.time()
        duration_s = round(end - float(st["started_at"]), 1)

    # Cross-check with ai_health for the actual loaded model state.
    try:
        snap = ai_health.snapshot()
        any_loaded = any(m.get("loaded") for m in snap.get("models") or [])
    except Exception:  # pragma: no cover
        any_loaded = False

    status = st["status"]
    if status == "idle" and any_loaded:
        status = "ready"

    return {
        "status": status,
        "duration_seconds": duration_s,
        "started_at": st.get("started_at"),
        "finished_at": st.get("finished_at"),
        "model_path": st.get("model_path"),
        "error": st.get("error"),
    }


@router.get(
    "/health",
    dependencies=[Depends(require_roles("supervisor", "admin"))],
    summary="Live AI runtime health (FPS, latency, dropped frames, model state, tracker metrics)",
)
def get_ai_health(current_user: User = Depends(get_current_user)) -> dict:
    """Return real-time observability for the YOLO monitoring pipeline.

    Status semantics:
      - "healthy"   → latency p95 < 1.5 s, drop ratio < 15%, models loaded.
      - "degraded"  → latency p95 ≥ 1.5 s OR drop ratio ≥ 15%.
      - "unhealthy" → latency p95 ≥ 4 s OR drop ratio ≥ 35% OR a required model failed to load.
    """
    snapshot = ai_health.snapshot()
    snapshot["tracker"] = {
        "streak_required": _violation_tracker.streak_required,
        "cooldown_seconds": _violation_tracker.cooldown_seconds,
        "offender_window_seconds": _violation_tracker.offender_window_seconds,
        "metrics": _violation_tracker.metrics_snapshot(),
    }
    snapshot["yolo_enabled"] = bool(getattr(settings, "YOLO_ENABLED", True))
    return snapshot
