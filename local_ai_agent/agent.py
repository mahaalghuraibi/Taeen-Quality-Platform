#!/usr/bin/env python3
"""
Local AI Agent — عين الجودة (Taeen Quality Platform)
====================================================

Runs YOLO violation detection on RTSP cameras INSIDE the restaurant LAN and
pushes only structured alerts + evidence snapshots to the cloud backend.

Pipeline (per camera, per cycle):
    RTSP frame ─┬─► PPE model(s)        (mask, gloves, headcover, … one file each)
                └─► environment model   (wet_floor, trash, unclean, blocked, unsafe)
    All available models analyze the SAME frame in the SAME cycle, so one frame
    can produce multiple simultaneous violations.

    PPE detection supports MULTIPLE single-purpose model files (e.g. mask_best.pt,
    glove_best.pt, hairnet_best.pt) — each is loaded and run on every frame.
    The environment model is OPTIONAL: if environment_yolo.pt is missing the agent
    keeps running with PPE detection only (it never crashes for a missing env model).

Security:
    * RTSP URLs / camera credentials stay in local config.yaml only.
    * Only detection results (+ evidence images) are sent to the backend.
    * Backend auth via X-Agent-Key header (agent_api_key). Use HTTPS backend_url.
    * Per camera+violation cooldown prevents alert spam.

Usage:
    python agent.py                 # run continuously on all cameras
    python agent.py --once          # one detection cycle on all cameras, then exit
    python agent.py --test-camera   # verify each RTSP camera opens + grabs a frame
    python agent.py --test-backend  # verify backend URL + agent_api_key
    python agent.py --config custom.yaml
    python agent.py --gpu-check     # print CUDA / device info and exit
    python agent.py --readiness     # check models, print model.names, write readiness report
"""

from __future__ import annotations

import argparse
import base64
import logging
import signal
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# --- Third-party (see requirements.txt) -------------------------------------
try:
    import yaml
except ImportError:  # pragma: no cover - dependency hint
    print("[FATAL] PyYAML غير مثبّت. شغّل: pip install -r requirements.txt", file=sys.stderr)
    raise

try:
    import cv2
except ImportError:  # pragma: no cover
    print("[FATAL] opencv-python غير مثبّت. شغّل: pip install -r requirements.txt", file=sys.stderr)
    raise

try:
    import requests
except ImportError:  # pragma: no cover
    print("[FATAL] requests غير مثبّت. شغّل: pip install -r requirements.txt", file=sys.stderr)
    raise


LOG = logging.getLogger("local_ai_agent")

# Map raw model class names → canonical violation_type understood by the backend.
# Extend freely to match your trained weights' class names.
PPE_VIOLATION_CLASSES: dict[str, str] = {
    "no_gloves": "no_gloves", "no-glove": "no_gloves", "without_gloves": "no_gloves",
    "no_mask": "no_mask", "no-mask": "no_mask", "without_mask": "no_mask",
    "no_headcover": "no_headcover", "no-hardhat": "no_headcover", "no_hat": "no_headcover",
    "no_haircover": "no_headcover", "no_hairnet": "no_headcover",
}
# Uniform model — its own file (uniform_yolo.pt). "uniform_ok" is compliant and
# intentionally NOT mapped, so it never produces an alert.
UNIFORM_VIOLATION_CLASSES: dict[str, str] = {
    "no_uniform": "improper_uniform",
    "improper_uniform": "improper_uniform",
    "wrong_uniform": "improper_uniform",
    "no-uniform": "improper_uniform",
}
ENV_VIOLATION_CLASSES: dict[str, str] = {
    "wet_floor": "wet_floor", "wet-floor": "wet_floor", "water": "wet_floor",
    "trash": "trash_on_floor", "trash_on_floor": "trash_on_floor", "garbage": "trash_on_floor",
    "litter": "trash_on_floor",
    "unclean_area": "unclean_area", "dirty": "unclean_area", "stain": "unclean_area",
    "blocked_path": "blocked_path", "obstacle": "blocked_path", "blocked": "blocked_path",
    "unsafe_area": "unsafe_area", "hazard": "unsafe_area", "unsafe": "unsafe_area",
}

VIOLATION_LABELS_AR: dict[str, str] = {
    "no_gloves": "عدم ارتداء القفازات",
    "no_mask": "عدم ارتداء الكمامة",
    "no_headcover": "عدم ارتداء غطاء الرأس / قبعة الشيف",
    "improper_uniform": "عدم ارتداء الزي الرسمي",
    "wet_floor": "أرضية مبللة",
    "trash_on_floor": "نفايات على الأرض",
    "unclean_area": "منطقة غير نظيفة",
    "blocked_path": "ممر مسدود",
    "unsafe_area": "منطقة غير آمنة",
}

