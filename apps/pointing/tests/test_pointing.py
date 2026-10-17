import pytest

from pointing import (
    DEFAULT_THRESHOLDS,
    BodyFrame,
    HandPose,
    Point2,
    PointingEvent,
    PointingTracker,
    contact_point,
    depth_ratio,
    gesture,
    is_pointing,
    pointing_side,
    resolve_zone,
)

# Un-mirrored image: the patient's left is on the image right. Shoulder width 0.2.
POSE = {
    "nose": Point2(0.50, 0.25),
    "leye": Point2(0.52, 0.235),
    "reye": Point2(0.48, 0.235),
    "lmouth": Point2(0.515, 0.275),
    "rmouth": Point2(0.485, 0.275),
    "lear": Point2(0.55, 0.24),
    "rear": Point2(0.45, 0.24),
    "lshoulder": Point2(0.60, 0.40),
    "rshoulder": Point2(0.40, 0.40),
    "lelbow": Point2(0.66, 0.55),
    "relbow": Point2(0.34, 0.55),
    "lwrist": Point2(0.63, 0.66),
    "rwrist": Point2(0.37, 0.66),
    "lhip": Point2(0.58, 0.70),
    "rhip": Point2(0.42, 0.70),
    "lknee": Point2(0.58, 0.90, vis=0.1),
    "rknee": Point2(0.42, 0.90, vis=0.1),
}

# Image units per metre for something at body depth: shoulder width / assumed metres.
AT_BODY = 0.2 / DEFAULT_THRESHOLDS.assumed_shoulder_m
IN_FRONT = AT_BODY * 1.7  # held out in front of the body, toward the camera

MCP_X = {5: -0.03, 9: -0.01, 13: 0.01, 17: 0.03}
SHAPES = {  # fingertip distance from the wrist (m), index / middle / ring / pinky
    "point": (0.17, 0.07, 0.07, 0.07),
    "open": (0.17, 0.18, 0.17, 0.15),
    "fist": (0.07, 0.07, 0.07, 0.07),
}


def hand(at=(0.5, 0.46), shape="point", scale=AT_BODY, tilt=0.0) -> HandPose:
    """A hand with fingers up, its contact point at ``at``. ``scale`` is image units per metre;
    ``tilt`` tips the palm out of the image plane (z grows along the fingers)."""
    world = [(0.0, 0.0, 0.0)] * 21
    tips = SHAPES[shape]
    for f, (mcp, tip) in enumerate(((5, 8), (9, 12), (13, 16), (17, 20))):
        x = MCP_X[mcp]
        world[mcp] = (x, -0.09, -0.09 * tilt)
        world[mcp + 1] = (x, -0.12, -0.12 * tilt)  # PIP
        world[mcp + 2] = (x, -0.13, -0.13 * tilt)
        world[tip] = (x, -tips[f], -tips[f] * tilt)
    # Fist: fingertips curl back toward the palm.
    image = [Point2(x * scale, y * scale) for x, y, _ in world]
    probe = HandPose(image=tuple(image), world=tuple(world))
    c = contact_point(probe, gesture(probe))
    dx, dy = at[0] - c.x, at[1] - c.y
    image = [Point2(p.x + dx, p.y + dy) for p in image]
    return HandPose(image=tuple(image), world=tuple(world))


# --- hand shape --------------------------------------------------------------


def test_hand_shapes():
    assert is_pointing(hand(shape="point"))
    assert not is_pointing(hand(shape="open"))
    assert not is_pointing(hand(shape="fist"))
    assert gesture(hand(shape="open")) == "touch"


def test_point_contact_is_index_tip():
    h = hand(at=(0.4, 0.3), shape="point")
    assert contact_point(h, "point") == h.image[8]


def test_depth_ratio_body_vs_in_front():
    sw = 0.2
    assert depth_ratio(hand(scale=AT_BODY), sw) == pytest.approx(1.0, abs=0.01)
    assert depth_ratio(hand(scale=IN_FRONT), sw) == pytest.approx(1.7, abs=0.01)
    # A palm tipped away from the camera still measures by its in-plane edge.
    assert depth_ratio(hand(scale=AT_BODY, tilt=1.0), sw) == pytest.approx(1.0, abs=0.01)


def test_side_from_nearest_pose_wrist():
    assert pointing_side(hand(at=(0.37, 0.55)), POSE) == "r"
    assert pointing_side(hand(at=(0.63, 0.55)), POSE) == "l"


# --- zones -------------------------------------------------------------------


