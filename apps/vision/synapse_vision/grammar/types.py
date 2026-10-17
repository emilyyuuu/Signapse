from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class GrammarFlag(StrEnum):
    STATEMENT = "statement"
    QUESTION = "question"
    NEGATION = "negation"
    INTENSIFIED = "intensified"


@dataclass(frozen=True)
class Frame:
    """Facial features for one video frame. Blendshapes are 0..1, angles in degrees."""

    t_ms: float
    brow: float
    brow_down: float
    squint: float
    yaw: float
    pitch: float


@dataclass(frozen=True)
class Baseline:
    """Per-patient neutral face. Resting brow height differs between people."""

    brow: float
    brow_down: float
    squint: float
    yaw: float
    pitch: float


@dataclass(frozen=True)
class Thresholds:
    """Starting values from the plan. Tune them on recorded clips, not by guessing."""

    brow_up: float = 0.25
    brow_hold_ms: float = 300.0
    brow_down: float = 0.20
    squint: float = 0.25
    yaw_deadband_deg: float = 6.0
    min_yaw_flips: int = 2


DEFAULT_THRESHOLDS = Thresholds()


@dataclass(frozen=True)
class GrammarResult:
    flag: GrammarFlag
    up: float
    down: float
    sq: float
    flips: int
    brow_hold_ms: float
