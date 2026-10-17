"""Labelled clause clips as JSON. Features only: no video, no landmarks."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .types import Baseline, Frame, GrammarFlag


def save_clip(path: Path, label: GrammarFlag, baseline: Baseline, frames: list[Frame]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "label": label.value,
        "baseline": asdict(baseline),
        "frames": [asdict(f) for f in frames],
    }
    path.write_text(json.dumps(data, indent=1))


def load_clip(path: Path) -> tuple[GrammarFlag, Baseline, list[Frame]]:
    data = json.loads(path.read_text())
    return (
        GrammarFlag(data["label"]),
        Baseline(**data["baseline"]),
        [Frame(**f) for f in data["frames"]],
    )
