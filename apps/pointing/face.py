"""Facial grammar for signed clauses, using apps/facial_grammar, in the same camera loop.

While the patient is not signing, their resting face is learned (a rolling baseline, so there
is no separate calibration step). While they sign, the face is collected; on Done the frames
between the first and last sign go through facial_grammar's rules, which give the grammar flag
(statement / question / negation / intensified) and the marker scores. Only those scores leave
this process, never face points.
"""

from __future__ import annotations

import sys
import threading
from collections import deque
from pathlib import Path
from statistics import median
from typing import Any

_APPS = Path(__file__).resolve().parent.parent
if str(_APPS) not in sys.path:
    sys.path.insert(0, str(_APPS))

from facial_grammar import Baseline, Frame, extract_frame, grammar_flag  # noqa: E402

BASELINE_MS = 6000.0  # resting face kept from the last few seconds
MIN_BASELINE_FRAMES = 12
MARGIN_MS = 300.0  # face just before and after the signs still belongs to the clause


class FaceGrammar:
    def __init__(self) -> None:
        self._rest: deque[Frame] = deque()
        self._clause: list[Frame] | None = None
        self._baseline: Baseline | None = None
        self._lock = threading.Lock()  # the camera loop pushes; the page's buttons start and finish

    def push(self, result: Any, t_ms: float, hands_up: bool) -> None:
        """Every face result. Resting frames (not signing, hands down) teach the baseline."""
        frame = extract_frame(result, t_ms) if result is not None else None
        if frame is None:
            return
        with self._lock:
            self._add(frame, t_ms, hands_up)

    def _add(self, frame: Frame, t_ms: float, hands_up: bool) -> None:
        if self._clause is not None:
            self._clause.append(frame)
        elif not hands_up:
            self._rest.append(frame)
            while self._rest and t_ms - self._rest[0].t_ms > BASELINE_MS:
                self._rest.popleft()

    def start(self) -> None:
        """Signing has started: fix the baseline from the resting face just before."""
        with self._lock:
            self._baseline = _median_baseline(list(self._rest))
            self._clause = []

    def cancel(self) -> None:
        with self._lock:
            self._clause = None

    def finish(self, start_ms: float | None, end_ms: float | None) -> tuple[str, dict[str, float | str] | None]:
        """(grammar flag, marker scores) for the face during the signs. Without a usable
        baseline or face, the clause is a plain statement and no scores are sent."""
        with self._lock:
            session, self._clause = self._clause or [], None
        frames = session
        if start_ms is not None and end_ms is not None:
            frames = [f for f in session if start_ms - MARGIN_MS <= f.t_ms <= end_ms + MARGIN_MS]
        baseline = self._baseline
        if baseline is None and start_ms is not None:
            # No resting face before signing: use the moment before the first sign, if any.
            baseline = _median_baseline([f for f in session if f.t_ms < start_ms - MARGIN_MS])
        if baseline is None or len(frames) < 5:
            return "statement", None
        result = grammar_flag(frames, baseline)
        return result.flag.value, result.to_nmm()


def _median_baseline(frames: list[Frame]) -> Baseline | None:
    if len(frames) < MIN_BASELINE_FRAMES:
        return None
    return Baseline(
        brow=median(f.brow for f in frames),
        brow_down=median(f.brow_down for f in frames),
        squint=median(f.squint for f in frames),
        yaw=median(f.yaw for f in frames),
        pitch=median(f.pitch for f in frames),
    )
