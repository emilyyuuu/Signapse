from __future__ import annotations

import math
from types import SimpleNamespace

import numpy as np
import pytest

from pointing.paths import SIGN_MODEL_DIR
from pointing.signs import MAX_DISTANCE, SignModel, SignSession, confidence_of, hands_array, mirrored, to_gloss

FRAME_MS = 33.0


def _hand(x0: float) -> list[SimpleNamespace]:
    return [SimpleNamespace(x=x0 + 0.01 * i, y=0.5 + 0.005 * i, z=-0.01 * i) for i in range(21)]


def _result(*hands: tuple[str, float]):
    return SimpleNamespace(
        hand_landmarks=[_hand(x) for _, x in hands],
        handedness=[[SimpleNamespace(category_name=label)] for label, _ in hands],
    )


HANDS = hands_array(_result(("Left", 0.3)))  # one hand up
NONE = hands_array(_result())  # no hands


class FakeModel:
    signs = ["PAIN"]

    def __init__(self, label: str | None = "pain", distance: float = 0.5) -> None:
        self.label, self.distance, self.calls = label, distance, []

    def predict(self, frames):
        self.calls.append(len(frames))
        return self.label, self.distance


def _session(model=None):
    sent: list[tuple[list[str], float | None]] = []
    s = SignSession(model or FakeModel(), lambda g, c, *_: sent.append((g, c)))
    return s, sent


def _feed(s: SignSession, frames: list[np.ndarray], t0: float = 0.0) -> float:
    t = t0
    for f in frames:
        s.push(f, t)
        t += FRAME_MS
    return t


def _one_sign(s: SignSession, t0: float = 0.0, n: int = 15) -> float:
    """Hands up for n frames, then down long enough to end the sign."""
    return _feed(s, [NONE] * 3 + [HANDS] * n + [NONE] * 20, t0)


def test_hands_array_matches_the_mirrored_recording_layout():
    arr = hands_array(_result(("Right", 0.2)))
    # Un-mirrored "Right" is the hand the mirrored recorder called "Left": slot 0.
    assert np.isfinite(arr[0]).all() and np.isnan(arr[1]).all()
    assert arr[0, 0, 0] == pytest.approx(0.8)  # x flipped back to the mirrored image
    assert arr[0, 3, 2] == pytest.approx(-0.03)  # depth unchanged
    assert np.isfinite(hands_array(_result(("Left", 0.2)))[1]).all()
    assert np.isnan(hands_array(None)).all()


def test_mirrored_swaps_the_hands_and_flips_x():
    seq = np.stack([hands_array(_result(("Right", 0.2)))])
    m = mirrored(seq)
    assert np.isnan(m[0, 0]).all() and np.isfinite(m[0, 1]).all()
    assert m[0, 1, 0, 0] == pytest.approx(0.2)
    assert np.allclose(mirrored(m), seq, equal_nan=True)


def test_labels_become_signapse_gloss_and_distance_becomes_confidence():
    assert [to_gloss(x) for x in ("pain", "headache", "stomach", "new sign")] == ["PAIN", "HEADACHE", "STOMACH", "NEW-SIGN"]
    assert confidence_of(0.1) > 0.95
    assert confidence_of(1.5) == pytest.approx(0.7)
    assert confidence_of(MAX_DISTANCE) < 0.7  # a weak match asks the doctor to confirm


def test_nothing_happens_until_the_patient_starts_signing():
    s, sent = _session()
    _one_sign(s)
    assert s.status()["state"] == "off" and s.status()["words"] == []
    assert s.finish()["ok"] is False and sent == []


def test_hands_up_then_down_is_one_sign_and_done_sends_it():
    model = FakeModel("pain", 0.5)
    s, sent = _session(model)
    assert s.start()["ok"]
    assert s.status()["state"] == "watching"
    t = _feed(s, [NONE, HANDS, HANDS, HANDS, HANDS])
    assert s.status()["state"] == "signing"
    _feed(s, [HANDS] * 10 + [NONE] * 20, t)
    result = s.finish()
    assert result == {"ok": True, "gloss": ["PAIN"], "grammarFlag": "statement"}  # no face: a statement
    assert sent == [(["PAIN"], confidence_of(0.5))]
    assert len(model.calls) == 1
    assert s.status()["sent"] == ["PAIN"] and s.status()["state"] == "off"


def test_two_signs_in_a_row_keep_their_order():
    labels = iter([("pain", 0.4), ("fever", 0.6)])

    class Two(FakeModel):
        def predict(self, frames):
            return next(labels)

    s, sent = _session(Two())
    s.start()
    t = _one_sign(s)
    _one_sign(s, t)
    s.finish()
    assert sent[0][0] == ["PAIN", "FEVER"]
    assert sent[0][1] == confidence_of(0.6)  # the weakest sign sets the clause's confidence


