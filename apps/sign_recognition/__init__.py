"""Sign recognition: hand landmarks to isolated clinical ASL sign labels.

Runs on the patient laptop next to facial_grammar and pointing; video and landmarks never
leave this process, only sign labels. The modules re-exported here are pure Python (no
mediapipe or cv2), so they can be tested without a camera. capture.py and lab.py need the
camera and are imported on their own.
"""

from .datatypes import FrameSource, VideoFrame

__all__ = [
    "FrameSource",
    "VideoFrame",
]