AGENT_VERSION = "1.0.0"

# Shown whenever an optional model file is not present (no crash either way).
ENV_MISSING_MSG = (
    "Environment detection model missing — place environment_yolo.pt to enable "
    "wet floor/trash/unclean detection."
)
UNIFORM_MISSING_MSG_AR = "ضع ملف uniform_yolo.pt لتفعيل كشف الزي الرسمي"
ENV_MISSING_MSG_AR = "ضع ملف environment_yolo.pt لتفعيل مخالفات المكان"

# Default model files shipped with / expected by the local agent (one purpose each).
DEFAULT_PPE_MODELS = [
    "models/mask_best.pt",
    "models/glove_best.pt",
    "models/hairnet_best.pt",
]
DEFAULT_UNIFORM_MODEL = "models/uniform_yolo.pt"
DEFAULT_ENVIRONMENT_MODEL = "models/environment_yolo.pt"

# Violation groups (for readiness coverage math + "missing" reporting).
PPE_CORE_VIOLATIONS = ["no_mask", "no_gloves", "no_headcover"]
UNIFORM_VIOLATIONS = ["improper_uniform"]
ALL_ENV_VIOLATIONS = ["wet_floor", "trash_on_floor", "unclean_area", "blocked_path", "unsafe_area"]
ALL_VIOLATIONS = PPE_CORE_VIOLATIONS + UNIFORM_VIOLATIONS + ALL_ENV_VIOLATIONS

# agent.py lives in <repo>/local_ai_agent/ — reports live in <repo>/reports/.
AGENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = AGENT_DIR.parent
DEFAULT_READINESS_REPORT = REPO_ROOT / "reports" / "LOCAL_YOLO_READINESS_AR.md"


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
@dataclass
class CameraConfig:
    camera_id: int
    zone_id: str
    name: str
    rtsp_url: str


@dataclass
class AgentConfig:
    backend_url: str
    agent_api_key: str
    branch_id: int
    cameras: list[CameraConfig]
    ppe_models: list[str]
    uniform_model: str
    environment_model: str
    confidence_threshold: float = 0.45
    frame_interval_seconds: float = 2.0
    alert_cooldown_seconds: int = 60
    snapshot_dir: str = "snapshots"
    request_timeout_seconds: int = 20
    max_retries: int = 3
    retry_backoff_seconds: float = 5.0
    device: str = "auto"  # auto | cuda | cpu
    log_level: str = "INFO"
    raw: dict[str, Any] = field(default_factory=dict)


def load_config(path: str) -> AgentConfig:
    cfg_path = Path(path)
    if not cfg_path.is_file():
        raise FileNotFoundError(
            f"ملف الإعداد غير موجود: {cfg_path}. انسخ config.example.yaml إلى config.yaml"
        )
    with cfg_path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}

    cams_raw = data.get("cameras") or []
    cameras = [
        CameraConfig(
            camera_id=int(c["camera_id"]),
            zone_id=str(c.get("zone_id", "")).strip(),
            name=str(c.get("name", f"Camera {c.get('camera_id')}")).strip(),
            rtsp_url=str(c["rtsp_url"]).strip(),
        )
        for c in cams_raw
    ]
    models = data.get("models") or {}
    detection = data.get("detection") or {}
    advanced = data.get("advanced") or {}

    # PPE detection supports multiple single-purpose model files (ppe_models).
    # Back-compat: a single legacy `ppe_model` string is still accepted.
    ppe_models_raw = models.get("ppe_models")
    if ppe_models_raw:
        ppe_models = [str(m).strip() for m in ppe_models_raw if str(m).strip()]
    elif models.get("ppe_model"):
        ppe_models = [str(models.get("ppe_model")).strip()]
    else:
        ppe_models = list(DEFAULT_PPE_MODELS)

    return AgentConfig(
        backend_url=str(data.get("backend_url", "")).strip().rstrip("/"),
        agent_api_key=str(data.get("agent_api_key", "")).strip(),
        branch_id=int(data.get("branch_id", 1)),
        cameras=cameras,
        ppe_models=ppe_models,
        uniform_model=str(models.get("uniform_model", DEFAULT_UNIFORM_MODEL)).strip(),
        environment_model=str(models.get("environment_model", DEFAULT_ENVIRONMENT_MODEL)).strip(),
        confidence_threshold=float(detection.get("confidence_threshold", 0.45)),
        frame_interval_seconds=float(detection.get("frame_interval_seconds", 2)),
        alert_cooldown_seconds=int(detection.get("alert_cooldown_seconds", 60)),
        snapshot_dir=str(advanced.get("snapshot_dir", "snapshots")).strip() or "snapshots",
        request_timeout_seconds=int(advanced.get("request_timeout_seconds", 20)),
        max_retries=int(advanced.get("max_retries", 3)),
        retry_backoff_seconds=float(advanced.get("retry_backoff_seconds", 5)),
        device=str(advanced.get("device", "auto")).strip().lower() or "auto",
        log_level=str(advanced.get("log_level", "INFO")).strip().upper() or "INFO",
        raw=data,
    )


