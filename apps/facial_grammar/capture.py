"""Webcam loop with the MediaPipe Face Landmarker. Frames stay in this process.

The hand landmarker for sign recognition will join this same loop later.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions, RunningMode

from .datatypes import Frame
from .features import extract_frame
from .paths import FACE_MODEL


def open_face_landmarker(model_path: Path = FACE_MODEL) -> FaceLandmarker:
    if not model_path.exists():
        raise FileNotFoundError(f"{model_path} not found. Run apps/facial_grammar/scripts/fetch_models.sh first.")
    options = FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=RunningMode.VIDEO,
        num_faces=1,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    )
    return FaceLandmarker.create_from_options(options)


def frames(camera: int = 0, mirror: bool = True) -> Iterator[tuple["cv2.typing.MatLike", Frame | None, float]]:
    """Yield (bgr_image, face_frame_or_none, t_ms) for each camera frame."""
    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open camera {camera}.")
    t0 = time.monotonic()
    last_ms = -1
    try:
        with open_face_landmarker() as landmarker:
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                if mirror:
                    bgr = cv2.flip(bgr, 1)
                # VIDEO mode needs strictly increasing timestamps.
                t_ms = max(int((time.monotonic() - t0) * 1000), last_ms + 1)
                last_ms = t_ms
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), t_ms)
                yield bgr, extract_frame(result, t_ms), float(t_ms)
    finally:
        cap.release()
