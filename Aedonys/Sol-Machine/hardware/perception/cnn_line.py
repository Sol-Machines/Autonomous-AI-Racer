from __future__ import annotations

import logging
import os
from pathlib import Path

import cv2
import numpy as np

from .base import SteeringIntent

log = logging.getLogger("perception.cnn")

# Must match training/train.py
IMG_W, IMG_H = 64, 48
_CLASSES = ["left", "straight", "right"]


class CNNLineFollower:
    """TorchScript line-follower CNN.

    Loads the model exported by training/train.py and runs inference on
    the lower ROI of each frame. Output is one of three classes:
    left / straight / right.
    """

    name = "cnn"

    def __init__(
        self,
        weights_path: str | Path,
        roi_top: float = 0.55,
        deadband: float = 0.12,
    ):
        self.roi_top  = float(roi_top)
        self.deadband = float(deadband)
        path = Path(os.path.expanduser(str(weights_path)))

        if not path.exists():
            raise FileNotFoundError(
                f"CNN weights not found: {path}\n"
                "Run training/collect.py then training/train.py, "
                "or switch back to PERCEPTION_BACKEND=opencv."
            )

        try:
            import torch
        except ImportError:
            raise ImportError(
                "PyTorch is required for PERCEPTION_BACKEND=cnn.\n"
                "Install it: pip install torch"
            )

        self._torch = torch
        self._model = torch.jit.load(str(path), map_location="cpu")
        self._model.eval()
        log.info("CNNLineFollower: loaded %s", path)

    def predict(self, frame_bgr: np.ndarray) -> SteeringIntent:
        if frame_bgr is None or frame_bgr.size == 0:
            return SteeringIntent.stop("empty frame")

        torch = self._torch
        h, w  = frame_bgr.shape[:2]
        roi   = frame_bgr[int(h * self.roi_top):, :]
        gray  = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (IMG_W, IMG_H))

        # Normalize to [-1, 1] — matches training preprocessing
        x      = (small.astype(np.float32) / 255.0 - 0.5) / 0.5
        tensor = torch.from_numpy(x).unsqueeze(0).unsqueeze(0)  # (1, 1, H, W)

        with torch.no_grad():
            logits = self._model(tensor)
            probs  = torch.softmax(logits, dim=1)[0]
            pred   = int(probs.argmax().item())
            conf   = float(probs[pred].item())

        label   = _CLASSES[pred]
        forward = 1
        left    = 1 if pred == 0 else 0
        right   = 1 if pred == 2 else 0

        return SteeringIntent(
            forward=forward,
            reverse=0,
            left=left,
            right=right,
            confidence=conf,
            reason=f"cnn={label} p={conf:.2f}",
        )
