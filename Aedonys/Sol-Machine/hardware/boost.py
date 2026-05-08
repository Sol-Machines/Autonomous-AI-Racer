from __future__ import annotations

import logging
import time
from dataclasses import dataclass

log = logging.getLogger("boost")


@dataclass(frozen=True)
class BoostEvent:
    """A single boost trigger — emitted by the Solana listener or a
    manual override. `duration_s` is the requested turbo duration."""

    duration_s: float
    source: str = "unknown"   # "solana" | "manual" | "test"
    tx_signature: str | None = None


class BoostManager:
    """Holds a single `expires_at` timestamp.

    `is_active()` decides whether byte 6 (turbo) should be 1 in this 20 Hz
    tick. Triggering during an active boost extends the timer rather than
    queueing a separate event — keeps the mechanic simple for v1.
    """

    def __init__(self, default_duration_s: float = 3.0):
        self.default_duration_s = float(default_duration_s)
        self._expires_at = 0.0

    def trigger(self, event: BoostEvent | None = None) -> float:
        duration = event.duration_s if event else self.default_duration_s
        now = time.monotonic()
        new_expiry = max(self._expires_at, now) + duration
        self._expires_at = new_expiry
        log.info(
            "Boost triggered: +%.1fs (source=%s, total remaining=%.1fs)",
            duration,
            event.source if event else "default",
            new_expiry - now,
        )
        return new_expiry

    def is_active(self) -> bool:
        return time.monotonic() < self._expires_at

    def remaining(self) -> float:
        return max(0.0, self._expires_at - time.monotonic())

    def clear(self) -> None:
        self._expires_at = 0.0
