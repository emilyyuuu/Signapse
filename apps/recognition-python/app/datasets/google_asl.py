from pathlib import Path

import numpy as np
import pandas as pd


def load_labels(dataset_dir: Path) -> pd.DataFrame:
    """
    Load recording paths and sign labels.

    Supports the actual labels.parqet filename
    as well as the usual labels.parquet spelling.
    """
    dataset_dir = Path(dataset_dir)

    for filename in ("labels.parqet", "labels.parquet"):
        file_path = dataset_dir / filename

        if file_path.is_file():
            labels = pd.read_parquet(file_path)

            required_columns = {"path", "sign"}

            missing = required_columns - set(labels.columns)

            if missing:
                raise ValueError(f"Labels file is missing columns: {missing}")

            return labels

    raise FileNotFoundError(f"No labels file found inside {dataset_dir}")


def load_recording(
    dataset_dir: Path,
    recording_path: str,
) -> pd.DataFrame:
    """Load one Google ASL landmark recording."""

    full_path = Path(dataset_dir) / recording_path

    if not full_path.is_file():
        raise FileNotFoundError(f"Recording not found: {full_path}")

    return pd.read_parquet(
        full_path,
        columns=[
            "frame",
            "type",
            "landmark_index",
            "x",
            "y",
            "z",
        ],
    )


def recording_to_numpy(
    recording: pd.DataFrame,
) -> np.ndarray:
    """
    Convert landmark rows into a NumPy array.

    Shape:
        (number_of_frames, 2, 21, 3)

    Hand positions:
        0 = left hand
        1 = right hand

    Coordinate positions:
        0 = x
        1 = y
        2 = z

    Missing landmarks are represented by NaN.
    """

    required_columns = {
        "frame",
        "type",
        "landmark_index",
        "x",
        "y",
        "z",
    }

    missing = required_columns - set(recording.columns)

    if missing:
        raise ValueError(f"Recording is missing columns: {missing}")

    frames = sorted(recording["frame"].unique())

    frame_lookup = {frame_number: index for index, frame_number in enumerate(frames)}

    sequence = np.full(
        (len(frames), 2, 21, 3),
        np.nan,
        dtype=np.float32,
    )

    hand_rows = recording[recording["type"].isin(["left_hand", "right_hand"])]

    for row in hand_rows.itertuples(index=False):
        if row.type == "left_hand":
            hand_index = 0
        else:
            hand_index = 1

        landmark_index = int(row.landmark_index)

        if landmark_index < 0 or landmark_index >= 21:
            continue

        frame_index = frame_lookup[row.frame]

        sequence[
            frame_index,
            hand_index,
            landmark_index,
        ] = [
            row.x,
            row.y,
            row.z,
        ]

    return sequence


def load_sequence(
    dataset_dir: Path,
    recording_path: str,
) -> np.ndarray:
    """Load one recording directly as a NumPy sequence."""

    recording = load_recording(
        dataset_dir,
        recording_path,
    )

    return recording_to_numpy(recording)
