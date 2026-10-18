from sources.base import FrameSource, VideoFrame
from collections.abc import Iterator
import cv2 as cv
import time


class WebcamSource(FrameSource):
    def __init__(self, camera_index: int = 0, fps: float = 30):
        if not 0 < fps < float("inf"):
            raise ValueError("fps must be finite and greater than zero")
        self.frame_interval = 1.0 / fps
        self.camera = cv.VideoCapture(camera_index)

        if not self.camera.isOpened():
            raise RuntimeError(f"Could not open camera index {camera_index}")

        # Request the camera rate; software pacing also covers drivers that ignore it.
        self.camera.set(cv.CAP_PROP_FPS, fps)

        self.source_id = f"webcam-{camera_index}"

    def frames(self) -> Iterator[VideoFrame]:
        next_capture = time.monotonic()
        while True:
            delay = next_capture - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            # Schedule from the actual capture start so slow frames do not cause bursts.
            next_capture = time.monotonic() + self.frame_interval
            ok, image = self.camera.read()

            if not ok:
                print("The camera is not okay")
                break

            yield VideoFrame(
                image=cv.flip(image, 1),
                timestamp_ms=time.monotonic_ns() // 1_000_000,
                source_id=self.source_id,
            )

    def close(self) -> None:
        self.camera.release()
        cv.destroyAllWindows()
