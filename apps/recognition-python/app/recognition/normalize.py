import numpy as np


def normalize_sequence(
    sequence: np.ndarray,
) -> np.ndarray:
    """
    Normalize a sequence of hand landmarks.

    Input:
        (frames, 2, 21, 3)

    Output:
        (frames, 2, 21, 3)
    """

    if sequence.ndim != 4:
        raise ValueError("Expected a four-dimensional sequence.")

    if sequence.shape[1:] != (2, 21, 3):
        raise ValueError("Expected shape (frames, 2, 21, 3).")

    result = np.zeros_like(
        sequence,
        dtype=np.float32,
    )

    for frame_index in range(len(sequence)):
        for hand_index in range(2):
            hand = sequence[
                frame_index,
                hand_index,
            ]

            if not np.isfinite(hand).all():
                continue

            wrist = hand[0]

            centered = hand - wrist

            distances = np.linalg.norm(
                centered,
                axis=1,
            )

            scale = np.max(distances)

            if scale < 1e-6:
                continue

            result[
                frame_index,
                hand_index,
            ] = centered / scale

    return result

