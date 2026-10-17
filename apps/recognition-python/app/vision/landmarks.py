import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

model_path = "../vision/LandmarkModel/"
BaseOptions = mp.tasks.BaseOptions
HandLandmarker = mp.tasks.vision.HandLandmarker
HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode

# Create a hand landmarker instance with the video mode:
options = HandLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=model_path),
    running_mode=VisionRunningMode.VIDEO,
)

with HandLandmarker.create_from_options(options) as landmarker:
    ...
