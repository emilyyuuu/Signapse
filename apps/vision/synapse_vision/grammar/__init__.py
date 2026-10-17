"""Facial grammar engine: turns brows, squint and head movement into a grammar flag.

Pure Python with no mediapipe or cv2 imports, so it can be tested without a camera.
"""

from .calibration import CalibrationError, Calibrator
from .clause import ClauseRecorder
from .features import extract_frame
from .rules import grammar_flag, sign_changes
from .types import DEFAULT_THRESHOLDS, Baseline, Frame, GrammarFlag, GrammarResult, Thresholds

__all__ = [
    "Baseline",
    "CalibrationError",
    "Calibrator",
    "ClauseRecorder",
    "DEFAULT_THRESHOLDS",
    "Frame",
    "GrammarFlag",
    "GrammarResult",
    "Thresholds",
    "extract_frame",
    "grammar_flag",
    "sign_changes",
]
