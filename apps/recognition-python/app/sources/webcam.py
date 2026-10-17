from sources.base import FrameSource, VideoFrame
from collections.abc import Iterator
import cv2 as cv
import time


class WebcamSource(FrameSource):
    def __init__(self, camera_index: int = 0):
        self.camera = cv.VideoCapture(camera_index)

        if not self.camera.isOpened():
            raise RuntimeError(f"Could not open camera index {camera_index}")

        self.source_id = f"webcam-{camera_index}"

    def frames(self) -> Iterator[VideoFrame]:
        while True:
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
