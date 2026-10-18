from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent  # apps/pointing

MODELS_DIR = PACKAGE_ROOT / "models"  # gitignored; filled by scripts/fetch_models.sh
HAND_MODEL = MODELS_DIR / "hand_landmarker.task"
POSE_MODEL = MODELS_DIR / "pose_landmarker_lite.task"
FACE_MODEL = MODELS_DIR / "face_landmarker.task"  # facial grammar while signing

# The recorded-sign model (DTW + kNN) from apps/recognition-python. Override with SIGNAPSE_SIGN_MODEL.
SIGN_MODEL_DIR = PACKAGE_ROOT.parent / "recognition-python" / "app" / "models" / "recorded_asl_v1"
