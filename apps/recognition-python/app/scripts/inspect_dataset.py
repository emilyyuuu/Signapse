from pathlib import Path

import numpy as np

from datasets.google_asl import (
    load_labels,
    load_sequence,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]

DATASET_DIR = PROJECT_ROOT / "data" / "raw" / "google_asl"


def main():

    print("=== GOOGLE ASL DATASET INSPECTION ===")

    print("\nDataset directory:")
    print(DATASET_DIR)

    labels = load_labels(DATASET_DIR)

    print("\nTotal labelled recordings:")
    print(len(labels))

    print("\nNumber of unique signs:")
    print(labels["sign"].nunique())

    print("\nFirst five labelled recordings:")
    print(labels.head())

    print("\nMost common signs:")
    print(labels["sign"].value_counts().head(10))

    print("\nAll available signs:")
    print(sorted(labels["sign"].unique()))

    print("\n=== EXAMPLE RECORDING ===")

    example = labels.iloc[0]

    print("\nSign:", example["sign"])
    print("Recording path:", example["path"])

    sequence = load_sequence(
        DATASET_DIR,
        example["path"],
    )

    print("\nSequence shape:")
    print(sequence.shape)

    print("\nNumber of frames:")
    print(len(sequence))

    valid_points = np.isfinite(sequence).all(axis=-1)

    print("\nValid landmark points:")
    print(int(valid_points.sum()))

    print("\nMissing landmark points:")
    print(int((~valid_points).sum()))

    valid_hands = valid_points.all(axis=-1)

    print("\nFrames with valid left hand:")
    print(int(valid_hands[:, 0].sum()))

    print("\nFrames with valid right hand:")
    print(int(valid_hands[:, 1].sum()))

    print("\nDataset inspection complete.")


if __name__ == "__main__":
    main()
