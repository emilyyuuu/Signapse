"""Facial grammar engine: turns brows, squint and head movement into a grammar flag.

Runs on the patient laptop; video and landmarks never leave this process. The modules
re-exported here are pure Python (no mediapipe or cv2), so they can be tested without a
camera. capture.py and lab.py need the camera and are imported on their own.
"""

from .calibration import CalibrationError, Calibrator
from .clause import ClauseRecorder
from .datatypes import DEFAULT_THRESHOLDS, Baseline, Frame, GrammarFlag, GrammarResult, Thresholds
from .features import extract_frame
from .rules import grammar_flag, sign_changes

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
