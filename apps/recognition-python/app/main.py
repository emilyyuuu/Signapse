from pathlib import Path
from queue import Empty, Queue
from threading import Thread

import cv2 as cv

from sources.webcam import WebcamSource
from vision.landmarks import Landmark

from model_loader import load_model
from recognition.pipeline import RecognitionPipeline


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "app" / "models" / "recorded_asl_v1"


def run_prediction(pipeline, frames, results):
    try:
        results.put((pipeline.predict(frames), None))
    except Exception as exc:
        results.put((None, exc))


def main() -> None:
    # Load the saved ASL recognition model.
    templates, labels, config = load_model(MODEL_DIR)

    pipeline = RecognitionPipeline(
        templates=templates,
        labels=labels,
        k=3,
    )

    print("Model loaded!")
    print("Supported signs:", config["supported_signs"])
    print("SPACE = start/stop recording")
    print("Q = quit")

    webcam = WebcamSource(fps=30)
    landmark = Landmark()

    recording = False
    predicting = False
    prediction_results = Queue()
    captured_frames = []

    last_result_timestamp = -1
    recording_start_timestamp = -1

    prediction_text = "Press SPACE to record a sign"

    try:
        for frame in webcam.frames():
            if predicting:
                try:
                    result, error = prediction_results.get_nowait()
                except Empty:
                    pass
                else:
                    predicting = False
                    if error is not None:
                        prediction_text = "Prediction failed; see terminal"
                        print("Prediction failed:", error)
                    else:
                        label, distance = result
                        if label is None:
                            prediction_text = "No valid sign recorded"
                        else:
                            prediction_text = f"{label} | distance: {distance:.2f}"
                        print("Prediction:", prediction_text)
            # Submit the webcam frame to MediaPipe.
            landmark.detect_async(
                frame.image,
                frame.timestamp_ms,
            )

            # Read each asynchronous result only once.
            new_result = landmark.latest_numpy(
                after_timestamp_ms=last_result_timestamp,
            )

            if new_result is not None:
                timestamp, hand_points = new_result
                last_result_timestamp = timestamp

                if recording and timestamp > recording_start_timestamp:
                    captured_frames.append(hand_points)

            display = landmark.draw(frame.image)

            if recording:
                status = f"RECORDING: {len(captured_frames)} frames"
            else:
                status = prediction_text

            cv.putText(
                display,
                status,
                (20, 40),
                cv.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 0),
                2,
            )

            cv.imshow("ASL Recognition", display)

            key = cv.waitKey(1) & 0xFF

            if key == ord("q"):
                break

            if key == 32 and not predicting:  # SPACE
                if not recording:
                    recording = True
                    captured_frames = []
                    recording_start_timestamp = last_result_timestamp

                    print("Recording started.")

                else:
                    recording = False

                    print(
                        "Recording stopped.",
                        len(captured_frames),
                        "frames captured.",
                    )

                    prediction_text = "Predicting..."

                    predicting = True
                    Thread(
                        target=run_prediction,
                        args=(pipeline, captured_frames, prediction_results),
                        daemon=True,
                    ).start()

    finally:
        print("Camera closed")
        landmark.close()
        webcam.close()
        cv.destroyAllWindows()


if __name__ == "__main__":
    main()
