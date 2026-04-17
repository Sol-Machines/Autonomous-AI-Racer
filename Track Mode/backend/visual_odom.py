"""
Monocular Visual Odometry — floor-plane homography approach.

Consumes camera frames (MJPEG stream from go2rtc or snapshot polling),
extracts ORB features, computes inter-frame homography on the floor plane,
and decomposes it into scaled 2D translation + rotation using the known
camera height above the floor.

After calibration, poses are returned in ZapBox WebXR coordinates.
"""

import asyncio
import logging
import math
import os
import threading
import time

import cv2
import numpy as np

log = logging.getLogger("visual_odom")

PI_IP = os.getenv("PI_IP", "172.20.10.2")
GO2RTC_PORT = int(os.getenv("GO2RTC_PORT", "1984"))
CAMERA_HEIGHT_CM = float(os.getenv("CAMERA_HEIGHT_CM", "9.0"))
CAMERA_TILT_DEG = float(os.getenv("CAMERA_TILT_DEG", "15.0"))
VO_TARGET_FPS = int(os.getenv("VO_TARGET_FPS", "20"))

PROCESS_W, PROCESS_H = 320, 240

# Pi Camera v3 (IMX708) approximate intrinsics scaled to 320x240
_FX = 290.0
_FY = 290.0
_CX = 160.0
_CY = 120.0

MIN_MATCHES = 15
MIN_INLIER_RATIO = 0.3


