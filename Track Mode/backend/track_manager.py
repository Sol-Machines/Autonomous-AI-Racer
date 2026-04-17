"""
Track Manager — stores the virtual track and provides geometry queries.

The track is a closed 2D centerline with a configurable half-width.
All coordinates are in ZapBox WebXR floor space (x, z at y=0).
"""

import logging
import math

import numpy as np
from scipy.interpolate import splprep, splev

log = logging.getLogger("track_manager")

DEFAULT_HALF_WIDTH = 0.15  # meters
MIN_TRACK_LENGTH = 1.0
MIN_TURN_RADIUS = 0.10
CLOSE_THRESHOLD = 0.05  # auto-close if endpoints within 5cm


class TrackManager:
    def __init__(self):
        self.raw_points: list[tuple[float, float]] = []
        self.centerline: np.ndarray | None = None  # (N, 2) smoothed
        self.half_width: float = DEFAULT_HALF_WIDTH
        self.closed: bool = False
        self.valid: bool = False
        self._tangents: np.ndarray | None = None  # (N, 2) unit tangent at each point
        self._cumlen: np.ndarray | None = None  # cumulative arc length

    def set_points(self, points: list[dict]):
        """Set raw track centerline points from ZapBox [{x, z}, ...]."""
        self.raw_points = [(p["x"], p["z"]) for p in points]
        self.closed = False
        self.valid = False
        self.centerline = None
        self._tangents = None
        self._cumlen = None
        log.info("Track set: %d raw points", len(self.raw_points))

    def set_width(self, half_width: float):
        self.half_width = max(0.05, min(1.0, half_width))
        log.info("Track half-width set to %.3fm", self.half_width)

    def clear(self):
        self.raw_points = []
        self.centerline = None
        self.closed = False
        self.valid = False
        self._tangents = None
        self._cumlen = None
        log.info("Track cleared")

    def validate(self) -> dict:
        """
        Validate the track. Returns {valid: bool, errors: [str], warnings: [str]}.
        If valid, builds the smoothed centerline and tangent arrays.
        """
        errors: list[str] = []
        warnings: list[str] = []

        if len(self.raw_points) < 4:
            errors.append(f"Need at least 4 points, got {len(self.raw_points)}")
            return {"valid": False, "errors": errors, "warnings": warnings}

        pts = np.array(self.raw_points)

        # Check closed loop
        start_end_dist = np.linalg.norm(pts[0] - pts[-1])
        if start_end_dist > CLOSE_THRESHOLD:
            errors.append(
                f"Track not closed: start-end gap is {start_end_dist:.3f}m "
                f"(must be < {CLOSE_THRESHOLD}m)"
            )
        else:
            self.closed = True

        # Check total length
        diffs = np.diff(pts, axis=0)
        seg_lengths = np.linalg.norm(diffs, axis=1)
        total_length = seg_lengths.sum()
        if total_length < MIN_TRACK_LENGTH:
            errors.append(
                f"Track too short: {total_length:.2f}m (minimum {MIN_TRACK_LENGTH}m)"
            )

        # Check self-intersection
        if self._has_self_intersection(pts):
            errors.append("Track centerline intersects itself")

        # Check minimum turn radius
        min_radius = self._min_turn_radius(pts)
        if min_radius < MIN_TURN_RADIUS:
            warnings.append(
                f"Tight turn detected: radius {min_radius:.3f}m "
                f"(recommended minimum {MIN_TURN_RADIUS}m)"
            )

        if errors:
            self.valid = False
            return {"valid": False, "errors": errors, "warnings": warnings}

        # Build smoothed centerline
        self._build_smooth_centerline()
        self.valid = True

        log.info(
            "Track valid: %.2fm long, %d smooth points, min radius %.3fm",
            total_length, len(self.centerline), min_radius,
        )
        return {"valid": True, "errors": [], "warnings": warnings}

    def nearest_point(self, x: float, z: float) -> dict | None:
        """
        Find the nearest point on the centerline to (x, z).
        Returns {x, z, lateral_error, heading, progress} or None.
        lateral_error is signed: positive = right of centerline.
        """
        if self.centerline is None or len(self.centerline) < 2:
            return None

        pt = np.array([x, z])
        diffs = self.centerline - pt
        dists = np.linalg.norm(diffs, axis=1)
        idx = int(np.argmin(dists))

        nearest = self.centerline[idx]
        tangent = self._tangents[idx]

        # Signed lateral error (cross product in 2D)
        to_car = pt - nearest
        cross = tangent[0] * to_car[1] - tangent[1] * to_car[0]
        lateral_error = float(cross)

        heading = float(math.atan2(tangent[0], tangent[1]))

        progress = float(self._cumlen[idx] / self._cumlen[-1]) if self._cumlen[-1] > 0 else 0.0

        return {
            "x": float(nearest[0]),
            "z": float(nearest[1]),
            "lateral_error": round(lateral_error, 4),
            "heading": round(heading, 4),
            "progress": round(progress, 4),
            "distance": round(float(dists[idx]), 4),
        }

    def is_within_bounds(self, x: float, z: float) -> bool:
        info = self.nearest_point(x, z)
        if info is None:
            return False
        return abs(info["lateral_error"]) <= self.half_width

    def get_data(self) -> dict:
        """Return serializable track data."""
        cl = None
        if self.centerline is not None:
            cl = [{"x": float(p[0]), "z": float(p[1])} for p in self.centerline]
        return {
            "raw_points": [{"x": p[0], "z": p[1]} for p in self.raw_points],
            "centerline": cl,
            "half_width": self.half_width,
            "closed": self.closed,
            "valid": self.valid,
        }

    # ---- internal ----

    def _build_smooth_centerline(self):
        pts = np.array(self.raw_points)
        if self.closed:
            pts = np.vstack([pts, pts[0]])

        n = len(pts)
        if n < 4:
            self.centerline = pts[:, :2] if pts.shape[1] >= 2 else pts
            self._tangents = np.zeros_like(self.centerline)
            self._cumlen = np.zeros(len(self.centerline))
            return

        try:
            tck, u = splprep([pts[:, 0], pts[:, 1]], s=0.001, per=self.closed, k=3)
            num_smooth = max(n * 5, 200)
            u_fine = np.linspace(0, 1, num_smooth)
            sx, sz = splev(u_fine, tck)
            self.centerline = np.column_stack([sx, sz])

            # Compute tangents (derivative of spline)
            dsx, dsz = splev(u_fine, tck, der=1)
            tangents = np.column_stack([dsx, dsz])
            norms = np.linalg.norm(tangents, axis=1, keepdims=True)
            norms = np.maximum(norms, 1e-8)
            self._tangents = tangents / norms

            # Cumulative arc length
            diffs = np.diff(self.centerline, axis=0)
            seg_lens = np.linalg.norm(diffs, axis=1)
            self._cumlen = np.concatenate([[0], np.cumsum(seg_lens)])
        except Exception as e:
            log.warning("Spline smoothing failed, using raw points: %s", e)
            self.centerline = pts[:, :2].copy()
            self._compute_tangents_from_raw()

    def _compute_tangents_from_raw(self):
        n = len(self.centerline)
        self._tangents = np.zeros((n, 2))
        for i in range(n):
            j = (i + 1) % n
            d = self.centerline[j] - self.centerline[i]
            norm = np.linalg.norm(d)
            self._tangents[i] = d / norm if norm > 1e-8 else [0, 1]
        diffs = np.diff(self.centerline, axis=0)
        seg_lens = np.linalg.norm(diffs, axis=1)
        self._cumlen = np.concatenate([[0], np.cumsum(seg_lens)])

    @staticmethod
    def _has_self_intersection(pts: np.ndarray) -> bool:
        """Check if any non-adjacent segments intersect."""
        n = len(pts)
        if n < 4:
            return False

        def ccw(A, B, C):
            return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0])

        def intersects(A, B, C, D):
            return ccw(A, C, D) != ccw(B, C, D) and ccw(A, B, C) != ccw(A, B, D)

        for i in range(n - 1):
            for j in range(i + 2, n - 1):
                if i == 0 and j == n - 2:
                    continue  # skip adjacent wrap-around
                if intersects(pts[i], pts[i + 1], pts[j], pts[j + 1]):
                    return True
        return False

    @staticmethod
    def _min_turn_radius(pts: np.ndarray) -> float:
        """Estimate minimum turn radius using 3-point circle fitting."""
        n = len(pts)
        if n < 3:
            return float("inf")

        min_r = float("inf")
        step = max(1, n // 50)
        for i in range(0, n - 2, step):
            A, B, C = pts[i], pts[min(i + 1, n - 1)], pts[min(i + 2, n - 1)]
            ax, ay = A
            bx, by = B
            cx, cy = C
            d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
            if abs(d) < 1e-10:
                continue
            ux = ((ax * ax + ay * ay) * (by - cy) +
                  (bx * bx + by * by) * (cy - ay) +
                  (cx * cx + cy * cy) * (ay - by)) / d
            uy = ((ax * ax + ay * ay) * (cx - bx) +
                  (bx * bx + by * by) * (ax - cx) +
                  (cx * cx + cy * cy) * (bx - ax)) / d
            r = math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2)
            min_r = min(min_r, r)

        return min_r
