from __future__ import annotations

import math

from .datatypes import Point2, Vec3


def d3(a: Vec3, b: Vec3) -> float:
    return math.dist(a, b)


def d2(a: Point2, b: Point2) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def seg_dist(p: Point2, a: Point2, b: Point2) -> float:
    """Distance from p to the segment a-b."""
    abx, aby = b.x - a.x, b.y - a.y
    L2 = abx * abx + aby * aby
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / L2))
    return math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby))


def lerp(a: Point2, b: Point2, t: float) -> Point2:
    return Point2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, min(a.vis, b.vis))
