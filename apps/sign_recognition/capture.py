"""Webcam source and the MediaPipe Hand Landmarker. Frames stay in this process."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from pathlib import Path

import cv2 as cv
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision.hand_landmarker import HandLandmarkerResult

from .datatypes import FrameSource, VideoFrame
from .paths import HAND_MODEL

HAND_CONNECTIONS = [
    (0, 1),
    (1, 2),
    (2, 3),
    (3, 4),
    (0, 5),
    (5, 6),
    (6, 7),
    (7, 8),
    (5, 9),
    (9, 10),
    (10, 11),
    (11, 12),
    (9, 13),
    (13, 14),
    (14, 15),
    (15, 16),
    (13, 17),
    (17, 18),
    (18, 19),
    (19, 20),
    (0, 17),
]


def _require(model_path: Path) -> None:
    if not model_path.exists():
        raise FileNotFoundError(f"{model_path} not found. Run apps/sign_recognition/scripts/fetch_models.sh first.")


class WebcamSource(FrameSource):
    def __init__(self, camera_index: int = 0):
        self.camera = cv.VideoCapture(camera_index)

        if not self.camera.isOpened():
            raise RuntimeError(f"Could not open camera index {camera_index}")

        self.source_id = f"webcam-{camera_index}"

    def frames(self) -> Iterator[VideoFrame]:
        last_ms = -1
        while True:
            ok, image = self.camera.read()

            if not ok:
                print("The camera is not okay")
                break

            # MediaPipe needs strictly increasing timestamps.
            timestamp_ms = max(time.monotonic_ns() // 1_000_000, last_ms + 1)
            last_ms = timestamp_ms
            yield VideoFrame(
                image=cv.flip(image, 1),
                timestamp_ms=timestamp_ms,
                source_id=self.source_id,
            )

    def close(self) -> None:
        self.camera.release()
        cv.destroyAllWindows()


class Landmark:
    def __init__(self, model_path: Path = HAND_MODEL, num_hands: int = 2) -> None:
        _require(model_path)
        self._lock = threading.Lock()
        self._result: HandLandmarkerResult | None = None

        options = vision.HandLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.LIVE_STREAM,
            num_hands=num_hands,
            result_callback=self._on_result,
        )

        self._landmarker = vision.HandLandmarker.create_from_options(options)

    def _on_result(
        self,
        result: HandLandmarkerResult,
        output_image: mp.Image,
        timestamp_ms: int,
    ) -> None:
        with self._lock:
            self._result = result

    @staticmethod
    def convertImage(bgr: np.ndarray) -> mp.Image:
        rgb = cv.cvtColor(bgr, cv.COLOR_BGR2RGB)
        return mp.Image(
            image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)
        )

    def detect_async(self, bgr: np.ndarray, timestamp_ms: int) -> None:
        self._landmarker.detect_async(self.convertImage(bgr), timestamp_ms)

    def res(self):
        with self._lock:
            return self._result

    def draw(self, image: np.ndarray) -> np.ndarray:
        """Return a copy of `image` with the latest hand skeleton drawn on it."""
        out = image.copy()
        result = self.res()

        if result is None or not result.hand_landmarks:
            return out

        h, w = out.shape[:2]
        for hand in result.hand_landmarks:
            pts = [(int(lm.x * w), int(lm.y * h)) for lm in hand]
            for a, b in HAND_CONNECTIONS:
                cv.line(out, pts[a], pts[b], (0, 255, 0), 2)
            for p in pts:
                cv.circle(out, p, 4, (0, 0, 255), -1)

        return out

    def close(self) -> None:
        self._landmarker.close()
