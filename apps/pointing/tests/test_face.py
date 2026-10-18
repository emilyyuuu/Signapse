from __future__ import annotations

import math
from types import SimpleNamespace

import numpy as np

from pointing.face import FaceGrammar
from pointing.signs import SignSession

FRAME_MS = 33.0
NEUTRAL = {"browInnerUp": 0.1, "browOuterUpLeft": 0.1, "browOuterUpRight": 0.1, "browDownLeft": 0.05,
           "browDownRight": 0.05, "eyeSquintLeft": 0.1, "eyeSquintRight": 0.1}


def _face(yaw_deg: float = 0.0, **scores: float):
    s = {**NEUTRAL, **scores}
    a = math.radians(yaw_deg)
    # Rotation about the vertical axis: atan2(m[0][2], m[2][2]) gives the yaw back.
    m = [[math.cos(a), 0, math.sin(a), 0], [0, 1, 0, 0], [-math.sin(a), 0, math.cos(a), 0], [0, 0, 0, 1]]
    return SimpleNamespace(
        face_blendshapes=[[SimpleNamespace(category_name=k, score=v) for k, v in s.items()]],
        facial_transformation_matrixes=[m],
    )


def _rest(face: FaceGrammar, t: float = 0.0, n: int = 30) -> float:
    for _ in range(n):
        face.push(_face(), t, hands_up=False)
        t += FRAME_MS
    return t


def _sign_with(face: FaceGrammar, t: float, n: int, make) -> float:
    for i in range(n):
        face.push(make(i), t, hands_up=True)
        t += FRAME_MS
    return t


def test_raised_eyebrows_while_signing_make_a_question():
    face = FaceGrammar()
    t = _rest(face)
    face.start()
    end = _sign_with(face, t, 20, lambda i: _face(browInnerUp=0.5, browOuterUpLeft=0.5, browOuterUpRight=0.5))
    flag, nmm = face.finish(t, end)
    assert flag == "question"
    assert nmm["browUp"] > 0.15 and nmm["browHoldMs"] >= 300


def test_a_head_shake_makes_a_no():
    face = FaceGrammar()
    t = _rest(face)
    face.start()
    end = _sign_with(face, t, 24, lambda i: _face(yaw_deg=15 if (i // 4) % 2 else -15))
    flag, nmm = face.finish(t, end)
    assert flag == "negation" and nmm["headYawFlips"] >= 2


def test_a_neutral_face_is_a_statement_with_scores():
    face = FaceGrammar()
    t = _rest(face)
    face.start()
    end = _sign_with(face, t, 20, lambda i: _face())
    flag, nmm = face.finish(t, end)
    assert flag == "statement" and nmm is not None


def test_resting_face_differs_between_people():
    # Someone whose brows always sit high is not asking a question all the time.
    face = FaceGrammar()
    high = dict(browInnerUp=0.45, browOuterUpLeft=0.45, browOuterUpRight=0.45)
    t = 0.0
    for _ in range(30):
        face.push(_face(**high), t, hands_up=False)
        t += FRAME_MS
    face.start()
    end = _sign_with(face, t, 20, lambda i: _face(**high))
    assert face.finish(t, end)[0] == "statement"


def test_no_resting_face_seen_sends_a_plain_statement_and_no_scores():
    face = FaceGrammar()
    face.start()
    end = _sign_with(face, 0.0, 20, lambda i: _face(browInnerUp=0.6))
    assert face.finish(0.0, end) == ("statement", None)


def test_frames_with_hands_up_do_not_teach_the_resting_face():
    face = FaceGrammar()
    t = _sign_with(face, 0.0, 40, lambda i: _face(browInnerUp=0.6))  # hands up, not signing yet
    face.start()
    end = _sign_with(face, t, 20, lambda i: _face())
    assert face.finish(t, end) == ("statement", None)


class FakeModel:
    signs = ["PAIN"]

    def predict(self, frames):
        return "pain", 0.4


def test_the_session_sends_the_face_flag_with_the_signs():
    sent = []
    face = FaceGrammar()
    s = SignSession(FakeModel(), lambda g, c, flag, nmm: sent.append((g, flag, nmm)), face=face)
    t = _rest(face)
    s.start()
    hands = np.zeros((2, 21, 3), dtype=np.float32) + 0.5
    none = np.full((2, 21, 3), np.nan, dtype=np.float32)
    for i in range(40):  # sign with raised brows, then hands down
        up = i < 15
        s.push(hands if up else none, t)
        face.push(_face(browInnerUp=0.5, browOuterUpLeft=0.5, browOuterUpRight=0.5), t, hands_up=up)
        t += FRAME_MS
    result = s.finish()
    assert result["ok"] and result["grammarFlag"] == "question"
    assert sent[0][0] == ["PAIN"] and sent[0][1] == "question" and sent[0][2]["browUp"] > 0.15
    assert s.status()["grammarFlag"] == "question"