@pytest.mark.parametrize(
    "tip, zone",
    [
        ((0.50, 0.46), "chest"),  # sternum: both halves
        ((0.55, 0.46), "lchest"),  # patient's left
        ((0.45, 0.46), "rchest"),
        ((0.54, 0.54), "luq"),
        ((0.46, 0.54), "ruq"),
        ((0.54, 0.62), "llq"),
        ((0.46, 0.62), "rlq"),
        ((0.50, 0.58), "navel"),
        ((0.50, 0.67), "pelvis"),
        ((0.50, 0.25), "nose"),
        ((0.52, 0.235), "leye"),
        ((0.48, 0.235), "reye"),
        ((0.50, 0.275), "mouth"),
        ((0.50, 0.20), "forehead"),
        ((0.50, 0.30), "jaw"),
        ((0.53, 0.258), "lcheek"),
        ((0.47, 0.258), "rcheek"),
        ((0.55, 0.24), "lear"),
        ((0.50, 0.175), "head"),  # top of the head
        ((0.50, 0.34), "neck"),
        ((0.61, 0.40), "lshoulder"),
        ((0.39, 0.40), "rshoulder"),
        ((0.65, 0.50), "lupperarm"),
    ],
)
def test_resolves_zone(tip, zone):
    hit = resolve_zone(Point2(*tip), POSE, side="r")
    assert hit is not None and hit.zone == zone


def test_off_body_is_none():
    assert resolve_zone(Point2(0.95, 0.1), POSE, side="r") is None


def test_no_face_points_falls_back_to_head():
    no_face = {k: v for k, v in POSE.items() if k not in ("leye", "reye", "lmouth", "rmouth")}
    assert resolve_zone(Point2(0.50, 0.25), no_face, side="r").zone == "head"


def test_pointing_arm_is_skipped():
    on_right_forearm = Point2(0.355, 0.61)
    assert resolve_zone(on_right_forearm, POSE, side="l").zone == "rforearm"
    hit = resolve_zone(on_right_forearm, POSE, side="r")
    assert hit is None or hit.zone != "rforearm"


def test_touches_skip_hands_and_forearms():
    hit = resolve_zone(Point2(0.355, 0.61), POSE, side="l", arms=False)
    assert hit is None or hit.zone not in ("rforearm", "rhand")


def test_hidden_legs_give_no_knee():
    hit = resolve_zone(Point2(0.42, 0.90), POSE, side="r")
    assert hit is None or "knee" not in hit.zone


def test_hips_estimated_when_out_of_frame():
    seated = {k: v for k, v in POSE.items() if "hip" not in k}
    assert resolve_zone(Point2(0.46, 0.54), seated, side="r").zone == "ruq"


# --- tracker -----------------------------------------------------------------


def frame(t, pose=POSE, **kw):
    return BodyFrame(t_ms=t, pose=pose, hands=(hand(**kw),))


def run(tracker, frames):
    return [e for f, t in frames if (e := tracker.push(f, t))]


def test_point_emits_once_after_short_hold():
    events = run(PointingTracker(), [(frame(t, at=(0.55, 0.46)), t) for t in range(0, 1000, 33)])
    assert len(events) == 1
    e = events[0]
    assert (e.zone, e.gesture) == ("lchest", "point")
    assert 200 <= e.end_ms - e.start_ms < 250
    assert e.adds_to_clause


def test_touch_with_open_hand_emits_after_longer_hold():
    events = run(PointingTracker(), [(frame(t, at=(0.55, 0.46), shape="open"), t) for t in range(0, 1200, 33)])
    assert len(events) == 1
    e = events[0]
    assert (e.zone, e.gesture) == ("lchest", "touch")
    assert 700 <= e.end_ms - e.start_ms < 750
    assert e.confidence < 0.85  # a touch is weaker evidence than a point
    assert not e.adds_to_clause  # a suggestion until the patient confirms it


def test_hand_in_front_of_body_is_not_a_touch():
    frames = [(frame(t, at=(0.55, 0.46), shape="open", scale=IN_FRONT), t) for t in range(0, 1000, 33)]
    assert run(PointingTracker(), frames) == []


def test_hand_in_front_still_counts_when_pointing():
    frames = [(frame(t, at=(0.55, 0.46), shape="point", scale=IN_FRONT), t) for t in range(0, 600, 33)]
    assert [e.zone for e in run(PointingTracker(), frames)] == ["lchest"]


def test_touch_can_be_turned_off():
    from pointing import Thresholds

    tracker = PointingTracker(Thresholds(touch_enabled=False))
    assert run(tracker, [(frame(t, shape="open"), t) for t in range(0, 1000, 33)]) == []


