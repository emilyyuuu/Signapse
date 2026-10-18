import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from datasets.google_asl import load_labels, load_sequence
from recognition.knn import predict_knn
from recognition.neural import (
    load_neural_model,
    predict_neural,
)
from recognition.normalize import normalize_sequence


ROOT = Path(__file__).resolve().parents[1]
DATASET_DIR = ROOT / "data" / "raw" / "google_asl"
MODEL_DIR = ROOT / "models" / "medical_asl_cnn_v1"


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument("--knn-per-sign", type=int, default=12)
    parser.add_argument("--test-per-sign", type=int, default=10)

    args = parser.parse_args()

    if args.knn_per_sign < 1 or args.test_per_sign < 1:
        parser.error("Both limits must be at least 1")

    splits = json.loads((MODEL_DIR / "splits.json").read_text(encoding="utf-8"))

    records = load_labels(DATASET_DIR)

    path_to_sign = dict(zip(records["path"], records["sign"]))

    model, labels = load_neural_model(MODEL_DIR)
    model.eval()

    # Select training examples for the kNN reference model.
    train_by_sign = defaultdict(list)

    for path in splits["train"]:
        sign = path_to_sign[path]

        if sign in labels:
            train_by_sign[sign].append(path)

    templates = []
    template_labels = []

    for sign in labels:
        count = 0

        for path in train_by_sign[sign]:
            if count >= args.knn_per_sign:
                break

            try:
                sequence = load_sequence(DATASET_DIR, path)
                normalized = normalize_sequence(sequence)

                if len(sequence) < 3 or not np.any(normalized):
                    continue

                templates.append(normalized)
                template_labels.append(sign)
                count += 1

            except (OSError, ValueError, KeyError):
                continue

        print(f"kNN templates for {sign}: {count}")

    if not templates:
        raise RuntimeError("No usable kNN templates")

    # Select the same held-out recordings for both models.
    test_by_sign = defaultdict(list)

    for path in splits["test"]:
        sign = path_to_sign[path]

        if sign in labels:
            test_by_sign[sign].append(path)

    knn_correct = 0
    cnn_correct = 0
    tested = 0

    print("\nComparing models...")

    for sign in labels:
        count = 0

        for path in test_by_sign[sign]:
            if count >= args.test_per_sign:
                break

            try:
                sequence = load_sequence(DATASET_DIR, path)

                # CNN prediction.
                cnn_label, cnn_score = predict_neural(model, labels, sequence)

                # kNN prediction.
                normalized = normalize_sequence(sequence)

                knn_label, knn_distance = predict_knn(
                    normalized,
                    templates,
                    template_labels,
                    k=3,
                )

            except (OSError, ValueError, KeyError):
                continue

            cnn_correct += int(cnn_label == sign)
            knn_correct += int(knn_label == sign)
            tested += 1
            count += 1

            print(f"Actual: {sign:8s} | CNN: {cnn_label:8s} | kNN: {knn_label}")

    if tested == 0:
        raise RuntimeError("No test recordings evaluated")

    print("\n=== MODEL COMPARISON ===")
    print("Test recordings:", tested)
    print(f"CNN accuracy: {cnn_correct / tested:.2%}")
    print(f"kNN accuracy: {knn_correct / tested:.2%}")

    print(
        "\nBoth models were evaluated on the same "
        "participant-separated test recordings."
    )


if __name__ == "__main__":
    main()
