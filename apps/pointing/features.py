from __future__ import annotations

from typing import Any

from .datatypes import BodyFrame, HandPose, Point2

# MediaPipe Pose landmark indices we use. "left" is the patient's own left when
# the model sees the un-mirrored camera image.
POSE_NAMES = {
    0: "nose",
    2: "leye",
    5: "reye",
    7: "lear",
    8: "rear",
    9: "lmouth",
    10: "rmouth",
    11: "lshoulder",
    12: "rshoulder",
    13: "lelbow",
    14: "relbow",
    15: "lwrist",
    16: "rwrist",
    19: "lindex",
    20: "rindex",
    23: "lhip",
    24: "rhip",
    25: "lknee",
    26: "rknee",
    27: "lankle",
    28: "rankle",
    31: "lfoot",
    32: "rfoot",
}

# Hand landmark indices.
WRIST = 0
INDEX_MCP, INDEX_PIP, INDEX_TIP = 5, 6, 8
MIDDLE_MCP, MIDDLE_TIP = 9, 12
RING_MCP, RING_TIP = 13, 16
PINKY_MCP, PINKY_TIP = 17, 20
FINGERS = ((INDEX_MCP, INDEX_TIP), (MIDDLE_MCP, MIDDLE_TIP), (RING_MCP, RING_TIP), (PINKY_MCP, PINKY_TIP))


def _pt(lm: Any, aspect: float) -> Point2:
    vis = getattr(lm, "visibility", None)
    return Point2(x=float(lm.x) * aspect, y=float(lm.y), vis=1.0 if vis is None else float(vis))


def extract_body(pose_result: Any, hand_result: Any, t_ms: float, aspect: float) -> BodyFrame | None:
    """Build a BodyFrame from MediaPipe PoseLandmarker and HandLandmarker results, or None if no body.

    ``aspect`` is image width / height. Works on any objects with ``pose_landmarks``,
    ``hand_landmarks`` and ``hand_world_landmarks`` lists, so tests can pass fakes.
    """
    if not pose_result.pose_landmarks:
        return None
    lms = pose_result.pose_landmarks[0]
    pose = {name: _pt(lms[i], aspect) for i, name in POSE_NAMES.items() if i < len(lms)}

    hands: list[HandPose] = []
    if hand_result is not None:
        for img, world in zip(hand_result.hand_landmarks or [], hand_result.hand_world_landmarks or []):
            hands.append(
                HandPose(
                    image=tuple(_pt(p, aspect) for p in img),
                    world=tuple((float(p.x), float(p.y), float(p.z)) for p in world),
                )
            )
    return BodyFrame(t_ms=t_ms, pose=pose, hands=tuple(hands))
