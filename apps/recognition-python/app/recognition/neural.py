import numpy as np
import torch
from torch import nn

from recognition.normalize import normalize_sequence


NUM_FRAMES = 48
NUM_FEATURES = 126


def prepare_sequence(sequence, num_frames=NUM_FRAMES):
    """
    Input: (frames, 2, 21, 3)
    Output: (126, num_frames)

    Uses the same normalization as the existing kNN model.
    """
    sequence = np.asarray(sequence, dtype=np.float32)

    if sequence.ndim != 4 or sequence.shape[1:] != (2, 21, 3):
        raise ValueError(f"Expected (frames, 2, 21, 3), got {sequence.shape}")

    if len(sequence) < 3:
        raise ValueError("Sequence must have at least 3 frames")

    normalized = normalize_sequence(sequence)
    flattened = normalized.reshape(len(normalized), NUM_FEATURES)

    if not np.any(flattened):
        raise ValueError("No usable hand landmarks")

    old_positions = np.linspace(0, 1, len(flattened))
    new_positions = np.linspace(0, 1, num_frames)

    resampled = np.stack(
        [
            np.interp(
                new_positions,
                old_positions,
                flattened[:, feature],
            )
            for feature in range(NUM_FEATURES)
        ],
        axis=0,
    )

    return resampled.astype(np.float32)


class ASLConvNet(nn.Module):
    def __init__(self, num_classes):
        super().__init__()

        self.features = nn.Sequential(
            nn.Conv1d(NUM_FEATURES, 128, kernel_size=5, padding=2),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(128, 256, kernel_size=5, padding=2),
            nn.BatchNorm1d(256),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(256, 256, kernel_size=3, padding=1),
            nn.BatchNorm1d(256),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),
        )

        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.3),
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, num_classes),
        )

    def forward(self, x):
        return self.classifier(self.features(x))


def load_neural_model(model_dir, device="cpu"):
    from pathlib import Path
    import json

    model_dir = Path(model_dir)

    with open(
        model_dir / "labels.json",
        encoding="utf-8",
    ) as file:
        labels = json.load(file)

    model = ASLConvNet(len(labels))

    # Only load a checkpoint you created or trust.
    state = torch.load(
        model_dir / "model.pt",
        map_location=device,
        weights_only=True,
    )

    model.load_state_dict(state)
    model.to(device)
    model.eval()

    return model, labels


@torch.no_grad()
def predict_neural(model, labels, frames, device="cpu"):
    sequence = np.asarray(frames, dtype=np.float32)
    prepared = prepare_sequence(sequence)

    x = torch.from_numpy(prepared).unsqueeze(0).to(device)

    probabilities = torch.softmax(model(x), dim=1)[0]

    index = int(torch.argmax(probabilities).item())

    return labels[index], float(probabilities[index].item())
