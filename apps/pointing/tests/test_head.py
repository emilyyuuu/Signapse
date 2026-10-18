"""Head gestures: nod twice, shake twice, and the things that must not count."""

from __future__ import annotations

import math

from pointing import BodyFrame, Point2
from pointing.head import HeadGestureDetector

FPS_MS = 33.0


def head(pitch: float = 0.0, yaw: float = 0.0, lean: tuple[float, float] = (0.0, 0.0), vis: float = 1.0) -> dict:
    """Pose points for a head: ears 0.2 apart; nose offset from the ear midpoint by
    (yaw, pitch) ear-widths. ``lean`` moves the whole head (the body moving)."""
    ex, ey, w = 0.5 + lean[0], 0.3 + lean[1], 0.2
    return {
        "lear": Point2(ex - w / 2, ey, vis),
        "rear": Point2(ex + w / 2, ey, vis),
        "leye": Point2(ex - 0.04, ey + 0.02, vis),
        "reye": Point2(ex + 0.04, ey + 0.02, vis),
        "nose": Point2(ex + yaw * w, ey + pitch * w + 0.04, vis),
    }


def run(signal, seconds: float = 3.0, det: HeadGestureDetector | None = None):
    """Feed a (t_ms -> pose) signal, return every gesture the detector reports."""
    det = det or HeadGestureDetector()
    out = []
    t = 0.0
    while t <= seconds * 1000:
        g = det.push(BodyFrame(t, signal(t)), t)
        if g:
            out.append(g)
        t += FPS_MS
    return out


def wave(t: float, hz: float = 1.6, amp: float = 0.12) -> float:
    return amp * math.sin(2 * math.pi * hz * t / 1000)


def test_two_nods_confirm():
    got = run(lambda t: head(pitch=wave(t)))
    assert [g.kind for g in got] == ["nod"]


def test_two_head_shakes_cancel():
    got = run(lambda t: head(yaw=wave(t, amp=0.4)))
    assert [g.kind for g in got] == ["shake"]


def test_looking_down_slowly_is_not_a_nod():
    # Patients look down at their chest while pointing: one direction, never back.
    got = run(lambda t: head(pitch=min(t / 1500, 1) * 0.3), seconds=4)
    assert got == []


def test_small_wobble_is_not_a_nod():
    assert run(lambda t: head(pitch=wave(t, amp=0.01))) == []


def test_body_leaning_back_and_forth_is_not_a_nod():
    # The whole head moves, nose and ears together: the nose stays put against the ears.
    got = run(lambda t: head(lean=(0.0, wave(t, amp=0.1))))
    assert got == []


def test_sideways_sway_is_not_a_shake():
    got = run(lambda t: head(lean=(wave(t, amp=0.1), 0.0)))
    assert got == []


def test_ears_hidden_falls_back_to_the_eyes():
    def sig(t):
        pose = head(pitch=wave(t))
        pose["lear"] = Point2(pose["lear"].x, pose["lear"].y, 0.05)
        return pose

    assert [g.kind for g in run(sig)] == ["nod"]


def test_no_face_means_no_gesture():
    assert run(lambda t: {}) == []
    assert run(lambda t: head(pitch=wave(t), vis=0.1)) == []


def test_one_gesture_then_quiet_period():
    # Nodding for 5 s reports once per quiet period, not on every frame.
    got = run(lambda t: head(pitch=wave(t)), seconds=5)
    assert 1 <= len(got) <= 3
    assert all(b.t_ms - a.t_ms >= 2000 for a, b in zip(got, got[1:]))


def test_a_nod_with_a_slight_shake_still_reads_as_a_nod():
    got = run(lambda t: head(pitch=wave(t), yaw=wave(t, amp=0.05)))
    assert [g.kind for g in got] == ["nod"]
