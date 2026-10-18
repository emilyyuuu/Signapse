"""Head gestures from the pose landmarks: nod twice = yes, shake twice = no.

After the patient points at a body part the screen shows what it found; a nod confirms it
and brings up the pain scale, a shake cancels so they can point again. No extra model: the
pose landmarker already gives the nose, eyes and ears.

How: a nod moves the nose up and down relative to the ears (the head pivots around them),
a shake moves it left and right. Both are measured in ear-widths so the distance from the
camera does not matter, and the whole body leaning or moving cancels out because the nose
is measured against the ears. A gesture is two or more direction changes in about 1.5 s,
large enough to be deliberate. Slowly looking down at the chest, which patients do while
pointing, is one direction only and does not count.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from .datatypes import BodyFrame, Point2


@dataclass(frozen=True)
class HeadThresholds:
    """Starting values. Tune them in the lab (it prints every gesture), not by guessing."""

    window_ms: float = 1500.0
    min_history_ms: float = 500.0
    nod_amplitude: float = 0.10  # peak-to-peak nose height change, in ear-widths
    nod_deadband: float = 0.025
    shake_amplitude: float = 0.30  # peak-to-peak nose sideways change, in ear-widths
    shake_deadband: float = 0.07
    min_flips: int = 2  # direction changes: down-up-down = 2
    cooldown_ms: float = 2000.0  # after a gesture, ignore the head while the answer is shown
    min_visibility: float = 0.4


DEFAULT_HEAD_THRESHOLDS = HeadThresholds()


@dataclass(frozen=True)
class HeadGesture:
    kind: str  # "nod" or "shake"
    confidence: float  # 0..1, how far past the threshold the movement was
    t_ms: float


def _flips(values: list[float], deadband: float) -> int:
    """Direction changes of a signal around its mean, ignoring small wobble."""
    if not values:
        return 0
    mean = sum(values) / len(values)
    flips, last = 0, 0
    for v in values:
        d = v - mean
        if abs(d) <= deadband:
            continue
        sign = 1 if d > 0 else -1
        if last and sign != last:
            flips += 1
        last = sign
    return flips


def _head_signals(pose: dict[str, Point2], min_vis: float) -> tuple[float, float] | None:
    """(pitch, yaw) of the nose against the ears, in ear-widths, or None if not visible."""
    nose, le, re = pose.get("nose"), pose.get("lear"), pose.get("rear")
    if not nose or nose.vis < min_vis:
        return None
    if le and re and min(le.vis, re.vis) >= min_vis:
        a, b = le, re
    else:
        # Turning the head hides an ear; the eyes stay visible, so measure against them.
        a, b = pose.get("leye"), pose.get("reye")
        if not a or not b or min(a.vis, b.vis) < min_vis:
            return None
    width = ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) ** 0.5
    if width < 1e-4:
        return None
    mid_x, mid_y = (a.x + b.x) / 2, (a.y + b.y) / 2
    return (nose.y - mid_y) / width, (nose.x - mid_x) / width


class HeadGestureDetector:
    def __init__(self, thresholds: HeadThresholds = DEFAULT_HEAD_THRESHOLDS) -> None:
        self.th = thresholds
        self._buf: deque[tuple[float, float, float]] = deque()  # (t_ms, pitch, yaw)
        self._quiet_until = -1.0
        self.last_amplitude = (0.0, 0.0)  # (nod, shake) of the current window, for the lab display

    def reset(self) -> None:
        self._buf.clear()

    def push(self, body: BodyFrame | None, t_ms: float) -> HeadGesture | None:
        th = self.th
        if t_ms < self._quiet_until:
            return None
        sig = _head_signals(body.pose, th.min_visibility) if body else None
        if sig is None:
            return None
        self._buf.append((t_ms, sig[0], sig[1]))
        while self._buf and t_ms - self._buf[0][0] > th.window_ms:
            self._buf.popleft()
        if t_ms - self._buf[0][0] < th.min_history_ms:
            return None

        pitch = [p for _, p, _ in self._buf]
        yaw = [y for _, _, y in self._buf]
        nod_amp, shake_amp = max(pitch) - min(pitch), max(yaw) - min(yaw)
        self.last_amplitude = (nod_amp, shake_amp)
        nod_ok = nod_amp >= th.nod_amplitude and _flips(pitch, th.nod_deadband) >= th.min_flips
        shake_ok = shake_amp >= th.shake_amplitude and _flips(yaw, th.shake_deadband) >= th.min_flips
        if not (nod_ok or shake_ok):
            return None
        # If both look true (a diagonal wobble), the one further past its threshold wins.
        nod_score, shake_score = nod_amp / th.nod_amplitude, shake_amp / th.shake_amplitude
        kind = "nod" if nod_ok and (not shake_ok or nod_score >= shake_score) else "shake"
        score = nod_score if kind == "nod" else shake_score
        self._buf.clear()
        self._quiet_until = t_ms + th.cooldown_ms
        return HeadGesture(kind, min(1.0, score / 2), t_ms)
