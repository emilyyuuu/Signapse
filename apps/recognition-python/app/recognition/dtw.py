import numpy as np


def dtw_distance(
    sequence_a: np.ndarray,
    sequence_b: np.ndarray,
) -> float:
    """
    Compare two normalized sequences with DTW.

    Both inputs must have shape (frames, 2, 21, 3).
    """
    if len(sequence_a) == 0 or len(sequence_b) == 0:
        return float("inf")

    a = sequence_a.reshape(len(sequence_a), -1)
    b = sequence_b.reshape(len(sequence_b), -1)

    previous = np.full(len(b) + 1, np.inf, dtype=np.float64)
    previous[0] = 0.0

    for i in range(1, len(a) + 1):
        current = np.full(len(b) + 1, np.inf, dtype=np.float64)

        # Compute all frame distances in NumPy rather than one call per cell.
        costs = np.linalg.norm(b - a[i - 1], axis=1)
        for j in range(1, len(b) + 1):
            cost = costs[j - 1]

            current[j] = cost + min(
                previous[j],
                current[j - 1],
                previous[j - 1],
            )

        previous = current

    return float(previous[-1] / max(len(a), len(b)))
