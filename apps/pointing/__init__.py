"""Pointing: the patient points at or touches their own body; Synapse resolves it to a body-map zone.

Runs on the patient laptop next to facial_grammar; video and landmarks never leave this
process, only zone ids. The modules re-exported here are pure Python (no mediapipe or cv2),
so they can be tested without a camera. capture.py and lab.py need the camera.
"""

from .datatypes import DEFAULT_THRESHOLDS, BodyFrame, Gesture, HandPose, Point2, PointingEvent, Thresholds, point_label
from .features import extract_body
from .handshape import contact_point, depth_ratio, gesture, is_pointing, pointing_side
from .tracker import Candidate, PointingTracker
from .zones import ZoneHit, resolve_zone

__all__ = [
    "BodyFrame",
    "Candidate",
    "DEFAULT_THRESHOLDS",
    "Gesture",
    "HandPose",
    "Point2",
    "PointingEvent",
    "PointingTracker",
    "Thresholds",
    "ZoneHit",
    "contact_point",
    "depth_ratio",
    "extract_body",
    "gesture",
    "is_pointing",
    "point_label",
    "pointing_side",
    "resolve_zone",
]
