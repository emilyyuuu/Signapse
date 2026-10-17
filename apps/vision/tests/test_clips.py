"""Accuracy of the grammar rules on clips recorded with the lab (tests/clips/*.json)."""

from collections import Counter
from pathlib import Path

import pytest

from apps.vision.synapse_vision.grammar import grammar_flag
from apps.vision.synapse_vision.grammar.clips import load_clip

CLIPS = sorted((Path(__file__).parent / "clips").glob("*.json"))
TARGET = 0.90
MIN_CLIPS_TO_ENFORCE = 20


@pytest.mark.skipif(not CLIPS, reason="no recorded clips in tests/clips/")
def test_clip_accuracy():
    total, correct = Counter(), Counter()
    misses = []
    for path in CLIPS:
        label, baseline, frames = load_clip(path)
        got = grammar_flag(frames, baseline).flag
        total[label] += 1
        if got is label:
            correct[label] += 1
        else:
            misses.append(f"{path.name}: expected {label.value}, got {got.value}")

    print("\nPer-flag accuracy:")
    for label in sorted(total):
        print(f"  {label.value:<12} {correct[label]}/{total[label]}")
    for m in misses:
        print("  miss:", m)

    accuracy = sum(correct.values()) / sum(total.values())
    print(f"  overall      {accuracy:.0%} over {len(CLIPS)} clips")
    if len(CLIPS) >= MIN_CLIPS_TO_ENFORCE:
        assert accuracy >= TARGET
