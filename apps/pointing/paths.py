from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent  # apps/pointing

MODELS_DIR = PACKAGE_ROOT / "models"  # gitignored; filled by scripts/fetch_models.sh
HAND_MODEL = MODELS_DIR / "hand_landmarker.task"
POSE_MODEL = MODELS_DIR / "pose_landmarker_lite.task"
