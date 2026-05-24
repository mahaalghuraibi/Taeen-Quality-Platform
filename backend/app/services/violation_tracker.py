"""
Production-grade violation tracker for live monitoring.

Goals (v1.0 — original):
- Multi-frame confirmation per (camera, violation_type, person_index) with TTL.
- Auto-expire stale streaks so a violation that disappeared can be re-confirmed cleanly.
- Per-camera + per-type + per-person cooldown to suppress duplicate DB alerts
  without hitting the database every frame.

New in v1.5 (this file):
- Per-key rolling confidence history (`_StreakState.confidence_history`) →
  exposes `smoothed_confidence` (mean of last N frames).
- Optional gate `min_smoothed_confidence`: confirmation also requires the
  rolling mean to clear a threshold — kills "flicker" alerts where confidence
  jumps 30/80/30/80.
- Repeated-offender tracking (`_offender_log`) — counts confirmed alerts per
  (tenant, camera, person_index, vtype) within a sliding window.
- Smart priority (`priority_for`) — combines smoothed confidence + repeat
  count + violation-type weight to return one of:
    "low" | "medium" | "high" | "critical".
- AI-health metrics integration: every confirmed alert increments a counter
  exposed via `metrics_snapshot()`.

All state is process-local. Restarting the API resets streaks, cooldowns and
offender history — this is intentional: DB-level dedup in `_has_recent_duplicate`
is the durable safety net.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque

# ── Public knobs (tunable from the monitoring route if needed) ──────────────
# 2 consecutive frames is the sweet spot: filters out single-frame flickers while
# still firing within ~6–10 s of a sustained violation (live frames ~3–5 s apart).
DEFAULT_STREAK_REQUIRED = 2
DEFAULT_COOLDOWN_SECONDS = 90
# A streak entry older than this without a hit is reset.
DEFAULT_STREAK_TTL_SECONDS = 25

# Rolling window for per-key confidence smoothing.
DEFAULT_CONFIDENCE_HISTORY = 5
# When set (0–100), confirmation also requires `smoothed_confidence` ≥ this.
# 0 disables the smoothed gate (legacy behaviour).
DEFAULT_MIN_SMOOTHED_CONF = 0

# Sliding window for "repeated offender" counting.
DEFAULT_OFFENDER_WINDOW_SECONDS = 30 * 60  # 30 minutes

# Hard cap on tracker state to avoid unbounded growth in long-running processes.
_MAX_KEYS = 4096

# Severity weights per violation type (higher = more important).
# Used by `priority_for`; tweakable without touching the route.
_VTYPE_WEIGHT: dict[str, int] = {
    "wet_floor":            5,
    "trash_on_floor":       4,
    "improper_waste_area":  3,
    "trash_wrong_location": 3,
    "no_mask":              4,
    "no_gloves":            3,
    "no_headcover":         3,
    "improper_uniform":     2,
    "no_person_in_zone":    1,
    "unclear_camera_angle": 1,
}
_VTYPE_DEFAULT_WEIGHT = 2


def _now() -> float:
    return time.monotonic()


def _norm_vtype(vtype: str) -> str:
    return (vtype or "").strip().lower()


@dataclass
class _StreakState:
    count: int = 0
    last_seen: float = field(default_factory=_now)
    last_confidence: int = 0
    confidence_history: Deque[int] = field(default_factory=lambda: deque(maxlen=DEFAULT_CONFIDENCE_HISTORY))

    def smoothed(self) -> float:
        """Mean of the rolling confidence window. 0.0 when empty."""
        if not self.confidence_history:
            return 0.0
        return sum(self.confidence_history) / len(self.confidence_history)


# Key types for clarity.
_StreakKey = tuple[int, int | None, str, int | None]   # (tenant, camera, vtype, person_index)
_OffenderKey = tuple[int, int | None, int | None, str]  # (tenant, camera, person_index, vtype)


class ViolationTracker:
    """Thread-safe streak + cooldown + offender + smart-priority tracker."""

    def __init__(
        self,
        *,
        streak_required: int = DEFAULT_STREAK_REQUIRED,
        cooldown_seconds: int = DEFAULT_COOLDOWN_SECONDS,
        streak_ttl_seconds: int = DEFAULT_STREAK_TTL_SECONDS,
        confidence_history: int = DEFAULT_CONFIDENCE_HISTORY,
        min_smoothed_confidence: int = DEFAULT_MIN_SMOOTHED_CONF,
        offender_window_seconds: int = DEFAULT_OFFENDER_WINDOW_SECONDS,
    ) -> None:
        self._streak_required = max(1, int(streak_required))
        self._cooldown_seconds = max(0, int(cooldown_seconds))
        self._streak_ttl_seconds = max(self._cooldown_seconds // 8 or 5, int(streak_ttl_seconds))
        self._history_size = max(1, int(confidence_history))
        self._min_smoothed_conf = max(0, min(100, int(min_smoothed_confidence)))
        self._offender_window_seconds = max(60, int(offender_window_seconds))

        self._lock = threading.Lock()
        self._streaks: dict[_StreakKey, _StreakState] = {}
        self._cooldowns: dict[_StreakKey, float] = {}
        # Sliding window of confirmation timestamps per offender slot.
        self._offender_log: dict[_OffenderKey, Deque[float]] = {}

        # Lightweight metrics exposed to the AI-health endpoint.
        self._metrics_lock = threading.Lock()
        self._total_registers: int = 0
        self._total_confirmed: int = 0
        self._total_suppressed_by_cooldown: int = 0
        self._total_suppressed_by_streak: int = 0
        self._total_suppressed_by_smoothing: int = 0
        self._priority_counter: dict[str, int] = {
            "low": 0, "medium": 0, "high": 0, "critical": 0,
        }

    # ── Properties ──────────────────────────────────────────────────────────
    @property
    def streak_required(self) -> int:
        return self._streak_required

    @property
    def cooldown_seconds(self) -> int:
        return self._cooldown_seconds

    @property
    def offender_window_seconds(self) -> int:
        return self._offender_window_seconds

    # ── Internal keys ───────────────────────────────────────────────────────
    def _key(
        self,
        tenant_id: int,
        camera_id: int | None,
        vtype: str,
        person_index: int | None,
    ) -> _StreakKey:
        return (int(tenant_id), camera_id, _norm_vtype(vtype), person_index)

    def _offender_key(
        self,
        tenant_id: int,
        camera_id: int | None,
        person_index: int | None,
        vtype: str,
    ) -> _OffenderKey:
        return (int(tenant_id), camera_id, person_index, _norm_vtype(vtype))

    # ── State pruning ───────────────────────────────────────────────────────
    def _prune_locked(self, now_ts: float) -> None:
        """Drop stale streak/cooldown entries to keep state bounded."""
        if len(self._streaks) > _MAX_KEYS:
            ttl = self._streak_ttl_seconds * 4
            stale = [k for k, st in self._streaks.items() if now_ts - st.last_seen > ttl]
            for k in stale:
                self._streaks.pop(k, None)
        if len(self._cooldowns) > _MAX_KEYS:
            window = self._cooldown_seconds * 4
            stale_cd = [k for k, t in self._cooldowns.items() if now_ts - t > window]
            for k in stale_cd:
                self._cooldowns.pop(k, None)
        if len(self._offender_log) > _MAX_KEYS:
            cutoff = now_ts - (self._offender_window_seconds * 2)
            stale_of = [
                k for k, dq in self._offender_log.items()
                if not dq or dq[-1] < cutoff
            ]
            for k in stale_of:
                self._offender_log.pop(k, None)

    def _purge_offender_window(self, dq: Deque[float], now_ts: float) -> None:
        """Drop offender timestamps older than the configured window."""
        cutoff = now_ts - self._offender_window_seconds
        while dq and dq[0] < cutoff:
            dq.popleft()

    # ── Streak resets ───────────────────────────────────────────────────────
    def reset_absent_types(
        self,
        tenant_id: int,
        camera_id: int | None,
        current_vtypes: set[str],
    ) -> None:
        """Reset streaks for this camera whose violation type isn't in the current frame.

        Streak TTL also handles dropped frames implicitly, but explicit reset on
        absence prevents an old violation from accidentally reaching threshold across
        an unrelated future hit hours later.
        """
        now_ts = _now()
        norm = {_norm_vtype(v) for v in current_vtypes if v}
        with self._lock:
            for k in list(self._streaks.keys()):
                kt, kcam, vt, _pi = k
                if kt != tenant_id or kcam != camera_id:
                    continue
                if vt in norm:
                    continue
                self._streaks.pop(k, None)
            self._prune_locked(now_ts)

    # ── Main register loop ──────────────────────────────────────────────────
    def register(
        self,
        *,
        tenant_id: int,
        camera_id: int | None,
        vtype: str,
        person_index: int | None,
        confidence: int,
    ) -> tuple[int, bool]:
        """Record a fresh detection (legacy two-tuple return, backward compatible).

        Returns (current_streak_count, confirmed_this_frame).
        `confirmed_this_frame` is True only when the streak has just reached
        the required threshold, smoothed-confidence gate (if enabled) is satisfied,
        AND no cooldown is active.
        """
        info = self.register_detailed(
            tenant_id=tenant_id,
            camera_id=camera_id,
            vtype=vtype,
            person_index=person_index,
            confidence=confidence,
        )
        return info["streak"], info["confirmed"]

    def register_detailed(
        self,
        *,
        tenant_id: int,
        camera_id: int | None,
        vtype: str,
        person_index: int | None,
        confidence: int,
    ) -> dict:
        """Verbose variant of `register()` returning a dict with smoothing + priority info.

        Keys returned:
          - streak (int)
          - confirmed (bool)
          - smoothed_confidence (float, 0..100)
          - last_confidence (int)
          - reason (str): "ok" | "below_streak" | "cooldown" | "below_smoothing"
          - offender_count (int): number of confirmed alerts for this offender slot
                                  in the past `offender_window_seconds`. 0 when
                                  not confirmed this frame.
          - priority (str): "low" | "medium" | "high" | "critical"
          - severity_score (int): underlying numeric score (used for sorting).
        """
        with self._metrics_lock:
            self._total_registers += 1

        if not vtype:
            return {
                "streak": 0, "confirmed": False, "smoothed_confidence": 0.0,
                "last_confidence": 0, "reason": "no_vtype",
                "offender_count": 0, "priority": "low", "severity_score": 0,
            }

        key = self._key(tenant_id, camera_id, vtype, person_index)
        now_ts = _now()
        conf_int = max(0, min(100, int(confidence or 0)))

        with self._lock:
            self._prune_locked(now_ts)
            st = self._streaks.get(key)
            if st is None or (now_ts - st.last_seen) > self._streak_ttl_seconds:
                st = _StreakState(
                    count=0,
                    last_seen=now_ts,
                    last_confidence=0,
                    confidence_history=deque(maxlen=self._history_size),
                )
            st.count += 1
            st.last_seen = now_ts
            st.last_confidence = conf_int
            st.confidence_history.append(conf_int)
            self._streaks[key] = st

            smoothed = st.smoothed()

            # 1) streak gate
            if st.count < self._streak_required:
                with self._metrics_lock:
                    self._total_suppressed_by_streak += 1
                return {
                    "streak": st.count, "confirmed": False,
                    "smoothed_confidence": smoothed, "last_confidence": conf_int,
                    "reason": "below_streak",
                    "offender_count": 0,
                    "priority": "low", "severity_score": 0,
                }

            # 2) smoothed-confidence gate (anti-flicker)
            if self._min_smoothed_conf and smoothed < self._min_smoothed_conf:
                with self._metrics_lock:
                    self._total_suppressed_by_smoothing += 1
                return {
                    "streak": st.count, "confirmed": False,
                    "smoothed_confidence": smoothed, "last_confidence": conf_int,
                    "reason": "below_smoothing",
                    "offender_count": 0,
                    "priority": "low", "severity_score": 0,
                }

            # 3) cooldown gate
            last_alerted = self._cooldowns.get(key, 0.0)
            if last_alerted and (now_ts - last_alerted) < self._cooldown_seconds:
                with self._metrics_lock:
                    self._total_suppressed_by_cooldown += 1
                return {
                    "streak": st.count, "confirmed": False,
                    "smoothed_confidence": smoothed, "last_confidence": conf_int,
                    "reason": "cooldown",
                    "offender_count": 0,
                    "priority": "low", "severity_score": 0,
                }

            # All gates clear → confirm.
            self._cooldowns[key] = now_ts
            st.count = 0  # reset streak so we don't double-fire on next frame
            with self._metrics_lock:
                self._total_confirmed += 1

            ok = self._offender_key(tenant_id, camera_id, person_index, vtype)
            dq = self._offender_log.setdefault(ok, deque())
            self._purge_offender_window(dq, now_ts)
            dq.append(now_ts)
            offender_count = len(dq)

        priority, severity_score = self._compute_priority(
            vtype=vtype, smoothed=smoothed, offender_count=offender_count,
        )
        with self._metrics_lock:
            self._priority_counter[priority] = self._priority_counter.get(priority, 0) + 1

        return {
            "streak": self._streak_required,
            "confirmed": True,
            "smoothed_confidence": smoothed,
            "last_confidence": conf_int,
            "reason": "ok",
            "offender_count": offender_count,
            "priority": priority,
            "severity_score": severity_score,
        }

    # ── Cooldown helpers ────────────────────────────────────────────────────
    def under_cooldown(
        self,
        *,
        tenant_id: int,
        camera_id: int | None,
        vtype: str,
        person_index: int | None,
    ) -> bool:
        key = self._key(tenant_id, camera_id, vtype, person_index)
        now_ts = _now()
        with self._lock:
            t = self._cooldowns.get(key, 0.0)
        return bool(t) and (now_ts - t) < self._cooldown_seconds

    # ── Repeated-offender helpers ───────────────────────────────────────────
    def offender_count(
        self,
        *,
        tenant_id: int,
        camera_id: int | None,
        person_index: int | None,
        vtype: str,
    ) -> int:
        """Confirmed alerts for this (tenant, camera, person, vtype) in the
        last `offender_window_seconds`. Does not mutate state."""
        key = self._offender_key(tenant_id, camera_id, person_index, vtype)
        now_ts = _now()
        with self._lock:
            dq = self._offender_log.get(key)
            if dq is None:
                return 0
            self._purge_offender_window(dq, now_ts)
            return len(dq)

    # ── Smart priority ──────────────────────────────────────────────────────
    def priority_for(
        self,
        *,
        vtype: str,
        smoothed_confidence: float,
        offender_count: int,
    ) -> tuple[str, int]:
        """Public helper exposing the same priority logic used by `register_detailed`."""
        return self._compute_priority(
            vtype=vtype,
            smoothed=float(smoothed_confidence or 0.0),
            offender_count=int(offender_count or 0),
        )

    @staticmethod
    def _compute_priority(
        *, vtype: str, smoothed: float, offender_count: int,
    ) -> tuple[str, int]:
        """Combine type weight + smoothed confidence + repeat count → tier.

        Score = type_weight × confidence_factor × repeat_factor.
        Buckets:
          score <  4 → low
          score <  8 → medium
          score < 14 → high
          score >= 14 → critical
        """
        weight = _VTYPE_WEIGHT.get(_norm_vtype(vtype), _VTYPE_DEFAULT_WEIGHT)

        # Confidence factor: 1.0 at 50%, 1.5 at 75%, 2.0 at 100%.
        conf_factor = 1.0 + max(0.0, min(50.0, (smoothed - 50.0))) / 50.0

        # Repeat factor: 1× for first, 1.3× for second, 1.6× for 3-4, 2.0× for 5+.
        if offender_count <= 1:
            repeat_factor = 1.0
        elif offender_count == 2:
            repeat_factor = 1.3
        elif offender_count <= 4:
            repeat_factor = 1.6
        else:
            repeat_factor = 2.0

        score = int(round(weight * conf_factor * repeat_factor))
        # Buckets tuned so:
        #   - any single hit on a weight≤2 class with avg confidence stays "low/medium".
        #   - a sustained repeat (5+) on a weight-4 class (mask/trash) hits "critical".
        #   - a single hit on a weight-5 class (wet_floor) at high confidence is "high".
        if score < 4:
            return "low", score
        if score < 7:
            return "medium", score
        if score < 12:
            return "high", score
        return "critical", score

    # ── Metrics for /ai/health ──────────────────────────────────────────────
    def metrics_snapshot(self) -> dict:
        """Return a JSON-safe snapshot of tracker counters."""
        with self._metrics_lock:
            return {
                "total_registers": self._total_registers,
                "total_confirmed": self._total_confirmed,
                "suppressed_by_streak": self._total_suppressed_by_streak,
                "suppressed_by_smoothing": self._total_suppressed_by_smoothing,
                "suppressed_by_cooldown": self._total_suppressed_by_cooldown,
                "priority_counts": dict(self._priority_counter),
            }

    # ── Reset ───────────────────────────────────────────────────────────────
    def reset(self) -> None:
        with self._lock:
            self._streaks.clear()
            self._cooldowns.clear()
            self._offender_log.clear()
        with self._metrics_lock:
            self._total_registers = 0
            self._total_confirmed = 0
            self._total_suppressed_by_cooldown = 0
            self._total_suppressed_by_streak = 0
            self._total_suppressed_by_smoothing = 0
            self._priority_counter = {"low": 0, "medium": 0, "high": 0, "critical": 0}


# Module-level default tracker reused by the monitoring route.
default_tracker = ViolationTracker()
