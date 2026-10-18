import numpy as np

from recognition.knn import predict_knn
from recognition.normalize import normalize_sequence


def resample_sequence(sequence, frame_count):
    """Interpolate landmarks onto a fixed time grid."""
    if len(sequence) == 0:
        raise ValueError("Cannot resample an empty sequence")
    positions = np.linspace(0, len(sequence) - 1, frame_count)
    lower = positions.astype(np.intp)
    upper = np.minimum(lower + 1, len(sequence) - 1)
    weight = (positions - lower).astype(np.float32)[:, None, None, None]
    return (sequence[lower] * (1 - weight) + sequence[upper] * weight).astype(np.float32)


class RecognitionPipeline:
    def __init__(self, templates, labels, k=3, candidate_count=64, max_frames=32):
        if len(templates) != len(labels) or not len(templates):
            raise ValueError("Nonempty templates and matching labels are required")
        if k < 1 or candidate_count < k or max_frames < 3:
            raise ValueError("Require k >= 1, candidate_count >= k, and max_frames >= 3")
        self.templates = templates
        self.labels = labels
        self.k = k
        self.candidate_count = min(candidate_count, len(templates))
        self.max_frames = max_frames
        # Cache compact temporal descriptors once when loading the model.
        self.descriptors = np.stack([
            resample_sequence(template, 8).reshape(-1)
            for template in templates
        ])

    def predict(self, frames):
        if len(frames) < 3:
            return None, float("inf")

        sequence = np.stack(frames).astype(np.float32)
        normalized = normalize_sequence(sequence)
        if not np.any(normalized):
            return None, float("inf")

        descriptor = resample_sequence(normalized, 8).reshape(-1)
        # Chunk the coarse search to avoid a large temporary array per prediction.
        distances = np.empty(len(self.templates), dtype=np.float32)
        for start in range(0, len(self.templates), 512):
            delta = self.descriptors[start:start + 512] - descriptor
            distances[start:start + len(delta)] = np.einsum("ij,ij->i", delta, delta)
        candidates = np.argsort(distances, kind="stable")[:self.candidate_count]
        # Apply the same bounded time grid to both inputs of the DTW comparison.
        return predict_knn(
            resample_sequence(normalized, self.max_frames),
            [resample_sequence(self.templates[i], self.max_frames) for i in candidates],
            [self.labels[i] for i in candidates],
            k=self.k,
        )
