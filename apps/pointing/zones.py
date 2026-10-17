"""Contact point on your own body -> body-map zone id.

Zone ids match packages/shared/src/bodyZones.ts. Only front and face zones resolve here; the
BACK sign turns them into back zones in language.ts, since a hand behind the body can't be
seen. Near the midline the chest resolves to "chest" (both halves) rather than guessing a side.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .datatypes import DEFAULT_THRESHOLDS, Point2, Thresholds
from .geometry import d2, lerp, seg_dist
from .handshape import Side

FACE_POINTS = ("nose", "leye", "reye", "lmouth", "rmouth")

# Fine zone -> the region it is part of (mirrors ZONE_PARENT in bodyZones.ts). "chest",
# "abdomen" and "head" are valid zone ids, so a hold split across parts can fall back to them.
ZONE_REGION = {
    "chest": "chest",
    "lchest": "chest",
    "rchest": "chest",
    **{z: "abdomen" for z in ("ruq", "luq", "rlq", "llq", "navel")},
    **{z: "head" for z in ("forehead", "leye", "reye", "nose", "lcheek", "rcheek", "mouth", "jaw", "lear", "rear")},
}


@dataclass(frozen=True)
class ZoneHit:
    zone: str
    confidence: float
    distance: float  # 0 inside the zone, else in shoulder widths


def _visible(pose: dict[str, Point2], th: Thresholds, *names: str) -> bool:
    return all(n in pose and pose[n].vis >= th.min_visibility for n in names)


def _offset(p: Point2, dx: float, dy: float) -> Point2:
    return Point2(p.x + dx, p.y + dy, p.vis)


def resolve_zone(
    tip: Point2,
    pose: dict[str, Point2],
    side: Side | None = None,
    th: Thresholds = DEFAULT_THRESHOLDS,
    arms: bool = True,
) -> ZoneHit | None:
    """Body-map zone under the contact point, or None if it is not on (or near) the body.

    ``side`` is the arm doing the pointing; its own upper arm, forearm and hand are skipped.
    ``arms=False`` skips both hands and forearms (used for touches: many signs touch the hand).
    """
    if not _visible(pose, th, "lshoulder", "rshoulder"):
        return None
    ls, rs = pose["lshoulder"], pose["rshoulder"]
    sw = d2(ls, rs)
    if sw <= 1e-6:
        return None

    # Seated at a laptop the hips are often out of frame: estimate them straight below.
    def hip(s: Side) -> Point2:
        name = f"{s}hip"
        if _visible(pose, th, name):
            return pose[name]
        sh = pose[f"{s}shoulder"]
        return Point2(sh.x, sh.y + 1.5 * sw, sh.vis)

    lh, rh = hip("l"), hip("r")
    # Distance in shoulder widths per zone. When the point is inside several, the first
    # listed wins, so smaller and more specific zones are listed first.
    dist: dict[str, float] = {}

    def capsule_pts(zone: str, a: Point2, b: Point2, radius: float) -> None:
        dist[zone] = max(0.0, seg_dist(tip, a, b) / sw - radius)

    def capsule(zone: str, a: str, b: str, radius: float) -> None:
        if _visible(pose, th, a, b):
            capsule_pts(zone, pose[a], pose[b], radius)

    def circle(zone: str, c: Point2, radius: float) -> None:
        dist[zone] = max(0.0, d2(tip, c) / sw - radius)

    face_margin = _face(tip, pose, th, sw, capsule_pts, circle)

    for s in ("l", "r"):
        own_arm = s == side
        if arms and not own_arm and _visible(pose, th, f"{s}wrist"):
            wrist = pose[f"{s}wrist"]
            knuckle = pose.get(f"{s}index")
            centre = lerp(wrist, knuckle, 0.5) if knuckle and knuckle.vis >= th.min_visibility else wrist
            circle(f"{s}hand", centre, 0.15)
        circle(f"{s}shoulder", pose[f"{s}shoulder"], 0.15)
        if not own_arm:
            capsule(f"{s}upperarm", f"{s}shoulder", f"{s}elbow", 0.14)
            if arms:
                capsule(f"{s}forearm", f"{s}elbow", f"{s}wrist", 0.11)
        capsule(f"{s}knee", f"{s}knee", f"{s}knee", 0.16)
        capsule(f"{s}thigh", f"{s}hip", f"{s}knee", 0.2)
        capsule(f"{s}shin", f"{s}knee", f"{s}ankle", 0.15)
        capsule(f"{s}foot", f"{s}ankle", f"{s}foot", 0.12)

    mid_sh = lerp(ls, rs, 0.5)
    if _visible(pose, th, "nose"):
        nose = pose["nose"]
        if _visible(pose, th, "lear", "rear"):
            r = 0.6 * d2(pose["lear"], pose["rear"]) / sw
        else:
            r = 0.35
        circle("head", Point2(nose.x, nose.y - 0.1 * sw), r)
        chin = lerp(nose, mid_sh, 0.45)
        capsule_pts("neck", chin, mid_sh, 0.12)

    _torso(tip, ls, rs, lh, rh, sw, th, dist)

    if not dist:
        return None
    zone = min(dist, key=lambda z: dist[z])
    # Inside the head, a fingertip just off a small face part still means that part.
    if zone == "head" and face_margin is not None:
        face = [z for z in dist if ZONE_REGION.get(z) == "head"]
        nearest = min(face, key=lambda z: dist[z])
        if dist[nearest] <= face_margin:
            zone = nearest
    d = dist[zone]
    if d > th.zone_margin:
        return None
    return ZoneHit(zone=zone, confidence=round(1.0 - 0.5 * d / th.zone_margin, 3), distance=d)


def _face(tip, pose, th, sw, capsule_pts, circle) -> float | None:
    """Face parts from the pose model's eye, nose and mouth points, in eye-distance units.
    Returns how far (in shoulder widths) off a face part still counts as on it, or None."""
    if not _visible(pose, th, *FACE_POINTS):
        return None
    le, re, nose = pose["leye"], pose["reye"], pose["nose"]
    lm, rm = pose["lmouth"], pose["rmouth"]
    ed = d2(le, re)
    if ed <= 1e-6:
        return None
    eyes, mouth = lerp(le, re, 0.5), lerp(lm, rm, 0.5)
    # "up" the face, from the mouth to the eyes, so a tilted head still works.
    ux, uy = eyes.x - mouth.x, eyes.y - mouth.y
    n = math.hypot(ux, uy) or 1.0
    ux, uy = ux / n * ed, uy / n * ed
    u = lambda e: e * ed / sw  # eye distances -> shoulder widths

    circle("leye", le, u(0.3))
    circle("reye", re, u(0.3))
    capsule_pts("nose", eyes, nose, u(0.22))
    capsule_pts("mouth", lm, rm, u(0.25))
    for s, eye, corner in (("l", le, lm), ("r", re, rm)):
        out_x, out_y = eye.x - eyes.x, eye.y - eyes.y
        cheek = _offset(lerp(eye, corner, 0.55), 0.6 * out_x, 0.6 * out_y)
        circle(f"{s}cheek", cheek, u(0.35))
        if _visible(pose, th, f"{s}ear"):
            circle(f"{s}ear", pose[f"{s}ear"], u(0.35))
    brow = _offset(eyes, 0.9 * ux, 0.9 * uy)
    lx, ly = (le.x - re.x) / 2, (le.y - re.y) / 2
    capsule_pts("forehead", _offset(brow, lx, ly), _offset(brow, -lx, -ly), u(0.35))
    chin = _offset(mouth, -0.6 * ux, -0.6 * uy)
    capsule_pts("jaw", _offset(chin, lx, ly), _offset(chin, -lx, -ly), u(0.3))
    return u(0.2)


def _torso(tip, ls, rs, lh, rh, sw, th, dist) -> None:
    """t runs 0 at the shoulder line to 1 at the hip line; `across` is positive toward the
    patient's left. Chest 0-0.4 (left / right / midline), abdomen 0.4-0.8 in four quadrants
    with the navel in the middle, pelvis 0.8-1.1."""
    mid_sh, mid_hip = lerp(ls, rs, 0.5), lerp(lh, rh, 0.5)
    ax, ay = mid_hip.x - mid_sh.x, mid_hip.y - mid_sh.y
    torso_len2 = ax * ax + ay * ay
    if torso_len2 <= 0:
        return
    t = ((tip.x - mid_sh.x) * ax + (tip.y - mid_sh.y) * ay) / torso_len2
    left, right = lerp(ls, lh, t), lerp(rs, rh, t)
    half = d2(left, right) / 2
    if half <= 0:
        return
    centre = lerp(left, right, 0.5)
    across = ((tip.x - centre.x) * (left.x - right.x) + (tip.y - centre.y) * (left.y - right.y)) / (2 * half)
    torso_len = math.sqrt(torso_len2) / sw

    def band(t0: float, t1: float) -> float:
        return max(0.0, t0 - t, t - t1) * torso_len

    def lateral(lo: float, hi: float) -> float:  # across range in half-widths
        return max(0.0, lo * half - across, across - hi * half) / sw

    mid = th.midline
    dist["navel"] = math.hypot(lateral(-mid, mid), band(0.53, 0.67))
    dist["chest"] = math.hypot(lateral(-mid, mid), band(0.0, 0.4))  # sternum: both halves
    for s, lo, hi in (("l", 0.0, 1.0), ("r", -1.0, 0.0)):
        dist[f"{s}chest"] = math.hypot(lateral(lo, hi), band(0.0, 0.4))
        dist[f"{s}uq"] = math.hypot(lateral(lo, hi), band(0.4, 0.6))
        dist[f"{s}lq"] = math.hypot(lateral(lo, hi), band(0.6, 0.8))
    dist["pelvis"] = math.hypot(lateral(-1.0, 1.0), band(0.8, 1.1))
