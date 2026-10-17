"""Webcam loop with the MediaPipe Pose and Hand Landmarkers. Frames stay in this process."""

from __future__ import annotations

import time
from collections.abc import Iterator
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


def frames(
    camera: int = 0, mirror: bool = True, pose_every: int = 2, size: tuple[int, int] = (640, 480)
) -> Iterator[tuple["cv2.typing.MatLike", BodyFrame | None, float]]:
    """Yield (display_bgr, body_frame_or_none, t_ms) for each camera frame.

    Pose and hands run on the un-mirrored image so "left" is the patient's own left.
    Only the display image is mirrored. For speed the body barely moves between frames, so
    pose runs every ``pose_every`` frames and hands, which move fast, run on every frame.
    """
    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open camera {camera}.")
    # Smaller frames are faster to read and detect; the models downscale anyway.
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, size[0])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, size[1])
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # always the newest frame, not a queued old one
    t0 = time.monotonic()
    last_ms = -1
    n = 0
    pose_result = None
    try:
        with open_pose_landmarker() as pose, open_hand_landmarker() as hands:
            while True:
                ok, raw = cap.read()
                if not ok:
                    break
                # VIDEO mode needs strictly increasing timestamps.
                t_ms = max(int((time.monotonic() - t0) * 1000), last_ms + 1)
                last_ms = t_ms
                h, w = raw.shape[:2]
                img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(raw, cv2.COLOR_BGR2RGB))
                if pose_result is None or n % pose_every == 0:
                    pose_result = pose.detect_for_video(img, t_ms)
                n += 1
                body = extract_body(pose_result, hands.detect_for_video(img, t_ms), t_ms, w / h)
                yield (cv2.flip(raw, 1) if mirror else raw), body, float(t_ms)
    finally:
        cap.release()
