from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class SteeringIntent:
    """One perception tick's recommended action.

    forward/reverse/left/right are 0|1 — they map directly to the BLE
    control bytes. `confidence` is in [0,1]; the control loop falls back
    to "hold" when confidence is too low.
    """

    forward: int = 0
    reverse: int = 0
    left: int = 0
    right: int = 0
    confidence: float = 0.0
    reason: str = ""

    @classmethod
    def stop(cls, reason: str = "no signal") -> "SteeringIntent":
        return cls(reason=reason)


class Perception(Protocol):
    """Protocol every perception backend implements.

    Implementations are constructed once (loading models, reading config)
    and called repeatedly with fresh BGR frames. They must be cheap enough
    to run at PERCEPTION_HZ.
    """

    name: str

    def predict(self, frame_bgr: np.ndarray) -> SteeringIntent: ...
