from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent  # apps/facial_grammar
REPO_ROOT = PACKAGE_ROOT.parents[1]

MODELS_DIR = PACKAGE_ROOT / "models"  # gitignored; filled by scripts/fetch_models.sh
FACE_MODEL = MODELS_DIR / "face_landmarker.task"

# Recorded data lives at the repo root (data/). Features only, never video.
GRAMMAR_CLIPS_DIR = REPO_ROOT / "data" / "grammar" / "clips"
