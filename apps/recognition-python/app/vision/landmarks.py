from os import error
import threading
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision.hand_landmarker import HandLandmarkerResult
from pathlib import Path
import mediapipe as mp
import numpy as np
import cv2 as cv

MODEL_PATH = Path(__file__).parent / "LandmarkModel" / "hand_landmarker.task"
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


class Landmark:
    def __init__(self, model_path: Path = MODEL_PATH, num_hands: int = 2) -> None:
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