class VisualOdometry:
    def __init__(self):
        self._orb = cv2.ORB_create(nfeatures=2000)
        self._bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)

        self._K = np.array([
            [_FX, 0, _CX],
            [0, _FY, _CY],
            [0, 0, 1],
        ], dtype=np.float64)
        self._K_inv = np.linalg.inv(self._K)

        self._camera_height = CAMERA_HEIGHT_CM / 100.0
        self._camera_tilt = math.radians(CAMERA_TILT_DEG)

        # VO state (in VO-local frame)
        self._x = 0.0
        self._z = 0.0
        self._heading = 0.0  # radians, 0 = initial forward direction

        # Calibration transform (VO-local -> ZapBox)
        self._calibrated = False
        self._cal_cos = 1.0
        self._cal_sin = 0.0
        self._cal_tx = 0.0
        self._cal_tz = 0.0

        # Previous frame data
        self._prev_gray = None
        self._prev_kp = None
        self._prev_desc = None

        # Stats
        self._confidence = 0.0
        self._fps = 0.0
        self._feature_count = 0
        self._frame_count = 0
        self._last_update = 0.0

        # Threading
        self._lock = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None
        self._stream_url = (
            f"http://{PI_IP}:{GO2RTC_PORT}/api/stream.mjpeg?src=camera"
        )

    # ---- public API ----

    def get_pose(self) -> dict:
        """Return current pose in ZapBox coordinates (or VO-local if uncalibrated)."""
        with self._lock:
            if self._calibrated:
                zx = self._cal_cos * self._x - self._cal_sin * self._z + self._cal_tx
                zz = self._cal_sin * self._x + self._cal_cos * self._z + self._cal_tz
                zh = self._heading + math.atan2(self._cal_sin, self._cal_cos)
            else:
                zx, zz, zh = self._x, self._z, self._heading
            return {
                "x": round(zx, 4),
                "z": round(zz, 4),
                "heading": round(zh, 4),
                "confidence": round(self._confidence, 3),
                "calibrated": self._calibrated,
            }

    def set_origin(self, zapbox_x: float, zapbox_z: float, zapbox_heading: float):
        """
        Calibrate: set the car's current position in ZapBox coordinates.
        The VO pose is reset to (0, 0, 0) and a rigid transform is stored.
        """
        with self._lock:
            self._x = 0.0
            self._z = 0.0
            self._heading = 0.0

            self._cal_cos = math.cos(zapbox_heading)
            self._cal_sin = math.sin(zapbox_heading)
            self._cal_tx = zapbox_x
            self._cal_tz = zapbox_z
            self._calibrated = True

        log.info(
            "Calibrated: zapbox=(%.3f, %.3f) heading=%.1f deg",
            zapbox_x, zapbox_z, math.degrees(zapbox_heading),
        )

    def get_confidence(self) -> float:
        with self._lock:
            return self._confidence

    def get_status(self) -> dict:
        with self._lock:
            return {
                "running": self._running,
                "calibrated": self._calibrated,
                "confidence": round(self._confidence, 3),
                "fps": round(self._fps, 1),
                "feature_count": self._feature_count,
                "frame_count": self._frame_count,
            }

    def apply_track_correction(self, nearest_x: float, nearest_z: float, weight: float = 0.1):
        """
        Bias the VO position toward a known track point to mitigate drift.
        Called when the car is marginally outside the track.
        `weight` controls correction strength (0 = none, 1 = snap).
        The correction is applied in ZapBox space and back-projected to VO space.
        """
        with self._lock:
            if not self._calibrated:
                return
            # Current position in ZapBox space
            zx = self._cal_cos * self._x - self._cal_sin * self._z + self._cal_tx
            zz = self._cal_sin * self._x + self._cal_cos * self._z + self._cal_tz
            # Blend toward nearest track point
            corrected_zx = zx + weight * (nearest_x - zx)
            corrected_zz = zz + weight * (nearest_z - zz)
            # Back-project to VO space
            dx = corrected_zx - self._cal_tx
            dz = corrected_zz - self._cal_tz
            self._x = self._cal_cos * dx + self._cal_sin * dz
            self._z = -self._cal_sin * dx + self._cal_cos * dz

    def snap_to_start(self):
        """Reset VO pose to origin (lap closure correction)."""
        with self._lock:
            self._x = 0.0
            self._z = 0.0

    # ---- start / stop ----

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        log.info("VO started, stream=%s, target_fps=%d", self._stream_url, VO_TARGET_FPS)

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None
        with self._lock:
            self._prev_gray = None
            self._prev_kp = None
            self._prev_desc = None
            self._confidence = 0.0
        log.info("VO stopped")

    # ---- processing loop (runs in background thread) ----

    def _run_loop(self):
        cap = cv2.VideoCapture(self._stream_url)
        if not cap.isOpened():
            log.error("Cannot open camera stream: %s", self._stream_url)
            self._running = False
            return

        frame_interval = 1.0 / VO_TARGET_FPS
        fps_window: list[float] = []

        try:
            while self._running:
                t0 = time.monotonic()
                ok, frame = cap.read()
                if not ok:
                    log.warning("Frame read failed, retrying...")
                    time.sleep(0.1)
                    continue

                self._process_frame(frame)

                elapsed = time.monotonic() - t0
                fps_window.append(elapsed)
                if len(fps_window) > 30:
                    fps_window.pop(0)
                with self._lock:
                    avg = sum(fps_window) / len(fps_window)
                    self._fps = 1.0 / avg if avg > 0 else 0
                    self._last_update = time.monotonic()

                sleep_time = frame_interval - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)
        finally:
            cap.release()

    def _process_frame(self, frame: np.ndarray):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (PROCESS_W, PROCESS_H))

        kp, desc = self._orb.detectAndCompute(gray, None)

        with self._lock:
            self._feature_count = len(kp) if kp is not None else 0
            self._frame_count += 1

            if self._prev_desc is None or desc is None or len(kp) < MIN_MATCHES:
                self._prev_gray = gray
                self._prev_kp = kp
                self._prev_desc = desc
                self._confidence = 0.5 if desc is not None else 0.0
                return

            # Match features
            raw_matches = self._bf.knnMatch(self._prev_desc, desc, k=2)

            # Lowe's ratio test
            good = []
            for pair in raw_matches:
                if len(pair) == 2:
                    m, n = pair
                    if m.distance < 0.75 * n.distance:
                        good.append(m)

            if len(good) < MIN_MATCHES:
                self._confidence = max(0.0, len(good) / MIN_MATCHES * 0.5)
                self._prev_gray = gray
                self._prev_kp = kp
                self._prev_desc = desc
                return

            # Extract matched point coordinates
            pts_prev = np.float32([self._prev_kp[m.queryIdx].pt for m in good])
            pts_curr = np.float32([kp[m.trainIdx].pt for m in good])

            # Compute homography
            H, mask = cv2.findHomography(pts_prev, pts_curr, cv2.RANSAC, 3.0)

            if H is None:
                self._confidence = 0.2
                self._prev_gray = gray
                self._prev_kp = kp
                self._prev_desc = desc
                return

            inliers = int(mask.sum()) if mask is not None else 0
            inlier_ratio = inliers / len(good)

            if inlier_ratio < MIN_INLIER_RATIO:
                self._confidence = 0.3
                self._prev_gray = gray
                self._prev_kp = kp
                self._prev_desc = desc
                return

            # Decompose homography to get 2D motion on the floor plane
            dx, dz, dtheta = self._decompose_floor_homography(H)

            # Apply rotation then translation in the car's current heading frame
            cos_h = math.cos(self._heading)
            sin_h = math.sin(self._heading)
            self._x += cos_h * dz - sin_h * dx
            self._z += sin_h * dz + cos_h * dx
            self._heading += dtheta

            # Normalize heading to [-pi, pi]
            self._heading = math.atan2(
                math.sin(self._heading), math.cos(self._heading)
            )

            self._confidence = min(1.0, inlier_ratio * 1.2)

            self._prev_gray = gray
            self._prev_kp = kp
            self._prev_desc = desc

    def _decompose_floor_homography(self, H: np.ndarray) -> tuple[float, float, float]:
        """
        Decompose a floor-plane homography into (dx, dz, dtheta).
        Uses the known camera height and tilt to recover absolute scale.
        """
        # H maps points on the floor from prev frame to current frame.
        # For a camera looking at a plane at height h with tilt angle alpha:
        # The rotation component gives heading change.
        # The translation component, scaled by camera height, gives displacement.

        # Normalize H so H[2,2] = 1
        H = H / H[2, 2]

        # Decompose using OpenCV
        num, Rs, Ts, normals = cv2.decomposeHomographyMat(H, self._K)

        if num == 0:
            return 0.0, 0.0, 0.0

        # Pick the solution where the normal points roughly upward (floor normal)
        best_idx = 0
        best_score = -1.0
        floor_normal = np.array([0, -1, 0])  # camera sees floor below

        for i in range(num):
            if normals[i] is not None:
                n = normals[i].flatten()
                score = abs(np.dot(n, floor_normal))
                if score > best_score:
                    best_score = score
                    best_idx = i

        R = Rs[best_idx]
        T = Ts[best_idx].flatten()

        # Extract yaw rotation (around Y axis) from rotation matrix
        dtheta = math.atan2(R[0, 2], R[0, 0])

        # Scale translation by camera height
        # T is a unit vector; actual displacement = T * d, where d relates to camera height
        t_norm = np.linalg.norm(T)
        if t_norm < 1e-8:
            return 0.0, 0.0, dtheta

        T_scaled = T * self._camera_height / max(abs(T[1]), 1e-6)

        dx = T_scaled[0]  # lateral
        dz = T_scaled[2]  # forward

        # Sanity clamp: single frame shouldn't move more than ~5cm
        max_step = 0.05
        dx = max(-max_step, min(max_step, dx))
        dz = max(-max_step, min(max_step, dz))
        dtheta = max(-0.15, min(0.15, dtheta))

        return dx, dz, dtheta
