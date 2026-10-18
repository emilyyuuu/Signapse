"""Webcam loop with the MediaPipe Pose and Hand Landmarkers. Frames stay in this process."""

from __future__ import annotations

import sys
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    HandLandmarker,
    HandLandmarkerOptions,
    PoseLandmarker,
    PoseLandmarkerOptions,
    RunningMode,
)

from .datatypes import BodyFrame
from .features import extract_body
from .paths import HAND_MODEL, POSE_MODEL


def _require(model_path: Path) -> None:
    if not model_path.exists():
        raise FileNotFoundError(f"{model_path} not found. Run apps/pointing/scripts/fetch_models.sh first.")


def open_hand_landmarker(model_path: Path = HAND_MODEL) -> HandLandmarker:
    _require(model_path)
    options = HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=RunningMode.VIDEO,
        num_hands=2,
    )
    return HandLandmarker.create_from_options(options)


def open_pose_landmarker(model_path: Path = POSE_MODEL) -> PoseLandmarker:
    _require(model_path)
    options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=RunningMode.VIDEO,
        num_poses=1,
    )
    return PoseLandmarker.create_from_options(options)


class _LatestFrame(threading.Thread):
    """Reads the camera as fast as it delivers and keeps only the newest frame.

    Reading and detecting in one loop makes old frames pile up in the camera driver's
    buffer, so the picture shows what happened a moment ago. A reader thread throws old
    frames away: detection always starts from the newest one, so the delay stays small
    even when the models are slower than the camera.
    """

    def __init__(self, cap, on_frame: Callable | None = None) -> None:
        super().__init__(daemon=True)
        self._cap = cap
        self._on_frame = on_frame
        self._cond = threading.Condition()
        self._frame = None
        self._seq = 0
        self.failed = False
        self._halt = False

    def run(self) -> None:
        while not self._halt:
            ok, frame = self._cap.read()
            with self._cond:
                if not ok:
                    self.failed = True
                    self._cond.notify_all()
                    return
                self._frame, self._seq = frame, self._seq + 1
                self._cond.notify_all()
            if self._on_frame:
                # Every camera frame, at the camera's own rate: used to keep the picture smooth.
                try:
                    self._on_frame(frame)
                except Exception:  # a display problem must never stop the camera
                    pass

    def next(self, last_seq: int):
        """The newest frame newer than last_seq, waiting for one if needed."""
        with self._cond:
            self._cond.wait_for(lambda: self._seq != last_seq or self.failed, timeout=2)
            return self._frame, self._seq

    def stop(self) -> None:
        self._halt = True


def _open_camera(camera: int):
    """DirectShow on Windows: lower latency than the default backend, and 30 fps with MJPG."""
    if sys.platform == "win32":
        cap = cv2.VideoCapture(camera, cv2.CAP_DSHOW)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            return cap
        cap.release()
    return cv2.VideoCapture(camera)


def frames(
    camera: int = 0,
    mirror: bool = True,
    pose_every: int = 2,
    size: tuple[int, int] = (640, 480),
    on_raw: Callable | None = None,
) -> Iterator[tuple["cv2.typing.MatLike", BodyFrame | None, float]]:
    """Yield (display_bgr, body_frame_or_none, t_ms) for each camera frame.

    Pose and hands run on the un-mirrored image so "left" is the patient's own left.
    Only the display image is mirrored. For speed the body barely moves between frames, so
    pose runs every ``pose_every`` frames and hands, which move fast, run on every frame.
    """
    cap = _open_camera(camera)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open camera {camera}.")
    # Smaller frames are faster to read and detect; the models downscale anyway.
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, size[0])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, size[1])
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # always the newest frame, not a queued old one
    cap.set(cv2.CAP_PROP_FPS, 30)
    reader = _LatestFrame(cap, on_raw)
    pool = ThreadPoolExecutor(max_workers=1)  # runs the pose model while hands run here
    reader.start()
    t0 = time.monotonic()
    last_ms = -1
    n = 0
    seq = 0
    pose_result = None
    try:
        with open_pose_landmarker() as pose, open_hand_landmarker() as hands:
            while True:
                raw, seq = reader.next(seq)
                if raw is None or reader.failed:
                    break
                # VIDEO mode needs strictly increasing timestamps.
                t_ms = max(int((time.monotonic() - t0) * 1000), last_ms + 1)
                last_ms = t_ms
                h, w = raw.shape[:2]
                img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(raw, cv2.COLOR_BGR2RGB))
                pose_job = None
                if pose_result is None or n % pose_every == 0:
                    pose_job = pool.submit(pose.detect_for_video, img, t_ms)
                n += 1
                hand_result = hands.detect_for_video(img, t_ms)
                if pose_job is not None:
                    pose_result = pose_job.result()
                body = extract_body(pose_result, hand_result, t_ms, w / h)
                yield (cv2.flip(raw, 1) if mirror else raw), body, float(t_ms)
    finally:
        reader.stop()
        pool.shutdown(wait=False)
        cap.release()