def validate_config(cfg: AgentConfig) -> list[str]:
    problems: list[str] = []
    if not cfg.backend_url:
        problems.append("backend_url مفقود.")
    elif not cfg.backend_url.startswith("https://") and "localhost" not in cfg.backend_url and "127.0.0.1" not in cfg.backend_url:
        problems.append("backend_url يجب أن يستخدم HTTPS في الإنتاج.")
    if not cfg.agent_api_key or cfg.agent_api_key == "CHANGE_ME":
        problems.append("agent_api_key غير مضبوط (ما زال CHANGE_ME).")
    if not cfg.cameras:
        problems.append("لا توجد كاميرات معرّفة في cameras.")
    return problems


# ---------------------------------------------------------------------------
# YOLO engine (lazy import so --test-camera / --test-backend work without torch)
# ---------------------------------------------------------------------------
class DetectionEngine:
    """Wraps two Ultralytics YOLO models analyzed on the same frame per cycle."""

    def __init__(self, cfg: AgentConfig):
        self.cfg = cfg
        self.device = "cpu"
        self._ppe_models: list[tuple[str, Any]] = []
        self._uniform = None
        self.uniform_available = False
        self._env = None
        self.env_available = False
        self._loaded = False

    def resolve_device(self) -> str:
        want = self.cfg.device
        try:
            import torch  # noqa: WPS433 (local import by design)

            cuda = torch.cuda.is_available()
        except Exception as exc:  # torch missing or broken
            LOG.warning("تعذّر فحص CUDA (%s) — سيتم استخدام CPU.", exc)
            return "cpu"
        if want == "cpu":
            return "cpu"
        if want == "cuda":
            if not cuda:
                LOG.warning("تم طلب CUDA لكنه غير متاح — التحويل إلى CPU.")
                return "cpu"
            return "cuda"
        # auto
        return "cuda" if cuda else "cpu"

    def gpu_report(self) -> str:
        lines = [f"agent_version={AGENT_VERSION}"]
        try:
            import torch

            lines.append(f"torch={torch.__version__}")
            lines.append(f"cuda_available={torch.cuda.is_available()}")
            if torch.cuda.is_available():
                lines.append(f"cuda_version={torch.version.cuda}")
                lines.append(f"device_count={torch.cuda.device_count()}")
                for i in range(torch.cuda.device_count()):
                    lines.append(f"  gpu[{i}]={torch.cuda.get_device_name(i)}")
            else:
                lines.append("الوضع الحالي: CPU (أبطأ — يكفي لكاميرا واحدة للاختبار).")
        except Exception as exc:
            lines.append(f"torch غير مثبّت أو معطوب: {exc}")
        lines.append(f"selected_device={self.resolve_device()}")
        return "\n".join(lines)

    def load(self) -> None:
        if self._loaded:
            return
        from ultralytics import YOLO  # local import — heavy

        self.device = self.resolve_device()
        LOG.info("تحميل النماذج على الجهاز: %s", self.device)

        # Load every available PPE model (skip missing ones with a warning).
        self._ppe_models = []
        for path_str in self.cfg.ppe_models:
            p = Path(path_str)
            if not p.is_file():
                LOG.warning("نموذج PPE غير موجود (سيتم تخطّيه): %s", p)
                continue
            LOG.info("تحميل نموذج PPE: %s", p.name)
            self._ppe_models.append((p.name, YOLO(str(p))))

        if not self._ppe_models:
            raise FileNotFoundError(
                "لا يوجد أي نموذج PPE متاح. ضع نماذج PPE (mask/glove/hairnet) في مجلد models/."
            )

        # Uniform model is OPTIONAL — never crash if it is missing.
        uniform_path = Path(self.cfg.uniform_model)
        if uniform_path.is_file():
            LOG.info("تحميل نموذج الزي الرسمي: %s", uniform_path.name)
            self._uniform = YOLO(str(uniform_path))
            self.uniform_available = True
        else:
            self._uniform = None
            self.uniform_available = False
            LOG.warning(UNIFORM_MISSING_MSG_AR)

        # Environment model is OPTIONAL — never crash if it is missing.
        env_path = Path(self.cfg.environment_model)
        if env_path.is_file():
            LOG.info("تحميل نموذج البيئة: %s", env_path.name)
            self._env = YOLO(str(env_path))
            self.env_available = True
        else:
            self._env = None
            self.env_available = False
            LOG.warning(ENV_MISSING_MSG)
            LOG.warning(ENV_MISSING_MSG_AR)

        self._loaded = True

    def _run_model(self, model, frame, class_map: dict[str, str]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        results = model.predict(
            frame,
            conf=self.cfg.confidence_threshold,
            device=self.device,
            verbose=False,
        )
        for res in results:
            names = res.names or {}
            for box in res.boxes or []:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                raw_name = str(names.get(cls_id, cls_id)).strip().lower()
                vtype = class_map.get(raw_name)
                if not vtype:
                    continue
                out.append({"violation_type": vtype, "confidence": round(conf * 100, 1)})
        return out

    def detect(self, frame) -> list[dict[str, Any]]:
        """Run ALL available models on the SAME frame; merge their violations."""
        self.load()
        violations: list[dict[str, Any]] = []
        for _name, model in self._ppe_models:
            violations.extend(self._run_model(model, frame, PPE_VIOLATION_CLASSES))
        if self._uniform is not None:
            violations.extend(self._run_model(self._uniform, frame, UNIFORM_VIOLATION_CLASSES))
        if self._env is not None:
            violations.extend(self._run_model(self._env, frame, ENV_VIOLATION_CLASSES))
        # Keep highest confidence per violation_type for this single frame.
        best: dict[str, dict[str, Any]] = {}
        for v in violations:
            vt = v["violation_type"]
            if vt not in best or v["confidence"] > best[vt]["confidence"]:
                best[vt] = v
        return list(best.values())


# ---------------------------------------------------------------------------
# Camera capture
# ---------------------------------------------------------------------------
def open_capture(rtsp_url: str):
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    return cap


def grab_frame(rtsp_url: str):
    cap = open_capture(rtsp_url)
    if not cap.isOpened():
        cap.release()
        return None
    ok, frame = cap.read()
    cap.release()
    return frame if ok else None


def encode_jpeg_base64(frame) -> str | None:
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    if not ok:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def save_snapshot(frame, snapshot_dir: Path, cam: CameraConfig, vtype: str) -> Path | None:
    try:
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        fname = snapshot_dir / f"cam{cam.camera_id}_{vtype}_{ts}.jpg"
        cv2.imwrite(str(fname), frame)
        return fname
    except Exception as exc:
        LOG.warning("تعذّر حفظ اللقطة محلياً: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Backend client
# ---------------------------------------------------------------------------
class BackendClient:
    def __init__(self, cfg: AgentConfig):
        self.cfg = cfg
        self.session = requests.Session()
        self.session.headers.update(
            {"X-Agent-Key": cfg.agent_api_key, "Content-Type": "application/json"}
        )

    def ping(self) -> tuple[bool, str]:
        url = f"{self.cfg.backend_url}/api/v1/local-agent/ping"
        try:
            r = self.session.get(url, timeout=self.cfg.request_timeout_seconds)
        except requests.RequestException as exc:
            return False, f"تعذّر الاتصال: {exc}"
        if r.status_code == 200:
            return True, "الاتصال بالخادم ناجح والمفتاح صحيح."
        if r.status_code == 401:
            return False, "المفتاح غير صحيح (agent_api_key)."
        if r.status_code == 503:
            return False, "الخادم لم يُفعّل AGENT_API_KEY بعد."
        return False, f"رد غير متوقع: HTTP {r.status_code}"

    def send_alerts(self, violations: list[dict[str, Any]]) -> bool:
        if not violations:
            return True
        url = f"{self.cfg.backend_url}/api/v1/local-agent/alerts"
        body = {
            "branch_id": self.cfg.branch_id,
            "agent_version": AGENT_VERSION,
            "violations": violations,
        }
        for attempt in range(1, self.cfg.max_retries + 1):
            try:
                r = self.session.post(url, json=body, timeout=self.cfg.request_timeout_seconds)
                if r.status_code == 200:
                    data = r.json()
                    LOG.info(
                        "أُرسلت التنبيهات: created=%s duplicates=%s rejected=%s",
                        data.get("created"), data.get("duplicates"), data.get("rejected"),
                    )
                    return True
                if r.status_code in (401, 503):
                    LOG.error("رفض الخادم الطلب (HTTP %s) — تحقّق من المفتاح/التفعيل.", r.status_code)
                    return False
                LOG.warning("محاولة %s/%s فشلت: HTTP %s", attempt, self.cfg.max_retries, r.status_code)
            except requests.RequestException as exc:
                LOG.warning("محاولة %s/%s — خطأ شبكة: %s", attempt, self.cfg.max_retries, exc)
            if attempt < self.cfg.max_retries:
                time.sleep(self.cfg.retry_backoff_seconds * attempt)
        LOG.error("تعذّر إرسال التنبيهات بعد %s محاولات — سيُعاد المحاولة في الدورة القادمة.", self.cfg.max_retries)
        return False


# ---------------------------------------------------------------------------
# Cooldown
# ---------------------------------------------------------------------------
class CooldownTracker:
    """Suppress repeated (camera, violation_type) alerts within cooldown window."""

    def __init__(self, cooldown_seconds: int):
        self.cooldown = cooldown_seconds
        self._last: dict[tuple[int, str], float] = {}

    def allow(self, camera_id: int, vtype: str) -> bool:
        now = time.monotonic()
        key = (camera_id, vtype)
        last = self._last.get(key)
        if last is not None and (now - last) < self.cooldown:
            return False
        self._last[key] = now
        return True


# ---------------------------------------------------------------------------
# Core cycle
# ---------------------------------------------------------------------------
def build_alert(cam: CameraConfig, branch_id: int, det: dict[str, Any], evidence_b64: str | None) -> dict[str, Any]:
    vtype = det["violation_type"]
    return {
        "camera_id": cam.camera_id,
        "branch_id": branch_id,
        "zone_id": cam.zone_id,
        "camera_name": cam.name,
        "location": cam.zone_id,
        "violation_type": vtype,
        "label_ar": VIOLATION_LABELS_AR.get(vtype, vtype),
        "confidence": det["confidence"],
        "reason_ar": f"تم الرصد بواسطة الوكيل المحلي في منطقة {cam.zone_id}",
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "evidence_image": evidence_b64,
        "source": "local_ai_agent",
    }


def run_cycle(
    cfg: AgentConfig,
    engine: DetectionEngine,
    client: BackendClient,
    cooldown: CooldownTracker,
) -> int:
    snapshot_dir = Path(cfg.snapshot_dir)
    total_sent = 0
    for cam in cfg.cameras:
        frame = grab_frame(cam.rtsp_url)
        if frame is None:
            LOG.error("الكاميرا [%s] %s: تعذّر قراءة الإطار (تحقّق من RTSP/الشبكة).", cam.camera_id, cam.name)
            continue
        try:
            detections = engine.detect(frame)
        except FileNotFoundError as exc:
            LOG.error("نموذج مفقود: %s", exc)
            return total_sent
        except Exception as exc:
            LOG.exception("فشل التحليل للكاميرا %s: %s", cam.camera_id, exc)
            continue

        if not detections:
            LOG.debug("الكاميرا [%s] %s: لا مخالفات.", cam.camera_id, cam.name)
            continue

        alerts: list[dict[str, Any]] = []
        evidence_b64 = encode_jpeg_base64(frame)
        for det in detections:
            vtype = det["violation_type"]
            if not cooldown.allow(cam.camera_id, vtype):
                LOG.debug("تخطّي %s (ضمن التهدئة) كاميرا %s", vtype, cam.camera_id)
                continue
            save_snapshot(frame, snapshot_dir, cam, vtype)
            alerts.append(build_alert(cam, cfg.branch_id, det, evidence_b64))

        if alerts:
            LOG.info(
                "الكاميرا [%s] %s: %s مخالفة → %s",
                cam.camera_id, cam.name, len(alerts),
                ", ".join(a["violation_type"] for a in alerts),
            )
            if client.send_alerts(alerts):
                total_sent += len(alerts)
    return total_sent


# ---------------------------------------------------------------------------
# Readiness check + report
# ---------------------------------------------------------------------------
def _safe_model_names(path: Path) -> tuple[dict[int, str] | None, str | None]:
    """Return (model.names, None) or (None, error_message) without raising."""
    try:
        from ultralytics import YOLO
    except Exception as exc:  # ultralytics/torch not installed
        return None, f"ultralytics غير مثبّت: {exc}"
    try:
        model = YOLO(str(path))
        return dict(model.names), None
    except Exception as exc:
        return None, str(exc)


def _mapped_violations(names: dict[int, str] | None, class_map: dict[str, str]) -> list[str]:
    """Canonical violation_types a model can produce, derived from its class names."""
    if not names:
        return []
    out: list[str] = []
    for raw in names.values():
        vtype = class_map.get(str(raw).strip().lower())
        if vtype and vtype not in out:
            out.append(vtype)
    return out


def compute_readiness(cfg: AgentConfig, *, inspect: bool = True) -> dict[str, Any]:
    """Inspect configured model files and summarize PPE + environment readiness."""
    ppe_entries: list[dict[str, Any]] = []
    for path_str in cfg.ppe_models:
        p = Path(path_str)
        exists = p.is_file()
        names: dict[int, str] | None = None
        error: str | None = None
        if exists and inspect:
            names, error = _safe_model_names(p)
        ppe_entries.append(
            {
                "path": str(p),
                "name": p.name,
                "exists": exists,
                "names": names,
                "error": error,
                "violations": _mapped_violations(names, PPE_VIOLATION_CLASSES),
            }
        )

    def _single_entry(path_str: str, class_map: dict[str, str]) -> dict[str, Any]:
        p = Path(path_str)
        exists = p.is_file()
        names: dict[int, str] | None = None
        error: str | None = None
        if exists and inspect:
            names, error = _safe_model_names(p)
        return {
            "path": str(p),
            "name": p.name,
            "exists": exists,
            "names": names,
            "error": error,
            "violations": _mapped_violations(names, class_map),
        }

    uniform_entry = _single_entry(cfg.uniform_model, UNIFORM_VIOLATION_CLASSES)
    env_entry = _single_entry(cfg.environment_model, ENV_VIOLATION_CLASSES)

    supported: list[str] = []
    for e in (*ppe_entries, uniform_entry, env_entry):
        for v in e["violations"]:
            if v not in supported:
                supported.append(v)

    ppe_present = sum(1 for e in ppe_entries if e["exists"])
    ppe_covered = [v for v in PPE_CORE_VIOLATIONS if v in supported]
    if ppe_present == 0:
        ppe_status = "not_ready"
    elif len(ppe_covered) >= len(PPE_CORE_VIOLATIONS):
        ppe_status = "ready"
    else:
        ppe_status = "partial"

    uniform_status = "ready" if uniform_entry["exists"] else "not_ready"
    env_status = "ready" if env_entry["exists"] else "not_ready"

    missing = [e["path"] for e in ppe_entries if not e["exists"]]
    if not uniform_entry["exists"]:
        missing.append(uniform_entry["path"])
    if not env_entry["exists"]:
        missing.append(env_entry["path"])

    return {
        "ppe_entries": ppe_entries,
        "uniform_entry": uniform_entry,
        "env_entry": env_entry,
        "supported_violations": supported,
        "ppe_status": ppe_status,
        "uniform_status": uniform_status,
        "env_status": env_status,
        "ppe_covered": ppe_covered,
        "missing": missing,
    }


_STATUS_AR = {
    "ready": "جاهزة ✅",
    "partial": "جاهزة جزئياً ⚠️",
    "not_ready": "غير جاهزة ❌",
}


def render_readiness_report(cfg: AgentConfig, st: dict[str, Any]) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines: list[str] = []
    lines.append("# تقرير جاهزية الوكيل المحلي YOLO — عين الجودة")
    lines.append("")
    lines.append(f"> آخر تحديث: {now} · إصدار الوكيل: {AGENT_VERSION}")
    lines.append("")
    lines.append("## الحالة العامة")
    lines.append("")
    lines.append("| المنظومة | الحالة |")
    lines.append("|---|---|")
    lines.append(f"| كشف معدات الحماية (PPE: كمامة/قفازات/غطاء رأس) | {_STATUS_AR[st['ppe_status']]} |")
    lines.append(f"| كشف الزي الرسمي (Uniform) | {_STATUS_AR[st['uniform_status']]} |")
    lines.append(f"| كشف البيئة/المكان (Environment) | {_STATUS_AR[st['env_status']]} |")
    lines.append("")
    if st["ppe_status"] == "partial":
        covered = "، ".join(VIOLATION_LABELS_AR.get(v, v) for v in st["ppe_covered"]) or "—"
        lines.append(f"- **كشف PPE: جاهز جزئياً** — النماذج المتوفّرة تغطّي: {covered}.")
    if st["uniform_status"] == "not_ready":
        lines.append(f"- **كشف الزي الرسمي: غير جاهز** — {UNIFORM_MISSING_MSG_AR}")
    if st["env_status"] == "not_ready":
        lines.append(f"- **كشف البيئة: غير جاهز** — {ENV_MISSING_MSG_AR}")
        lines.append(f"  - {ENV_MISSING_MSG}")
    lines.append("")

    lines.append("## نماذج PPE")
    lines.append("")
    lines.append("| الملف | موجود | الفئات (model.names) | المخالفات المدعومة |")
    lines.append("|---|---|---|---|")
    for e in st["ppe_entries"]:
        exists = "نعم" if e["exists"] else "لا"
        names = ", ".join(str(v) for v in (e["names"] or {}).values()) if e["names"] else (
            e["error"] or ("—" if e["exists"] else "ملف مفقود")
        )
        viol = "، ".join(VIOLATION_LABELS_AR.get(v, v) for v in e["violations"]) or "—"
        lines.append(f"| `{e['name']}` | {exists} | {names} | {viol} |")
    lines.append("")

    lines.append("## نموذج الزي الرسمي")
    lines.append("")
    uni = st["uniform_entry"]
    if uni["exists"]:
        names = ", ".join(str(v) for v in (uni["names"] or {}).values()) if uni["names"] else (
            uni["error"] or "—"
        )
        viol = "، ".join(VIOLATION_LABELS_AR.get(v, v) for v in uni["violations"]) or "—"
        lines.append(f"- `{uni['name']}` موجود — الفئات: {names}")
        lines.append(f"- المخالفات المدعومة: {viol}")
        lines.append("- ملاحظة: الفئة `uniform_ok` تعني التزاماً ولا تُنشئ تنبيهاً.")
    else:
        lines.append(f"- `{uni['name']}` **غير موجود**.")
        lines.append(f"- {UNIFORM_MISSING_MSG_AR}")
    lines.append("")

    lines.append("## نموذج البيئة")
    lines.append("")
    env = st["env_entry"]
    if env["exists"]:
        names = ", ".join(str(v) for v in (env["names"] or {}).values()) if env["names"] else (
            env["error"] or "—"
        )
        viol = "، ".join(VIOLATION_LABELS_AR.get(v, v) for v in env["violations"]) or "—"
        lines.append(f"- `{env['name']}` موجود — الفئات: {names}")
        lines.append(f"- المخالفات المدعومة: {viol}")
    else:
        lines.append(f"- `{env['name']}` **غير موجود**.")
        lines.append(f"- {ENV_MISSING_MSG_AR}")
        lines.append(f"- {ENV_MISSING_MSG}")
    lines.append("")

    lines.append("## النماذج الناقصة")
    lines.append("")
    if st["missing"]:
        for m in st["missing"]:
            lines.append(f"- `{m}`")
    else:
        lines.append("- لا يوجد — جميع النماذج المُعدّة متوفّرة.")
    lines.append("")

    lines.append("## الملفات المطلوبة لإكمال الجاهزية")
    lines.append("")
    lines.append("ضع الملفات التالية داخل `local_ai_agent/models/`:")
    lines.append("")
    lines.append("| الملف | الغرض | الحالة |")
    lines.append("|---|---|---|")
    for e in st["ppe_entries"]:
        lines.append(f"| `{e['name']}` | كشف PPE | {'متوفّر' if e['exists'] else 'مطلوب'} |")
    lines.append(
        f"| `{uni['name']}` | كشف الزي الرسمي (improper_uniform) | "
        f"{'متوفّر' if uni['exists'] else 'مطلوب (اختياري حالياً)'} |"
    )
    lines.append(
        f"| `{env['name']}` | كشف البيئة (أرضية مبللة/نفايات/اتساخ/ممر مسدود/منطقة خطرة) | "
        f"{'متوفّر' if env['exists'] else 'مطلوب (اختياري حالياً)'} |"
    )
    lines.append("")

    lines.append("## المخالفات المدعومة حالياً")
    lines.append("")
    if st["supported_violations"]:
        for v in st["supported_violations"]:
            lines.append(f"- {VIOLATION_LABELS_AR.get(v, v)} (`{v}`)")
    else:
        lines.append("- لا توجد مخالفات مدعومة بعد — لم يُحمَّل أي نموذج.")
    lines.append("")

    lines.append("## المخالفات غير المدعومة بعد")
    lines.append("")
    not_supported = [
        v for v in ALL_VIOLATIONS
        if v not in st["supported_violations"]
    ]
    if not_supported:
        for v in not_supported:
            lines.append(f"- {VIOLATION_LABELS_AR.get(v, v)} (`{v}`)")
    else:
        lines.append("- لا يوجد — جميع المخالفات مدعومة.")
    lines.append("")
    return "\n".join(lines)


def write_readiness_report(cfg: AgentConfig, st: dict[str, Any], out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(render_readiness_report(cfg, st), encoding="utf-8")
    return out_path


def run_readiness(cfg: AgentConfig, out_path: Path) -> int:
    LOG.info("فحص جاهزية النماذج المحلية ...")
    st = compute_readiness(cfg, inspect=True)

    # Print model.names for every available model (test loading).
    for e in st["ppe_entries"]:
        if not e["exists"]:
            LOG.warning("PPE [%s]: ملف مفقود → %s", e["name"], e["path"])
        elif e["error"]:
            LOG.error("PPE [%s]: تعذّر التحميل → %s", e["name"], e["error"])
        else:
            LOG.info("PPE [%s] model.names = %s", e["name"], e["names"])

    uni = st["uniform_entry"]
    if not uni["exists"]:
        LOG.warning(UNIFORM_MISSING_MSG_AR)
    elif uni["error"]:
        LOG.error("Uniform [%s]: تعذّر التحميل → %s", uni["name"], uni["error"])
    else:
        LOG.info("Uniform [%s] model.names = %s", uni["name"], uni["names"])

    env = st["env_entry"]
    if not env["exists"]:
        LOG.warning(ENV_MISSING_MSG)
        LOG.warning(ENV_MISSING_MSG_AR)
    elif env["error"]:
        LOG.error("Environment [%s]: تعذّر التحميل → %s", env["name"], env["error"])
    else:
        LOG.info("Environment [%s] model.names = %s", env["name"], env["names"])

    LOG.info(
        "حالة PPE: %s | الزي الرسمي: %s | البيئة: %s",
        st["ppe_status"], st["uniform_status"], st["env_status"],
    )
    report = write_readiness_report(cfg, st, out_path)
    LOG.info("تمت كتابة تقرير الجاهزية: %s", report)
    return 0


# ---------------------------------------------------------------------------
# Test modes
# ---------------------------------------------------------------------------
def test_cameras(cfg: AgentConfig) -> int:
    rc = 0
    for cam in cfg.cameras:
        LOG.info("اختبار الكاميرا [%s] %s ...", cam.camera_id, cam.name)
        frame = grab_frame(cam.rtsp_url)
        if frame is None:
            LOG.error("  ✗ فشل فتح/قراءة الكاميرا %s", cam.camera_id)
            rc = 1
        else:
            h, w = frame.shape[:2]
            LOG.info("  ✓ نجح — حجم الإطار %sx%s", w, h)
    return rc


def test_backend(cfg: AgentConfig) -> int:
    client = BackendClient(cfg)
    ok, msg = client.ping()
    if ok:
        LOG.info("✓ %s", msg)
        return 0
    LOG.error("✗ %s", msg)
    return 1


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
_STOP = False


def _handle_signal(signum, _frame):
    global _STOP
    _STOP = True
    LOG.info("تم استلام إشارة الإيقاف (%s) — إنهاء بعد الدورة الحالية...", signum)


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="عين الجودة — الوكيل المحلي YOLO")
    parser.add_argument("--config", default="config.yaml", help="مسار ملف الإعداد")
    parser.add_argument("--once", action="store_true", help="دورة واحدة ثم الخروج")
    parser.add_argument("--test-camera", action="store_true", help="اختبار كاميرات RTSP")
    parser.add_argument("--test-backend", action="store_true", help="اختبار الاتصال بالخادم والمفتاح")
    parser.add_argument("--gpu-check", action="store_true", help="عرض معلومات CUDA/الجهاز")
    parser.add_argument(
        "--readiness",
        action="store_true",
        help="فحص النماذج وطباعة model.names وكتابة تقرير الجاهزية",
    )
    parser.add_argument(
        "--readiness-out",
        default=str(DEFAULT_READINESS_REPORT),
        help="مسار تقرير الجاهزية (افتراضي: reports/LOCAL_YOLO_READINESS_AR.md)",
    )
    args = parser.parse_args(argv)

    try:
        cfg = load_config(args.config)
    except FileNotFoundError as exc:
        print(f"[FATAL] {exc}", file=sys.stderr)
        return 2

    setup_logging(cfg.log_level)

    if args.gpu_check:
        print(DetectionEngine(cfg).gpu_report())
        return 0

    if args.readiness:
        return run_readiness(cfg, Path(args.readiness_out))

    if args.test_camera:
        return test_cameras(cfg)

    if args.test_backend:
        problems = [p for p in validate_config(cfg) if "agent_api_key" in p or "backend_url" in p]
        for p in problems:
            LOG.warning("إعداد: %s", p)
        return test_backend(cfg)

    problems = validate_config(cfg)
    if problems:
        for p in problems:
            LOG.error("إعداد غير صالح: %s", p)
        return 2

    LOG.info("بدء الوكيل المحلي v%s — كاميرات: %s | فترة الإطار: %ss",
             AGENT_VERSION, len(cfg.cameras), cfg.frame_interval_seconds)

    engine = DetectionEngine(cfg)
    LOG.info("معلومات الجهاز:\n%s", engine.gpu_report())
    client = BackendClient(cfg)
    cooldown = CooldownTracker(cfg.alert_cooldown_seconds)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    if args.once:
        sent = run_cycle(cfg, engine, client, cooldown)
        LOG.info("اكتملت الدورة الواحدة — أُرسلت %s مخالفة.", sent)
        return 0

    while not _STOP:
        start = time.monotonic()
        try:
            run_cycle(cfg, engine, client, cooldown)
        except Exception as exc:
            LOG.exception("خطأ غير متوقع في الدورة: %s", exc)
        elapsed = time.monotonic() - start
        sleep_for = max(0.0, cfg.frame_interval_seconds - elapsed)
        # Sleep in small steps so SIGINT is responsive.
        slept = 0.0
        while slept < sleep_for and not _STOP:
            time.sleep(min(0.5, sleep_for - slept))
            slept += 0.5

    LOG.info("تم إيقاف الوكيل المحلي بنجاح.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
