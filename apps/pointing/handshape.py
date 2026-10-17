"""What the hand is doing: pointing or touching, where it makes contact, which arm, how deep."""

from __future__ import annotations

from .datatypes import DEFAULT_THRESHOLDS, Gesture, HandPose, Point2, Thresholds
from .features import (
    FINGERS,
    INDEX_MCP,
    INDEX_PIP,
    INDEX_TIP,
    MIDDLE_MCP,
    MIDDLE_TIP,
    PINKY_MCP,
    PINKY_TIP,
    RING_MCP,
    RING_TIP,
    WRIST,
)
from .geometry import d2, d3

Side = str  # "l" or "r", the patient's own side


def index_out(hand: HandPose, th: Thresholds = DEFAULT_THRESHOLDS) -> bool:
    """Index finger extended, whatever the other fingers do. Uses 3D world landmarks, because
    a finger pointed back at your own chest points away from the camera and looks curled in 2D."""
    w = hand.world
    return len(w) >= 21 and d3(w[INDEX_TIP], w[WRIST]) >= th.index_extend_ratio * d3(w[INDEX_PIP], w[WRIST])


def is_pointing(hand: HandPose, th: Thresholds = DEFAULT_THRESHOLDS) -> bool:
    """Index finger out, middle/ring/pinky curled."""
    w = hand.world
    if len(w) < 21:
        return False
    index_out = d3(w[INDEX_TIP], w[WRIST]) >= th.index_extend_ratio * d3(w[INDEX_PIP], w[WRIST])
    curled = all(
        d3(w[tip], w[WRIST]) <= th.curl_ratio * d3(w[mcp], w[WRIST])
        for tip, mcp in ((MIDDLE_TIP, MIDDLE_MCP), (RING_TIP, RING_MCP), (PINKY_TIP, PINKY_MCP))
    )
    return index_out and curled


def gesture(hand: HandPose, th: Thresholds = DEFAULT_THRESHOLDS) -> Gesture:
    return "point" if is_pointing(hand, th) else "touch"


def contact_point(hand: HandPose, g: Gesture, th: Thresholds = DEFAULT_THRESHOLDS) -> Point2:
    """Where the hand meets the body: the index tip when pointing; otherwise halfway between
    the palm centre and the extended fingertips (a flat hand, a fingertip tap or a fist)."""
    img, w = hand.image, hand.world
    if g == "point":
        return img[INDEX_TIP]
    palm = [img[i] for i in (WRIST, INDEX_MCP, MIDDLE_MCP, PINKY_MCP)]
    px, py = sum(p.x for p in palm) / 4, sum(p.y for p in palm) / 4
    tips = [img[tip] for mcp, tip in FINGERS if d3(w[tip], w[WRIST]) >= th.finger_out_ratio * d3(w[mcp], w[WRIST])]
    if tips:
        tx, ty = sum(p.x for p in tips) / len(tips), sum(p.y for p in tips) / len(tips)
        px, py = (px + tx) / 2, (py + ty) / 2
    return Point2(px, py, img[WRIST].vis)


def depth_ratio(hand: HandPose, shoulder_width: float, th: Thresholds = DEFAULT_THRESHOLDS) -> float:
    """How much closer to the camera the hand is than the shoulders, from apparent size:
    ~1.0 when touching the body, >1 when held out in front. Uses the palm edge that is most
    parallel to the image, so a hand turned edge-on does not look small."""
    best: tuple[float, float] | None = None  # (out-of-plane share, image/world scale)
    for a, b in ((WRIST, INDEX_MCP), (WRIST, PINKY_MCP), (INDEX_MCP, PINKY_MCP), (WRIST, MIDDLE_MCP)):
        world = d3(hand.world[a], hand.world[b])
        if world <= 1e-6:
            continue
        tilt = abs(hand.world[a][2] - hand.world[b][2]) / world
        scale = d2(hand.image[a], hand.image[b]) / world
        if best is None or tilt < best[0]:
            best = (tilt, scale)
    if best is None or shoulder_width <= 0:
        return 1.0
    return best[1] / (shoulder_width / th.assumed_shoulder_m)


def pointing_side(hand: HandPose, pose: dict[str, Point2]) -> Side | None:
    """Which arm the hand belongs to: the nearer pose wrist. MediaPipe's handedness label
    assumes a mirrored selfie image, so it is not used."""
    wrist = hand.image[WRIST]
    sides = [(s, d2(wrist, pose[f"{s}wrist"])) for s in ("l", "r") if f"{s}wrist" in pose]
    return min(sides, key=lambda x: x[1])[0] if sides else None
