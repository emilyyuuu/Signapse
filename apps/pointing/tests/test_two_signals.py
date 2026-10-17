"""Touch must not interfere with points: flickering frames vote with the fingertip, and the
other hand resting on the body must not take over or block a point."""

import random

from test_noisy import steady_hand
from test_pointing import AT_BODY, POSE, hand

from pointing import BodyFrame, PointingTracker


def run(frames):
    tracker = PointingTracker()
    return [e for f, t in frames if (e := tracker.push(f, t))], tracker


def test_flicker_to_touch_votes_with_the_fingertip():
    # Pointing near the bottom of the left chest; the palm is over the upper abdomen. Half the
    # frames read as "touch", whose contact point sits lower, on the abdomen.
    for seed in range(10):
        rnd = random.Random(seed)
        frames = []
        for i in range(30):
            t = i * 33.0
            shape = "open" if rnd.random() < 0.5 else "point"
            frames.append((BodyFrame(t_ms=t, pose=POSE, hands=(steady_hand((0.55, 0.50), shape),)), t))
        events, _ = run(frames)
        assert [e.zone for e in events] == ["lchest"], (seed, events)


def test_resting_other_hand_does_not_block_a_point():
    # Left hand lies on the stomach the whole time; after 1 s the right hand points at the
    # right shoulder.
    resting = hand(at=(0.54, 0.56), shape="open", scale=AT_BODY)
    frames = [(BodyFrame(t_ms=t, pose=POSE, hands=(resting,)), t) for t in range(0, 1000, 33)]
    pointing = hand(at=(0.39, 0.40), shape="point", scale=AT_BODY)
    frames += [(BodyFrame(t_ms=t, pose=POSE, hands=(resting, pointing)), t) for t in range(1000, 1600, 33)]
    events, _ = run(frames)
    assert "rshoulder" in [e.zone for e in events]
    assert all(e.gesture == "point" for e in events if e.end_ms > 1000)


def test_no_touch_from_other_hand_while_pointing():
    # Both hands on the body: the right points at the left chest, the left hand has just arrived
    # on the stomach. The point is the message; the touch is not reported over it.
    other = hand(at=(0.46, 0.60), shape="open", scale=AT_BODY)
    pointing = hand(at=(0.55, 0.46), shape="point", scale=AT_BODY)
    frames = [(BodyFrame(t_ms=t, pose=POSE), t) for t in range(0, 500, 33)]
    frames += [(BodyFrame(t_ms=t, pose=POSE, hands=(other, pointing)), t) for t in range(500, 2000, 33)]
    events, _ = run(frames)
    assert [(e.zone, e.gesture) for e in events] == [("lchest", "point")]
