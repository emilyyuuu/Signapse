from __future__ import annotations

import shutil
import time

import numpy as np
import pytest

from pointing.paths import SIGN_MODEL_DIR
from pointing.recorder import Recorder, counts, leave_one_out, read_labels, seed_from_model

FRAME_MS = 33.0
HANDS = np.zeros((2, 21, 3), dtype=np.float32) + np.linspace(0, 1, 63, dtype=np.float32).reshape(1, 21, 3)
NONE = np.full((2, 21, 3), np.nan, dtype=np.float32)
has_model = pytest.mark.skipif(not (SIGN_MODEL_DIR / "templates.npz").exists(), reason="recorded sign model not in this checkout")


def _feed(rec: Recorder, frames, t: float = 0.0) -> float:
    for f in frames:
        rec.push(f, t)
        t += FRAME_MS
    return t


def test_a_recording_is_saved_in_the_format_build_model_reads(tmp_path):
    rec = Recorder(recordings=tmp_path)
    assert rec.start("dizzy")["ok"]
    _feed(rec, [NONE] * 10 + [HANDS] * 20 + [NONE] * 30)
    assert rec.status()["state"] == "off" and rec.status()["lastSaved"] == "dizzy"
    rows = read_labels(tmp_path)
    assert len(rows) == 1 and rows[0][1] == "dizzy"
    with np.load(tmp_path / rows[0][0], allow_pickle=False) as f:
        raw = f["raw_landmarks"]
        assert raw.shape[1:] == (2, 21, 3) and str(f["sign"]) == "dizzy"
    # Hands-down time before and after is trimmed: a few frames of lead-in, the sign, a short tail.
    assert 20 <= len(raw) <= 20 + 5 + 3 + 1
    assert counts(tmp_path) == {"dizzy": 1}


def test_bad_names_and_short_movements_are_refused(tmp_path):
    rec = Recorder(recordings=tmp_path)
    assert not rec.start("Pain!")["ok"]
    assert not rec.start("x")["ok"]
    rec.start("pain")
    _feed(rec, [HANDS] * 4 + [NONE] * 30)
    assert "too short" in rec.status()["note"] and read_labels(tmp_path) == []


def test_no_hands_gives_up_with_a_note(tmp_path):
    rec = Recorder(recordings=tmp_path)
    rec.start("pain")
    _feed(rec, [NONE] * int(16_000 / FRAME_MS))
    assert rec.status()["state"] == "off" and "No hands" in rec.status()["note"]


@has_model
def test_seeding_copies_the_models_examples_once(tmp_path):
    n = seed_from_model(SIGN_MODEL_DIR, tmp_path)
    assert n == len(read_labels(tmp_path)) and n >= 8
    assert seed_from_model(SIGN_MODEL_DIR, tmp_path) == 0  # not twice
    assert {"pain", "headache", "nausea", "fever"} <= set(counts(tmp_path))


@has_model
def test_rebuild_keeps_the_old_examples_adds_the_new_one_and_backs_up(tmp_path):
    model_dir = tmp_path / "model"
    shutil.copytree(SIGN_MODEL_DIR, model_dir)
    recordings = tmp_path / "recorder" / "recordings"
    before = len(read_labels(recordings)) or seed_from_model(model_dir, recordings)
    reloaded = []
    rec = Recorder(recordings=recordings, model_dir=model_dir, on_rebuilt=lambda: reloaded.append(True))
    rec.start("dizzy")
    _feed(rec, [NONE] * 3 + [HANDS] * 20 + [NONE] * 30)
    assert rec.rebuild()["ok"]
    for _ in range(600):
        if rec.status()["rebuild"]["state"] != "running":
            break
        time.sleep(0.1)
    result = rec.status()["rebuild"]
    assert result["state"] == "done", result
    assert result["examples"] == before + 1
    assert "dizzy" in result["perSign"] and "pain" in result["perSign"]
    assert reloaded == [True]
    assert any((recordings.parent / "model_backups").iterdir())


@has_model
def test_leave_one_out_on_the_current_model():
    r = leave_one_out(SIGN_MODEL_DIR)
    assert r["examples"] >= 8 and 0 <= r["correct"] <= r["examples"]
