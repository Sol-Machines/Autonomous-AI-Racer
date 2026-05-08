from __future__ import annotations

import logging

import cv2
import numpy as np

from .base import SteeringIntent

log = logging.getLogger("perception.opencv")


class OpenCVLineFollower:
    """Threshold-and-centroid black-tape line follower.

    The frame is converted to grayscale, thresholded so the tape becomes
    white on a black background, and the horizontal centroid of the
    bottom-of-frame ROI is computed. The horizontal offset of that
    centroid from the image centre drives the left/right decision.
    """

    name = "opencv"

    def __init__(
        self,
        threshold: int = 80,
        roi_top: float = 0.55,
        deadband: float = 0.12,
        min_tape_pixels: int = 200,
    ):
        self.threshold = int(threshold)
        self.roi_top = float(roi_top)
        self.deadband = float(deadband)
        self.min_tape_pixels = int(min_tape_pixels)

    def predict(self, frame_bgr: np.ndarray) -> SteeringIntent:
        if frame_bgr is None or frame_bgr.size == 0:
            return SteeringIntent.stop("empty frame")

        h, w = frame_bgr.shape[:2]
        roi_y = int(h * self.roi_top)
        roi = frame_bgr[roi_y:, :]

        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        # Tape is dark → invert so tape pixels are white (255) for moments.
        _, binary = cv2.threshold(
            gray, self.threshold, 255, cv2.THRESH_BINARY_INV,
        )

        tape_pixels = int(binary.sum() // 255)
        if tape_pixels < self.min_tape_pixels:
            return SteeringIntent.stop(f"no tape ({tape_pixels}px)")

        moments = cv2.moments(binary)
        if moments["m00"] == 0:
            return SteeringIntent.stop("zero moment")

        cx = moments["m10"] / moments["m00"]
        # Normalised offset in [-1, 1]; negative = tape is to the left.
        offset = (cx - w / 2) / (w / 2)

        forward, left, right = 1, 0, 0
        if offset < -self.deadband:
            left = 1
        elif offset > self.deadband:
            right = 1

        confidence = min(1.0, tape_pixels / (self.min_tape_pixels * 5))
        return SteeringIntent(
            forward=forward,
            reverse=0,
            left=left,
            right=right,
            confidence=confidence,
            reason=f"offset={offset:+.2f} pix={tape_pixels}",
        )
