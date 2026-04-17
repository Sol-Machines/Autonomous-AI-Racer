"""
Path Controller — PID steering with bang-bang output.

Takes the car's current pose and track geometry, produces binary control
commands (forward/reverse/left/right) compatible with the Shell Racing
BLE protocol.

Uses a rolling accumulator to convert continuous PID output into
duty-cycled binary steering commands.
"""

import logging
import math
import time

log = logging.getLogger("path_controller")

ZERO_CONTROL = dict(
    forward=0, reverse=0, left=0, right=0,
    lights=0, turbo=0, donut=0,
)


class PID:
    def __init__(self, kp: float, ki: float, kd: float, limit: float = 1.0):
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.limit = limit
        self._integral = 0.0
        self._prev_error = 0.0
        self._prev_time = 0.0

    def reset(self):
        self._integral = 0.0
        self._prev_error = 0.0
        self._prev_time = 0.0

    def update(self, error: float) -> float:
        now = time.monotonic()
        dt = now - self._prev_time if self._prev_time > 0 else 0.05
        dt = max(0.001, min(dt, 0.5))

        self._integral += error * dt
        # Anti-windup
        self._integral = max(-self.limit, min(self.limit, self._integral))

        derivative = (error - self._prev_error) / dt

        output = self.kp * error + self.ki * self._integral + self.kd * derivative
        output = max(-self.limit, min(self.limit, output))

        self._prev_error = error
        self._prev_time = now
        return output


class PathController:
    def __init__(self):
        # Lateral PID: corrects distance from centerline
        self._lateral_pid = PID(kp=4.0, ki=0.5, kd=1.0)
        # Heading PID: corrects heading error
        self._heading_pid = PID(kp=2.0, ki=0.2, kd=0.5)

        # Bang-bang accumulator for steering duty cycle
        self._steer_accum = 0.0

        # State
        self._active = False
        self._emergency_stopped = False
        self._stop_reason = ""
        self._lap_count = 0
        self._last_progress = 0.0
        self._crossed_start = False

        # Thresholds
        self._max_lateral_error = 0.30  # stop forward if > 30cm off center
        self._emergency_distance = 0.60  # emergency stop if > 60cm off center
        self._confidence_threshold = 0.3
        self._low_confidence_start = 0.0

    def start(self):
        self._active = True
        self._emergency_stopped = False
        self._stop_reason = ""
        self._lap_count = 0
        self._last_progress = 0.0
        self._crossed_start = False
        self._steer_accum = 0.0
        self._lateral_pid.reset()
        self._heading_pid.reset()
        log.info("Path controller started")

    def stop(self):
        self._active = False
        self._lateral_pid.reset()
        self._heading_pid.reset()
        log.info("Path controller stopped")

    def get_status(self) -> dict:
        return {
            "active": self._active,
            "emergency_stopped": self._emergency_stopped,
            "stop_reason": self._stop_reason,
            "lap_count": self._lap_count,
        }

    def compute(
        self,
        car_x: float,
        car_z: float,
        car_heading: float,
        confidence: float,
        track_info: dict | None,
    ) -> dict:
        """
        Compute the next control command.

        track_info: result from TrackManager.nearest_point() or None.
        Returns: dict(forward, reverse, left, right, lights, turbo, donut)
        """
        if not self._active or self._emergency_stopped:
            return dict(ZERO_CONTROL)

        # Safety: check VO confidence
        if confidence < self._confidence_threshold:
            if self._low_confidence_start == 0:
                self._low_confidence_start = time.monotonic()
            elif time.monotonic() - self._low_confidence_start > 0.5:
                self._emergency_stop("VO confidence too low")
                return dict(ZERO_CONTROL)
        else:
            self._low_confidence_start = 0.0

        if track_info is None:
            self._emergency_stop("No track data")
            return dict(ZERO_CONTROL)

        lateral_error = track_info["lateral_error"]
        track_heading = track_info["heading"]
        distance = track_info["distance"]
        progress = track_info["progress"]

        # Emergency stop: too far from track
        if distance > self._emergency_distance:
            self._emergency_stop(f"Too far from track: {distance:.2f}m")
            return dict(ZERO_CONTROL)

        # Lap counting
        self._update_lap_count(progress)

        # Heading error (normalize to [-pi, pi])
        heading_error = track_heading - car_heading
        heading_error = math.atan2(math.sin(heading_error), math.cos(heading_error))

        # PID outputs
        lateral_signal = self._lateral_pid.update(lateral_error)
        heading_signal = self._heading_pid.update(heading_error)

        # Blend: heading is primary, lateral is corrective
        steer_signal = 0.6 * heading_signal + 0.4 * lateral_signal
        steer_signal = max(-1.0, min(1.0, steer_signal))

        # Bang-bang conversion via accumulator
        left, right = self._bang_bang_steer(steer_signal)

        # Speed control
        forward = 1
        if abs(lateral_error) > self._max_lateral_error:
            forward = 0  # stop until back on track
        elif abs(steer_signal) > 0.7:
            # Slow down in turns: 50% duty cycle on forward
            forward = 1 if (int(time.monotonic() * 20) % 2 == 0) else 0

        return dict(
            forward=forward,
            reverse=0,
            left=left,
            right=right,
            lights=1,
            turbo=0,
            donut=0,
        )

    def _bang_bang_steer(self, signal: float) -> tuple[int, int]:
        """Convert continuous signal to binary L/R via duty-cycle accumulator."""
        self._steer_accum += signal

        left = 0
        right = 0
        if self._steer_accum > 0.5:
            left = 1
            self._steer_accum -= 1.0
        elif self._steer_accum < -0.5:
            right = 1
            self._steer_accum += 1.0

        # Clamp accumulator
        self._steer_accum = max(-2.0, min(2.0, self._steer_accum))
        return left, right

    def _emergency_stop(self, reason: str):
        self._emergency_stopped = True
        self._stop_reason = reason
        self._active = False
        log.warning("EMERGENCY STOP: %s", reason)

    def _update_lap_count(self, progress: float):
        # Detect crossing from high progress back to low (lap complete)
        if self._last_progress > 0.9 and progress < 0.1:
            if self._crossed_start:
                self._lap_count += 1
                log.info("Lap %d completed", self._lap_count)
            self._crossed_start = True
        self._last_progress = progress
