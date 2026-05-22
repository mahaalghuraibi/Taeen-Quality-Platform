"""
Production-grade violation tracker for live monitoring.

Goals:
- Multi-frame confirmation per (camera, violation_type, person_index) with TTL.
- Auto-expire stale streaks so a violation that disappeared can be re-confirmed cleanly.
- Per-camera + per-type + per-person cooldown to suppress duplicate DB alerts
  without hitting the database every frame.
- Lightweight: pure in-memory, thread-safe, no external dependencies.

All state is process-local. Restarting the API resets streaks and cooldowns —
this is intentional: DB-level dedup in `_has_recent_duplicate` is the durable safety net.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

# Public knobs (tunable from monitoring route if needed)
# 2 consecutive frames is the sweet spot: filters out single-frame flickers while
# still firing within ~6–10 s of a sustained violation (live frames ~3–5 s apart).
DEFAULT_STREAK_REQUIRED = 2
DEFAULT_COOLDOWN_SECONDS = 90
# A streak entry older than this without a hit is reset.
DEFAULT_STREAK_TTL_SECONDS = 25
# Hard cap on tracker state to avoid unbounded growth in long-running processes.
_MAX_KEYS = 4096


def _now() -> float:
    return time.monotonic()


@dataclass
class _StreakState:
    count: int = 0
    last_seen: float = field(default_factory=_now)
    last_confidence: int = 0


class ViolationTracker:
    """Thread-safe streak + cooldown tracker keyed by (camera, vtype, person_index)."""

    def __init__(
        self,
        *,
        streak_required: int = DEFAULT_STREAK_REQUIRED,
        cooldown_seconds: int = DEFAULT_COOLDOWN_SECONDS,
        streak_ttl_seconds: int = DEFAULT_STREAK_TTL_SECONDS,
    ) -> None:
        self._streak_required = max(1, int(streak_required))
        self._cooldown_seconds = max(0, int(cooldown_seconds))
        self._streak_ttl_seconds = max(self._cooldown_seconds // 8 or 5, int(streak_ttl_seconds))
        self._lock = threading.Lock()
        self._streaks: dict[tuple[int, int | None, str, int | None], _StreakState] = {}
        self._cooldowns: dict[tuple[int, int | None, str, int | None], float] = {}

    @property
    def streak_required(self) -> int:
        return self._streak_required

    @property
    def cooldown_seconds(self) -> int:
        return self._cooldown_seconds

    def _key(
        self,
        tenant_id: int,
        camera_id: int | None,
        vtype: str,
        person_index: int | None,
    ) -> tuple[int, int | None, str, int | None]:
        return (int(tenant_id), camera_id, vtype.strip().lower(), person_index)

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
        norm = {v.strip().lower() for v in current_vtypes if v}
        with self._lock:
            for k in list(self._streaks.keys()):
                kt, kcam, vt, _pi = k
                if kt != tenant_id or kcam != camera_id:
                    continue
                if vt in norm:
                    continue
                self._streaks.pop(k, None)
            self._prune_locked(now_ts)

    def register(
        self,
        *,
        tenant_id: int,
        camera_id: int | None,
        vtype: str,
        person_index: int | None,
        confidence: int,
    ) -> tuple[int, bool]:
        """Record a fresh detection.

        Returns (current_streak_count, confirmed_this_frame).
        `confirmed_this_frame` is True only when the streak has just reached
        the required threshold AND no cooldown is active.
        """
        if not vtype:
            return 0, False

        key = self._key(tenant_id, camera_id, vtype, person_index)
        now_ts = _now()
        with self._lock:
            self._prune_locked(now_ts)
            st = self._streaks.get(key)
            if st is None or (now_ts - st.last_seen) > self._streak_ttl_seconds:
                st = _StreakState(count=0, last_seen=now_ts, last_confidence=0)
            st.count += 1
            st.last_seen = now_ts
            st.last_confidence = max(st.last_confidence, int(confidence or 0))
            self._streaks[key] = st

            if st.count < self._streak_required:
                return st.count, False

            # Confirmed by streak — check cooldown before signalling new alert.
            last_alerted = self._cooldowns.get(key, 0.0)
            if last_alerted and (now_ts - last_alerted) < self._cooldown_seconds:
                return st.count, False

            self._cooldowns[key] = now_ts
            # Reset streak after firing so we don't double-fire on next frame.
            st.count = 0
            return self._streak_required, True

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

    def reset(self) -> None:
        with self._lock:
            self._streaks.clear()
            self._cooldowns.clear()


# Module-level default tracker reused by the monitoring route.
default_tracker = ViolationTracker()
