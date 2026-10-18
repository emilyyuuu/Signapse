"""Build DTW + kNN templates from locally recorded, labeled signs."""

import argparse
from collections import Counter
import csv
import json
from pathlib import Path
import sys

import numpy as np

APP_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_DIR))
from recognition.normalize import normalize_sequence

DATASET_DIR = APP_DIR.parent / "recorder" / "recordings"
MODEL_DIR = APP_DIR / "models" / "recorded_asl_v1"


def build_model(dataset_dir, model_dir, per_sign=None):
    dataset_dir, model_dir = Path(dataset_dir), Path(model_dir)
    templates, labels, counts = {}, [], Counter()
    skipped = 0
    seen = set()
    with (dataset_dir / "labels.csv").open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        if not {"path", "sign"}.issubset(reader.fieldnames or []):
            raise ValueError("labels.csv must contain path and sign columns")
        for row in reader:
            filename, sign = (row.get("path") or "").strip(), (row.get("sign") or "").strip()
            try:
                if not filename or not sign:
                    raise ValueError("Missing recording path or sign label")
                path = (dataset_dir / filename).resolve()
                if path in seen:
                    raise ValueError("Duplicate recording path in labels.csv")
                seen.add(path)
                if per_sign is not None and counts[sign] >= per_sign:
                    continue
                with np.load(path, allow_pickle=False) as recording:
                    if "sign" in recording and str(recording["sign"]).strip() != sign:
                        raise ValueError("Embedded sign does not match labels.csv")
                    # Use the same preprocessing as live recognition.
                    raw = recording["raw_landmarks"].astype(np.float32)
                if len(raw) < 3:
                    raise ValueError("Fewer than three frames")
                normalized = normalize_sequence(raw)
                if not np.any(normalized) or not np.isfinite(normalized).all():
                    raise ValueError("No usable hand landmarks")
                templates[f"template_{len(labels):08d}"] = normalized
                labels.append(sign)
                counts[sign] += 1
            except (OSError, ValueError, KeyError) as exc:
                skipped += 1
                print(f"Skipping {filename}: {exc}")
    if not templates:
        raise ValueError("No usable labeled recordings; model was not changed")
    model_dir.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(model_dir / "templates.npz", **templates)
    (model_dir / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")
    config = {
        "model_version": "1.0",
        "algorithm": "dtw_knn",
        "landmarks_per_hand": 21,
        "hands": ["left_hand", "right_hand"],
        "dimensions": 3,
        "normalization": "wrist_relative_per_hand",
        "template_count": len(labels),
        "supported_signs": sorted(counts),
        "recordings_per_sign": dict(sorted(counts.items())),
        "training_source": "recorder/recordings/labels.csv",
    }
    (model_dir / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"Saved {len(labels)} KNN templates to {model_dir.resolve()}")
    print("Recordings per sign:", dict(sorted(counts.items())))
    print("Skipped recordings:", skipped)
    for sign, count in sorted(counts.items()):
        if count < 3:
            print(f"Tip: record at least 3 examples of {sign!r} for k=3 voting (currently {count}).")
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DATASET_DIR)
    parser.add_argument("--model-dir", type=Path, default=MODEL_DIR)
    parser.add_argument("--per-sign", type=int, default=None,
                        help="Optional maximum recordings per sign; default uses all")
    args = parser.parse_args()
    if args.per_sign is not None and args.per_sign < 1:
        parser.error("--per-sign must be at least 1")
    build_model(args.dataset_dir, args.model_dir, args.per_sign)


if __name__ == "__main__":
    main()
