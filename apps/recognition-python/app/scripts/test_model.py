from pathlib import Path

from model_loader import load_model

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "models" / "medical_asl_v1"

print("Looking for model at:", MODEL_DIR)

templates, labels, config = load_model(MODEL_DIR)

print("Model loaded successfully!")
print("Number of templates:", len(templates))
print("Supported signs:", config["supported_signs"])
print("First template shape:", templates[0].shape)
