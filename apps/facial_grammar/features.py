from __future__ import annotations

import math
from typing import Any

from .datatypes import Frame


def _scores(categories: Any) -> dict[str, float]:
    return {c.category_name: float(c.score) for c in categories}


def extract_frame(result: Any, t_ms: float) -> Frame | None:
    """Build a Frame from a MediaPipe FaceLandmarkerResult, or None if no face.

    Works on any object with ``face_blendshapes`` (list of category lists) and
    ``facial_transformation_matrixes`` (list of 4x4 row-indexable matrices).
    """
    if not result.face_blendshapes or not result.facial_transformation_matrixes:
        return None

    s = _scores(result.face_blendshapes[0])
    brow = (s["browInnerUp"] + s["browOuterUpLeft"] + s["browOuterUpRight"]) / 3
    brow_down = (s["browDownLeft"] + s["browDownRight"]) / 2
    squint = (s["eyeSquintLeft"] + s["eyeSquintRight"]) / 2

    # Head pose from the rotation part of the facial transformation matrix.
    # Axis signs depend on the camera; check them in the lab before trusting them.
    m = result.facial_transformation_matrixes[0]
    yaw = math.degrees(math.atan2(m[0][2], m[2][2]))
    pitch = math.degrees(math.atan2(m[2][1], m[1][1]))

    return Frame(t_ms=t_ms, brow=brow, brow_down=brow_down, squint=squint, yaw=yaw, pitch=pitch)
