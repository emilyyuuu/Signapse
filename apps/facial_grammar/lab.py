"""Facial grammar lab: calibrate, mark clauses by hand, see the flag, save labelled clips.

Run with ``python -m facial_grammar.lab``. Keys:
  c       calibrate (hold a neutral face for 3 s)
  space   start / end a clause
  1-4     label the last clause: 1 statement, 2 question, 3 negation, 4 intensified
  s       save the labelled clause to data/grammar/clips/ (features only, never video)
  q / esc quit
"""

from __future__ import annotations

import argparse
import time

import cv2

from .capture import frames
from . import (
    Baseline,
    CalibrationError,
    Calibrator,
    ClauseRecorder,
    Frame,
    GrammarFlag,
    GrammarResult,
    grammar_flag,
)
from .clips import save_clip
from .paths import GRAMMAR_CLIPS_DIR as CLIPS_DIR
LABEL_KEYS = {
    ord("1"): GrammarFlag.STATEMENT,
    ord("2"): GrammarFlag.QUESTION,
    ord("3"): GrammarFlag.NEGATION,
    ord("4"): GrammarFlag.INTENSIFIED,
}
WHITE, GREEN, AMBER, RED = (255, 255, 255), (80, 200, 120), (0, 190, 255), (60, 60, 230)


def _text(img, s: str, y: int, color=WHITE, scale: float = 0.55) -> None:
    cv2.putText(img, s, (12, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(img, s, (12, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)


def _bar(img, label: str, value: float, y: int, threshold: float | None = None, full: float = 1.0) -> None:
    x0, w, h = 130, 200, 10
    _text(img, f"{label:<10}{value:+.2f}", y + 10, scale=0.45)
    cv2.rectangle(img, (x0 + 80, y), (x0 + 80 + w, y + h), (60, 60, 60), -1)
    mid = x0 + 80 + w // 2
    end = int(mid + max(-1.0, min(1.0, value / full)) * (w // 2))
    cv2.rectangle(img, (min(mid, end), y), (max(mid, end), y + h), GREEN, -1)
    if threshold is not None:
        tx = int(mid + threshold / full * (w // 2))
        cv2.line(img, (tx, y - 2), (tx, y + h + 2), AMBER, 1)


def run(camera: int) -> None:
    baseline: Baseline | None = None
    calibrator: Calibrator | None = None
    clause = ClauseRecorder()
    last_frames: list[Frame] = []
    last_result: GrammarResult | None = None
    label: GrammarFlag | None = None
    status = "Press c to calibrate."

    for img, frame, t_ms in frames(camera):
        if calibrator is not None:
            calibrator.push(frame, t_ms)
            if calibrator.done(t_ms):
                try:
                    baseline = calibrator.baseline()
                    status = "Calibrated. Space to start a clause."
                except CalibrationError as e:
                    status = f"Calibration failed: {e}"
                calibrator = None
        clause.push(frame)

        # Overlay
        if frame is None:
            _text(img, "No face", 24, RED)
        elif baseline is not None:
            _bar(img, "brow", frame.brow - baseline.brow, 14, 0.25)
            _bar(img, "browDown", frame.brow_down - baseline.brow_down, 32, 0.20)
            _bar(img, "squint", frame.squint - baseline.squint, 50, 0.25)
            _bar(img, "yaw", frame.yaw - baseline.yaw, 68, 6.0, full=30.0)
            _bar(img, "pitch", frame.pitch - baseline.pitch, 86, None, full=30.0)
        else:
            _text(img, f"yaw {frame.yaw:+.1f}  pitch {frame.pitch:+.1f}", 24)

        h = img.shape[0]
        if calibrator is not None:
            _text(img, f"Hold a neutral face... {calibrator.progress(t_ms) * 100:.0f}%", h - 70, AMBER, 0.7)
        if clause.active:
            _text(img, "CLAUSE RECORDING (space to end)", h - 70, RED, 0.7)
        if last_result is not None:
            r = last_result
            _text(img, f"FLAG: {r.flag.value.upper()}", h - 44, GREEN, 0.8)
            _text(
                img,
                f"up {r.up:+.2f} hold {r.brow_hold_ms:.0f}ms down {r.down:+.2f} sq {r.sq:+.2f} flips {r.flips}"
                + (f"  label={label.value}" if label else ""),
                h - 24,
                scale=0.45,
            )
        _text(img, status, h - 6, scale=0.45)
        cv2.imshow("Synapse facial grammar lab", img)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        elif key == ord("c") and not clause.active:
            calibrator = Calibrator()
            status = "Calibrating..."
        elif key == ord(" "):
            if baseline is None:
                status = "Calibrate first (c)."
            elif clause.active:
                last_frames = clause.end()
                last_result = grammar_flag(last_frames, baseline)
                label = None
                status = f"{len(last_frames)} frames. Label with 1-4, then s to save."
            else:
                clause.start()
                last_result = None
        elif key in LABEL_KEYS and last_frames:
            label = LABEL_KEYS[key]
        elif key == ord("s"):
            if not last_frames or baseline is None or label is None:
                status = "Nothing to save: record a clause and label it (1-4) first."
            else:
                path = CLIPS_DIR / f"{label.value}_{time.strftime('%Y%m%d-%H%M%S')}.json"
                save_clip(path, label, baseline, last_frames)
                status = f"Saved {path.name}"
                last_frames, label = [], None

    cv2.destroyAllWindows()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--camera", type=int, default=0)
    run(parser.parse_args().camera)


if __name__ == "__main__":
    main()
