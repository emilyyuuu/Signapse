from types import SimpleNamespace

import pytest

from pointing import extract_body


def lm(x, y, z=0.0, visibility=0.9):
    return SimpleNamespace(x=x, y=y, z=z, visibility=visibility)


def test_extracts_named_pose_and_hands_with_aspect():
    pose = SimpleNamespace(pose_landmarks=[[lm(0.1 * (i % 10), 0.5) for i in range(33)]])
    hands = SimpleNamespace(hand_landmarks=[[lm(0.5, 0.5)] * 21], hand_world_landmarks=[[lm(0.01, 0.02, 0.03)] * 21])
    body = extract_body(pose, hands, 10.0, aspect=16 / 9)
    assert body.pose["lshoulder"].x == pytest.approx(0.1 * 1 * 16 / 9)  # index 11
    assert body.pose["lshoulder"].vis == pytest.approx(0.9)
    assert len(body.hands) == 1
    assert body.hands[0].image[0].x == pytest.approx(0.5 * 16 / 9)
    assert body.hands[0].world[0] == (0.01, 0.02, 0.03)


def test_no_pose_returns_none():
    assert extract_body(SimpleNamespace(pose_landmarks=[]), None, 0, 1.0) is None
