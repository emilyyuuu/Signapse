from collections import Counter

import numpy as np

from recognition.dtw import dtw_distance


def predict_knn(
    sequence: np.ndarray,
    templates: list[np.ndarray],
    labels: list[str],
    k: int = 3,
) -> tuple[str, float]:
    if len(templates) != len(labels):
        raise ValueError("Templates and labels must match")

    if not templates:
        raise ValueError("No reference templates available")

    distances = [
        (dtw_distance(sequence, template), label)
        for template, label in zip(templates, labels)
    ]

    distances.sort(key=lambda item: item[0])

    nearest = distances[: min(k, len(distances))]

    votes = Counter(label for _, label in nearest)
    predicted_label = votes.most_common(1)[0][0]

    closest_distance = min(
        distance for distance, label in nearest if label == predicted_label
    )

    return predicted_label, closest_distance
