#!/usr/bin/env python3
"""
Local AI Agent — عين الجودة (Taeen Quality Platform)
====================================================

Runs YOLO violation detection on RTSP cameras INSIDE the restaurant LAN and
pushes only structured alerts + evidence snapshots to the cloud backend.

Pipeline (per camera, per cycle):
    RTSP frame ─┬─► PPE / person model  (gloves, mask, headcover, uniform)
                └─► environment model   (wet_floor, trash, unclean, blocked, unsafe)
    Both models analyze the SAME frame in the SAME cycle, so one frame can
    produce multiple simultaneous violations.

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
    "improper_uniform": "improper_uniform", "no_uniform": "improper_uniform",
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
    ppe_model: str
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

    return AgentConfig(
        backend_url=str(data.get("backend_url", "")).strip().rstrip("/"),
        agent_api_key=str(data.get("agent_api_key", "")).strip(),
        branch_id=int(data.get("branch_id", 1)),
        cameras=cameras,
        ppe_model=str(models.get("ppe_model", "models/ppe_yolo.pt")).strip(),
        environment_model=str(models.get("environment_model", "models/environment_yolo.pt")).strip(),
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
        self._ppe = None
        self._env = None
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
        ppe_path = Path(self.cfg.ppe_model)
        env_path = Path(self.cfg.environment_model)
        if not ppe_path.is_file():
            raise FileNotFoundError(f"نموذج PPE غير موجود: {ppe_path}")
        if not env_path.is_file():
            raise FileNotFoundError(f"نموذج البيئة غير موجود: {env_path}")
        LOG.info("تحميل النماذج على الجهاز: %s", self.device)
        self._ppe = YOLO(str(ppe_path))
        self._env = YOLO(str(env_path))
        self._loaded = True

    def _run_model(self, model, frame, source: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        results = model.predict(
            frame,
            conf=self.cfg.confidence_threshold,
            device=self.device,
            verbose=False,
        )
        class_map = PPE_VIOLATION_CLASSES if source == "ppe" else ENV_VIOLATION_CLASSES
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
        """Run BOTH models on the SAME frame; merge violations from both."""
        self.load()
        violations: list[dict[str, Any]] = []
        violations.extend(self._run_model(self._ppe, frame, "ppe"))
        violations.extend(self._run_model(self._env, frame, "env"))
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
