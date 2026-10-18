from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent  # apps/sign_recognition
REPO_ROOT = PACKAGE_ROOT.parents[1]

MODELS_DIR = PACKAGE_ROOT / "models"  # gitignored; filled by scripts/fetch_models.sh
HAND_MODEL = MODELS_DIR / "hand_landmarker.task"

# Recorded sign templates live at the repo root. Landmark JSON only, never video.
SIGNS_DIR = REPO_ROOT / "data" / "signs"
