from sources.webcam import WebcamSource
import cv2 as cv


def main() -> None:
    # Create Webcam
    webcam = WebcamSource()

    # Read Frames from source
    try:
        frames = webcam.frames()

        # Display the camera preview
        for frame in frames:
            cv.imshow("frame", frame.image)

            # Stop when the user requests
            if cv.waitKey(1) == ord("q"):
                break
    # Clean up resources
    finally:
        webcam.close()


if __name__ == "__main__":
    main()
