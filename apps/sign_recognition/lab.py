"""Sign recognition lab: webcam preview with the hand skeleton drawn on it.

Run with ``python -m sign_recognition.lab``. Keys:
  q       quit
Nothing is sent anywhere yet; recognition (normalize, segment, dtw, knn, pipeline) is next.
"""

from __future__ import annotations

import cv2 as cv

from .capture import Landmark, WebcamSource


def main() -> None:
    # Create Webcam
    webcam = WebcamSource()
    landmark = Landmark()

    # Read Frames from source
    try:
        frames = webcam.frames()
        # Display the camera preview

        for frame in frames:
            # Non-blocking the result comes via callback
            landmark.detect_async(frame.image, frame.timestamp_ms)

            cv.imshow("frame", landmark.draw(frame.image))
            # Stop when the user requests
            if cv.waitKey(1) == ord("q"):
                break
    # Clean up resources
    finally:
        print("Camera closed")
        landmark.close()
        webcam.close()


if __name__ == "__main__":
    main()
