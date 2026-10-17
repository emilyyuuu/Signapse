"""Realistic input: the fingertip jitters a few pixels and the hand shape flickers between
point and touch. A steady hold must still produce one event, near zone boundaries too."""

import random

import pytest
from test_pointing import AT_BODY, POSE, hand

from pointing import BodyFrame, Point2, PointingTracker


def _palm(h):
    pts = [h.image[i] for i in (0, 5, 9, 17)]
    return sum(p.x for p in pts) / 4, sum(p.y for p in pts) / 4


def steady_hand(at, shape):
    """The palm stays where a point at ``at`` would put it; only the fingers change."""
    px, py = _palm(hand(at=at, shape="point", scale=AT_BODY))
    h = hand(at=at, shape=shape, scale=AT_BODY)
    qx, qy = _palm(h)
    return type(h)(image=tuple(Point2(p.x + px - qx, p.y + py - qy) for p in h.image), world=h.world)


def noisy(at, jitter=0.006, flicker=0.3, seed=1, ms=1000, fps=30, pose_noise=0.003):
    rnd = random.Random(seed)
    frames = []
    for i in range(int(ms / 1000 * fps)):
        t = i * 1000 / fps
        x, y = at[0] + rnd.gauss(0, jitter), at[1] + rnd.gauss(0, jitter)
        shape = "open" if rnd.random() < flicker else "point"
        pose = {k: Point2(v.x + rnd.gauss(0, pose_noise), v.y + rnd.gauss(0, pose_noise), v.vis) for k, v in POSE.items()}
        hands = () if rnd.random() < 0.1 else (steady_hand((x, y), shape),)
        frames.append((BodyFrame(t_ms=t, pose=pose, hands=hands), t))
    return frames


@pytest.mark.parametrize(
    "at, zones",
    [
        ((0.55, 0.46), {"lchest"}),
        ((0.517, 0.46), {"lchest", "chest"}),  # right at the sternum edge
        ((0.54, 0.555), {"luq", "navel", "llq", "abdomen"}),  # near three boundaries
        ((0.50, 0.25), {"nose"}),
        ((0.51, 0.27), {"mouth", "nose", "lcheek", "head"}),
    ],
)
@pytest.mark.parametrize("seed", range(5))
def test_steady_hold_emits_once(at, zones, seed):
    tracker = PointingTracker()
    events = [e for f, t in noisy(at, seed=seed) if (e := tracker.push(f, t))]
    assert len(events) == 1, events
    assert events[0].zone in zones
    assert events[0].end_ms - events[0].start_ms <= 450  # still quick


def test_shaky_hold_does_not_repeat():
    # Heavy jitter can break a hold; the restart on the same spot is not a second event.
    for seed in range(20):
        tracker = PointingTracker()
        events = [e for f, t in noisy((0.55, 0.46), jitter=0.012, seed=seed) if (e := tracker.push(f, t))]
        assert [e.zone for e in events] == ["lchest"]


def test_same_zone_again_after_a_pause_is_new():
    tracker = PointingTracker()
    first = noisy((0.55, 0.46), seed=1, ms=600)
    later = [(f, t + 2500) for f, t in noisy((0.55, 0.46), seed=2, ms=600)]
    events = [e for f, t in first + [(None, 1000)] + later if (e := tracker.push(f, t))]
    assert [e.zone for e in events] == ["lchest", "lchest"]
