from __future__ import annotations

from statistics import fmean

from .types import Baseline, Frame


class CalibrationError(Exception):
    pass


class Calibrator:
    """Collects a neutral face for ``duration_ms`` and averages it into a Baseline.

    Call ``push(frame_or_none, t_ms)`` every video tick (None when no face was found)
    until ``done(t_ms)`` is true, then ``baseline()``.
    """

    def __init__(
        self,
        duration_ms: float = 3000.0,
        max_missing_ratio: float = 0.2,
        max_yaw_range_deg: float = 10.0,
    ) -> None:
        self.duration_ms = duration_ms
        self.max_missing_ratio = max_missing_ratio
        self.max_yaw_range_deg = max_yaw_range_deg
        self._start_ms: float | None = None
        self._frames: list[Frame] = []
        self._missing = 0

    def push(self, frame: Frame | None, t_ms: float) -> None:
        if self._start_ms is None:
            self._start_ms = t_ms
        if frame is None:
            self._missing += 1
        else:
            self._frames.append(frame)

    def done(self, t_ms: float) -> bool:
        return self._start_ms is not None and t_ms - self._start_ms >= self.duration_ms

    def progress(self, t_ms: float) -> float:
        if self._start_ms is None:
            return 0.0
        return min(1.0, (t_ms - self._start_ms) / self.duration_ms)

    def baseline(self) -> Baseline:
        total = len(self._frames) + self._missing
        if total == 0 or not self._frames:
            raise CalibrationError("No face seen during calibration.")
        if self._missing / total > self.max_missing_ratio:
            raise CalibrationError("Face was lost too often. Check lighting and framing.")
        yaws = [f.yaw for f in self._frames]
        if max(yaws) - min(yaws) > self.max_yaw_range_deg:
            raise CalibrationError("Head moved during calibration. Hold still and look at the camera.")
        return Baseline(
            brow=fmean(f.brow for f in self._frames),
            brow_down=fmean(f.brow_down for f in self._frames),
            squint=fmean(f.squint for f in self._frames),
            yaw=fmean(yaws),
            pitch=fmean(f.pitch for f in self._frames),
        )
