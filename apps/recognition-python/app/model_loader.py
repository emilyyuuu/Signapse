import json
from pathlib import Path

import numpy as np


def load_model(model_dir: Path):
    """
    Load saved DTW + kNN templates and metadata.

    Returns:
        templates, labels, config
    """

    model_dir = Path(model_dir)

    with open(
        model_dir / "labels.json",
        "r",
        encoding="utf-8",
    ) as file:
        labels = json.load(file)

    with open(
        model_dir / "config.json",
        "r",
        encoding="utf-8",
    ) as file:
        config = json.load(file)

    with np.load(
        model_dir / "templates.npz",
        allow_pickle=False,
    ) as archive:
        template_keys = sorted(archive.files)

        templates = [archive[key].copy() for key in template_keys]

    if len(templates) != len(labels):
        raise ValueError("Number of templates does not match labels.")

    return templates, labels, config
