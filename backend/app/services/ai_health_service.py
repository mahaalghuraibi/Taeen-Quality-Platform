"""
AI Health Monitor — production observability for the live YOLO pipeline.

Tracks (process-local, thread-safe):
  - Inference latency (rolling window, p50 / p95 / mean).
  - Effective FPS per camera and overall.
  - Dropped frames (live-mode busy slot rejections).
  - Model loading state (path, size, loaded_at, last_error).
  - Tracker metrics (confirmed alerts, priority breakdown, suppression reasons).

Exposed to operators via `GET /api/v1/ai/health` (admin/supervisor only).

All state resets on process restart — this is intentional. Long-term metrics
should be exported to an external time-series store (Prometheus, Datadog) when
the platform graduates to enterprise monitoring (see AI_ROADMAP_AR.md v3.0).
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Deque

# Rolling window for latency / fps statistics.
_LATENCY_WINDOW = 200
_FPS_WINDOW = 60  # last 60 inference completions per camera

# Healthy / degraded / unhealthy thresholds (tuned for CPU-bound YOLO on 1280px frames).
LATENCY_HEALTHY_MS = 1500
LATENCY_DEGRADED_MS = 4000
DROP_RATIO_DEGRADED = 0.15
DROP_RATIO_UNHEALTHY = 0.35
MIN_HEALTHY_FPS = 0.30


def _now() -> float:
    return time.monotonic()


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    if pct <= 0:
        return s[0]
    if pct >= 100:
        return s[-1]
    k = (len(s) - 1) * pct / 100.0
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


@dataclass
class _ModelState:
    name: str
    path: str
    loaded: bool = False
    loaded_at: float | None = None
    size_bytes: int | None = None
    load_attempts: int = 0
    last_error: str | None = None
    last_error_at: float | None = None


@dataclass
class _CameraStats:
    last_frame_at: float | None = None
    frame_completed_ts: Deque[float] = field(default_factory=lambda: deque(maxlen=_FPS_WINDOW))
    inference_count: int = 0
    dropped_count: int = 0
    error_count: int = 0


class AIHealthMonitor:
    """Process-local, thread-safe AI runtime health metrics."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latencies_ms: Deque[float] = deque(maxlen=_LATENCY_WINDOW)
        self._global_completed_ts: Deque[float] = deque(maxlen=_FPS_WINDOW * 4)
        self._cameras: dict[str, _CameraStats] = defaultdict(_CameraStats)

        self._models: dict[str, _ModelState] = {}

        self._global_inference_count: int = 0
        self._global_dropped_count: int = 0
        self._global_error_count: int = 0
        self._slot_wait_total_ms: float = 0.0
        self._slot_wait_samples: int = 0

        self._service_started_at: float = _now()

    # ── Inference recording (called from yolo_monitoring_service) ───────────
    def record_inference(
        self,
        *,
        camera_key: str | None,
        latency_ms: float,
        slot_wait_ms: float | None = None,
    ) -> None:
        camera_key = (camera_key or "—").strip() or "—"
        now_ts = _now()
        with self._lock:
            self._latencies_ms.append(float(latency_ms))
            self._global_completed_ts.append(now_ts)
            self._global_inference_count += 1
            cam = self._cameras[camera_key]
            cam.last_frame_at = now_ts
            cam.frame_completed_ts.append(now_ts)
            cam.inference_count += 1
            if slot_wait_ms is not None:
                self._slot_wait_total_ms += float(slot_wait_ms)
                self._slot_wait_samples += 1

    def record_dropped(self, *, camera_key: str | None, reason: str = "busy") -> None:
        camera_key = (camera_key or "—").strip() or "—"
        with self._lock:
            self._global_dropped_count += 1
            self._cameras[camera_key].dropped_count += 1

    def record_error(self, *, camera_key: str | None) -> None:
        camera_key = (camera_key or "—").strip() or "—"
        with self._lock:
            self._global_error_count += 1
            self._cameras[camera_key].error_count += 1

    # ── Model lifecycle ─────────────────────────────────────────────────────
    def record_model_loaded(
        self,
        *,
        name: str,
        path: str,
        size_bytes: int | None = None,
    ) -> None:
        with self._lock:
            st = self._models.get(name) or _ModelState(name=name, path=path)
            st.path = path
            st.loaded = True
            st.loaded_at = _now()
            st.size_bytes = size_bytes
            st.load_attempts += 1
            st.last_error = None
            st.last_error_at = None
            self._models[name] = st

    def record_model_load_failed(
        self,
        *,
        name: str,
        path: str,
        error: str,
    ) -> None:
        with self._lock:
            st = self._models.get(name) or _ModelState(name=name, path=path)
            st.path = path
            st.loaded = False
            st.load_attempts += 1
            st.last_error = (error or "")[:300]
            st.last_error_at = _now()
            self._models[name] = st

    # ── Computed views ──────────────────────────────────────────────────────
    def _fps_from(self, ts_window: Deque[float], now_ts: float, span_seconds: float = 60.0) -> float:
        if not ts_window:
            return 0.0
        cutoff = now_ts - span_seconds
        recent = [t for t in ts_window if t >= cutoff]
        if len(recent) < 2:
            return 0.0
        elapsed = recent[-1] - recent[0]
        if elapsed <= 0:
            return 0.0
        return (len(recent) - 1) / elapsed

    def _classify(self, *, latency_p95: float, drop_ratio: float, models_ok: bool) -> str:
        if not models_ok:
            return "unhealthy"
        if latency_p95 >= LATENCY_DEGRADED_MS or drop_ratio >= DROP_RATIO_UNHEALTHY:
            return "unhealthy"
        if latency_p95 >= LATENCY_HEALTHY_MS or drop_ratio >= DROP_RATIO_DEGRADED:
            return "degraded"
        return "healthy"

    def snapshot(self) -> dict:
        """Return JSON-safe metrics snapshot."""
        now_ts = _now()
        with self._lock:
            latencies = list(self._latencies_ms)
            global_completed = list(self._global_completed_ts)
            cameras_copy = {k: _CameraStats(
                last_frame_at=v.last_frame_at,
                frame_completed_ts=deque(v.frame_completed_ts),
                inference_count=v.inference_count,
                dropped_count=v.dropped_count,
                error_count=v.error_count,
            ) for k, v in self._cameras.items()}
            models_copy = list(self._models.values())
            global_inf = self._global_inference_count
            global_drop = self._global_dropped_count
            global_err = self._global_error_count
            slot_avg = (self._slot_wait_total_ms / self._slot_wait_samples) if self._slot_wait_samples else 0.0
            uptime_s = max(0.0, now_ts - self._service_started_at)

        latency_p50 = _percentile(latencies, 50)
        latency_p95 = _percentile(latencies, 95)
        latency_mean = (sum(latencies) / len(latencies)) if latencies else 0.0
        global_fps = self._fps_from(deque(global_completed), now_ts)

        total_attempts = global_inf + global_drop
        drop_ratio = (global_drop / total_attempts) if total_attempts else 0.0

        cameras = []
        for key, cs in cameras_copy.items():
            cam_total = cs.inference_count + cs.dropped_count
            cam_drop_ratio = (cs.dropped_count / cam_total) if cam_total else 0.0
            cam_fps = self._fps_from(cs.frame_completed_ts, now_ts)
            seconds_since_last = (now_ts - cs.last_frame_at) if cs.last_frame_at else None
            cameras.append({
                "camera_key": key,
                "inference_count": cs.inference_count,
                "dropped_count": cs.dropped_count,
                "error_count": cs.error_count,
                "drop_ratio": round(cam_drop_ratio, 4),
                "fps": round(cam_fps, 3),
                "seconds_since_last_frame": (
                    round(seconds_since_last, 2) if seconds_since_last is not None else None
                ),
            })
        cameras.sort(key=lambda c: c["camera_key"])

        models = []
        any_failed = False
        for m in models_copy:
            if not m.loaded and m.last_error:
                any_failed = True
            models.append({
                "name": m.name,
                "path": m.path,
                "loaded": m.loaded,
                "loaded_at_seconds_ago": (
                    round(now_ts - m.loaded_at, 1) if m.loaded_at else None
                ),
                "size_bytes": m.size_bytes,
                "load_attempts": m.load_attempts,
                "last_error": m.last_error,
                "last_error_seconds_ago": (
                    round(now_ts - m.last_error_at, 1) if m.last_error_at else None
                ),
            })
        models.sort(key=lambda m: m["name"])

        models_ok = (not any_failed) and (global_fps == 0 or global_fps >= MIN_HEALTHY_FPS or global_inf < 10)
        status = self._classify(
            latency_p95=latency_p95,
            drop_ratio=drop_ratio,
            models_ok=models_ok,
        )

        return {
            "status": status,
            "uptime_seconds": round(uptime_s, 1),
            "inference": {
                "total": global_inf,
                "errors": global_err,
                "dropped": global_drop,
                "drop_ratio": round(drop_ratio, 4),
                "fps_overall": round(global_fps, 3),
                "latency_ms": {
                    "samples": len(latencies),
                    "mean": round(latency_mean, 1),
                    "p50": round(latency_p50, 1),
                    "p95": round(latency_p95, 1),
                    "max": round(max(latencies), 1) if latencies else 0.0,
                },
                "slot_wait_ms_avg": round(slot_avg, 1),
            },
            "cameras": cameras,
            "models": models,
            "thresholds": {
                "latency_healthy_ms": LATENCY_HEALTHY_MS,
                "latency_degraded_ms": LATENCY_DEGRADED_MS,
                "drop_ratio_degraded": DROP_RATIO_DEGRADED,
                "drop_ratio_unhealthy": DROP_RATIO_UNHEALTHY,
                "min_healthy_fps": MIN_HEALTHY_FPS,
            },
        }

    def reset(self) -> None:
        with self._lock:
            self._latencies_ms.clear()
            self._global_completed_ts.clear()
            self._cameras.clear()
            self._models.clear()
            self._global_inference_count = 0
            self._global_dropped_count = 0
            self._global_error_count = 0
            self._slot_wait_total_ms = 0.0
            self._slot_wait_samples = 0
            self._service_started_at = _now()


# Module-level singleton used by the YOLO pipeline + AI health endpoint.
ai_health = AIHealthMonitor()