def test_tapping_survives_brief_lift_off():
    # Tap, tap, tap: on the body 100 ms, off (in front) 100 ms.
    frames = [
        (frame(t, at=(0.55, 0.46), shape="fist", scale=AT_BODY if (t // 100) % 2 == 0 else IN_FRONT), t)
        for t in range(0, 1100, 33)
    ]
    events = run(PointingTracker(), frames)
    assert [e.zone for e in events] == ["lchest"]


def test_tracker_ignores_jitter_between_zones():
    tips = [(0.55, 0.46), (0.45, 0.46)]
    frames = [(frame(t, at=tips[i % 2]), t) for i, t in enumerate(range(0, 1000, 33))]
    assert run(PointingTracker(), frames) == []


def test_tracker_new_zone_after_hold():
    frames = [(frame(t, at=(0.55, 0.46)), t) for t in range(0, 400, 33)]
    frames += [(frame(t, at=(0.46, 0.54)), t) for t in range(400, 800, 33)]
    assert [e.zone for e in run(PointingTracker(), frames)] == ["lchest", "ruq"]


def test_tracker_dropouts():
    at = (0.55, 0.46)
    short = [(frame(t, at=at), t) for t in range(0, 100, 33)] + [(None, 150)]
    short += [(frame(t, at=at), t) for t in range(200, 300, 33)]
    assert len(run(PointingTracker(), short)) == 1
    long_gap = [(frame(t, at=at), t) for t in range(0, 150, 33)] + [(None, t) for t in range(150, 500, 33)]
    long_gap += [(frame(t, at=at), t) for t in range(500, 600, 33)]
    assert run(PointingTracker(), long_gap) == []


def test_hand_over_face_uses_recent_face_points():
    covered = {k: (Point2(v.x, v.y, 0.1) if k in ("nose", "leye", "reye", "lmouth", "rmouth") else v) for k, v in POSE.items()}
    frames = [(BodyFrame(t_ms=0, pose=POSE), 0)]  # face seen, no hand yet
    frames += [(frame(t, pose=covered, at=(0.50, 0.25)), t) for t in range(33, 600, 33)]
    assert [e.zone for e in run(PointingTracker(), frames)] == ["nose"]


def test_event_becomes_point_sign():
    sign = PointingEvent("luq", 0.8, 300, 700).to_sign_event()
    assert sign == {"label": "POINT-LUQ", "confidence": 0.8, "startMs": 300, "endMs": 700}


# --- filters against signs that touch the body ---------------------------------


def circling(t, radius=0.03, period=600, centre=(0.55, 0.46), shape="open"):
    import math

    a = 2 * math.pi * t / period
    return frame(t, at=(centre[0] + radius * math.cos(a), centre[1] + radius * math.sin(a)), shape=shape)


def test_circling_on_the_chest_is_a_sign_not_a_touch():
    # PLEASE / SORRY: a flat hand or fist circling on the chest.
    tracker = PointingTracker()
    assert run(tracker, [(circling(t), t) for t in range(0, 2500, 33)]) == []
    assert tracker.stats["moving"] >= 1


def test_point_at_middle_of_chest_is_me():
    tracker = PointingTracker()
    assert run(tracker, [(frame(t), t) for t in range(0, 600, 33)]) == []  # ME, then moves on


def test_long_point_at_middle_of_chest_counts():
    events = run(PointingTracker(), [(frame(t), t) for t in range(0, 1300, 33)])
    assert [(e.zone, e.end_ms - e.start_ms >= 1000) for e in events] == [("chest", True)]


def test_after_pain_middle_of_chest_is_quick():
    tracker = PointingTracker()
    tracker.note_sign("PAIN", 0)
    events = run(tracker, [(frame(t), t) for t in range(0, 600, 33)])
    assert [e.zone for e in events] == ["chest"]
    assert events[0].end_ms - events[0].start_ms < 250


def test_brief_touch_like_my_is_ignored():
    # MY: a flat hand on the chest for under half a second.
    frames = [(frame(t, at=(0.55, 0.46), shape="open"), t) for t in range(0, 450, 33)]
    frames += [(BodyFrame(t_ms=t, pose=POSE), t) for t in range(450, 1500, 33)]
    assert run(PointingTracker(), frames) == []


def test_resting_hand_does_not_retrigger():
    # A hand lying on the chest: counted once, then detection blinks and it is still there.
    at = (0.55, 0.46)
    frames = [(frame(t, at=at, shape="open"), t) for t in range(0, 1000, 33)]
    frames += [(BodyFrame(t_ms=t, pose=POSE), t) for t in range(1000, 1300, 33)]
    frames += [(frame(t, at=at, shape="open"), t) for t in range(1300, 4500, 33)]
    tracker = PointingTracker()
    assert len(run(tracker, frames)) == 1
    assert tracker.stats["resting"] >= 1


def test_touch_from_signing_space_counts_as_arrival():
    # The hand hovers in front of the chest, then moves back to touch it: little on-screen
    # movement, but the depth falls.
    at = (0.55, 0.46)
    tracker = PointingTracker()
    run(tracker, [(frame(t, at=at, shape="open", scale=IN_FRONT), t) for t in range(0, 1500, 33)])
    events = run(tracker, [(frame(t, at=at, shape="open"), t) for t in range(1500, 2400, 33)])
    assert [(e.zone, e.gesture) for e in events] == [("lchest", "touch")]
