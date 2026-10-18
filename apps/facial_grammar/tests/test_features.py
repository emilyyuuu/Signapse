import math
from types import SimpleNamespace

import pytest

from facial_grammar import extract_frame


def fake_result(scores, yaw_deg=0.0):
    cats = [SimpleNamespace(category_name=k, score=v) for k, v in scores.items()]
    c, s = math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg))
    m = [[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]  # rotation about y
    return SimpleNamespace(face_blendshapes=[cats], facial_transformation_matrixes=[m])


SCORES = {
    "browInnerUp": 0.6,
    "browOuterUpLeft": 0.3,
    "browOuterUpRight": 0.3,
    "browDownLeft": 0.1,
    "browDownRight": 0.3,
    "eyeSquintLeft": 0.2,
    "eyeSquintRight": 0.4,
}


def test_extracts_averaged_blendshapes_and_yaw():
    f = extract_frame(fake_result(SCORES, yaw_deg=20), t_ms=5)
    assert f.brow == pytest.approx(0.4)
    assert f.brow_down == pytest.approx(0.2)
    assert f.squint == pytest.approx(0.3)
    assert f.yaw == pytest.approx(20)
    assert f.pitch == pytest.approx(0)


def test_no_face_returns_none():
    assert extract_frame(SimpleNamespace(face_blendshapes=[], facial_transformation_matrixes=[]), 0) is None