def test_body_part_signs_are_left_out_the_place_is_picked_next():
    labels = iter([("pain", 0.4), ("chest", 0.3)])

    class Two(FakeModel):
        def predict(self, frames):
            return next(labels)

    s, sent = _session(Two())
    s.start()
    t = _one_sign(s)
    _one_sign(s, t)
    for job in s._jobs:
        job.join(2)
    assert "where it hurts" in (s.status()["note"] or "")  # told while still signing
    s.finish()
    assert sent[0][0] == ["PAIN"]


def test_a_point_while_signing_adds_nothing_and_is_not_read_as_a_sign():
    model = FakeModel("fever", 0.3)
    s, sent = _session(model)
    s.start()
    t = _feed(s, [NONE] * 3 + [HANDS] * 10)
    s.ignore_point(t)
    t = _feed(s, [HANDS] * 5 + [NONE] * 20, t)
    _one_sign(s, t + 2000)  # then a real sign
    s.finish()
    assert len(model.calls) == 1  # only the real sign was matched
    assert sent[0][0] == ["FEVER"]


def test_a_touch_on_the_body_does_not_cancel_the_sign():
    # FEVER touches the forehead and NAUSEA the stomach: the pointing tracker reports a touch.
    model = FakeModel("fever", 0.3)
    s, sent = _session(model)
    s.start()
    t = _feed(s, [NONE] * 3 + [HANDS] * 10)
    s.ignore_point(t, "touch")
    _feed(s, [HANDS] * 5 + [NONE] * 20, t)
    s.finish()
    assert len(model.calls) == 1
    assert sent[0][0] == ["FEVER"]


def test_a_poor_match_is_dropped_with_a_note():
    s, sent = _session(FakeModel("pain", MAX_DISTANCE + 0.5))
    s.start()
    _one_sign(s)
    s.finish(wait_s=1)
    assert sent == []
    assert "Try again" in (s.status()["note"] or "")


def test_a_short_flick_of_the_hand_is_not_a_sign():
    model = FakeModel()
    s, _ = _session(model)
    s.start()
    _one_sign(s, n=4)
    assert model.calls == [] and s.status()["words"] == []


def test_a_point_during_the_movement_counts_as_the_point_not_a_sign():
    model = FakeModel("chest", 0.3)
    s, sent = _session(model)
    s.start()
    t = _feed(s, [NONE] * 3 + [HANDS] * 10)
    s.note_point("POINT-LCHEST", 0.9, t)
    _feed(s, [HANDS] * 5 + [NONE] * 20, t)
    s.finish()
    assert model.calls == []
    assert sent == [(["POINT-LCHEST"], 0.9)]


def test_a_sign_then_a_point():
    s, sent = _session(FakeModel("pain", 0.3))
    s.start()
    t = _one_sign(s)
    s.note_point("POINT-RUQ", 0.85, t + 2000)
    s.finish()
    assert sent[0][0] == ["PAIN", "POINT-RUQ"]


def test_the_same_sign_caught_twice_is_sent_once():
    s, sent = _session(FakeModel("pain", 0.3))
    s.start()
    t = _one_sign(s)
    _one_sign(s, t)
    s.finish()
    assert sent[0][0] == ["PAIN"]


def test_cancel_sends_nothing():
    s, sent = _session()
    s.start()
    _one_sign(s)
    s.cancel()
    assert s.finish()["ok"] is False and sent == []


def test_a_long_movement_is_cut_and_matched():
    model = FakeModel()
    s, _ = _session(model)
    s.start()
    _feed(s, [HANDS] * int(7000 / FRAME_MS))  # hands never go down
    s.finish()
    assert model.calls and model.calls[0] <= 6000 / FRAME_MS + 10


def test_signing_closes_itself_when_nobody_is_there():
    s, sent = _session()
    s.start()
    _feed(s, [NONE] * int(95_000 / FRAME_MS / 10), 0.0)  # sparse frames are fine
    s.push(NONE, 95_000)
    assert s.status()["state"] == "off" and "no hands" in s.status()["note"]
    assert sent == []


def test_no_model_explains_why():
    s = SignSession(None, lambda *_: None, error="The sign model could not be loaded (missing).")
    assert s.start() == {"ok": False, "error": "The sign model could not be loaded (missing)."}
    assert s.status()["available"] is False


@pytest.mark.skipif(not (SIGN_MODEL_DIR / "templates.npz").exists(), reason="recorded sign model not in this checkout")
def test_real_model_reads_its_own_recordings_with_either_hand():
    model = SignModel()
    from model_loader import load_model  # on sys.path once SignModel is created

    assert {"PAIN", "CHEST", "HEADACHE", "STOMACH"} <= set(model.signs)
    templates, labels, _ = load_model(SIGN_MODEL_DIR)
    i = labels.index("chest")
    # Templates are stored normalized (wrist at 0); any offset works, the model re-normalizes.
    seq = templates[i] + 0.5
    label, distance = model.predict(list(seq))
    assert label == "chest" and distance < 1e-3
    # The same sign signed with the other hand still matches.
    label, distance = model.predict(list(mirrored(seq)))
    assert label == "chest" and distance < 1e-3
    assert math.isfinite(distance)
