"""Turns per-frame pointing and touching into one event per steady hold.

Frame-to-frame input is noisy: the contact point jitters across zone edges (the zones are
small) and a half-curled hand flips between "point" and "touch". So a hold is decided by
whether the *hand* stays still, measured at the palm, which is stable whatever the gesture.
The zone and the gesture are then voted on over the whole hold instead of being required to
match every frame.

Each hand has its own hold, so a hand resting on the body can't block or hijack the other
hand's point. Points and touches vote separately: while the index finger is out, a frame
votes with the fingertip even if it reads as a touch, so a flickering point isn't dragged to
where the palm is. And no touch is reported while a point is in progress.
"""

from __future__ import annotations

import math
from collections import Counter, deque
from dataclasses import dataclass, field

from .datatypes import DEFAULT_THRESHOLDS, BodyFrame, Gesture, HandPose, Point2, PointingEvent, Thresholds
from .features import INDEX_MCP, MIDDLE_MCP, PINKY_MCP, WRIST
from .geometry import d2
from .handshape import contact_point, depth_ratio, gesture, index_out, pointing_side
from .zones import FACE_POINTS, ZONE_REGION, ZoneHit, resolve_zone

FACE_NAMES = (*FACE_POINTS, "lear", "rear")
# Signs after which a point at the middle of the chest means "there" rather than ME.
PAIN_SIGNS = frozenset({"PAIN", "HURT", "SICK", "ACHE"})
# The midline chest: where the sign ME points.
ME_ZONES = frozenset({"chest"})


@dataclass(frozen=True)
class Candidate:
    zone: str
    gesture: Gesture
    progress: float  # 0..1 of the hold time
    tip: Point2
    depth: float | None = None  # touch only: depth_ratio, for tuning in the lab


@dataclass(frozen=True)
class _Seen:
    """One hand in one frame. ``point`` is where the fingertip lands (when the index finger
    is out at all); ``touch`` is where the hand lands as a touch (at body depth only)."""

    hand: HandPose
    palm: Point2
    gesture: Gesture
    depth: float
    point: tuple[ZoneHit, Point2] | None
    touch: tuple[ZoneHit, Point2] | None


@dataclass
class _Hold:
    start_ms: float
    palm: Point2  # mean palm position over the hold; one noisy frame can't move it far
    last_seen_ms: float
    point_votes: Counter = field(default_factory=Counter)  # zone -> summed confidence
    touch_votes: Counter = field(default_factory=Counter)
    points: int = 0
    frames: int = 0
    emitted: bool = False
    resting: bool = False  # the hand was already there: not a deliberate gesture
    moving_flagged: bool = False
    blocked_flagged: bool = False
    trail: list[tuple[float, Point2]] = field(default_factory=list)  # (t_ms, palm)
    tip: Point2 | None = None
    depth: float | None = None

    def add(self, seen: _Seen, t_ms: float) -> None:
        n = self.frames
        self.palm = Point2((self.palm.x * n + seen.palm.x) / (n + 1), (self.palm.y * n + seen.palm.y) / (n + 1))
        self.trail.append((t_ms, seen.palm))
        if seen.point:
            self.point_votes[seen.point[0].zone] += seen.point[0].confidence
        if seen.touch:
            self.touch_votes[seen.touch[0].zone] += seen.touch[0].confidence
        self.points += seen.gesture == "point"
        self.frames += 1
        self.last_seen_ms = t_ms
        on = seen.point if self.gesture == "point" and seen.point else seen.touch or seen.point
        self.tip, self.depth = on[1], seen.depth

    point_share: float = 0.3

    @property
    def gesture(self) -> Gesture:
        return "point" if self.point_votes and self.points >= self.point_share * self.frames else "touch"

    def zone(self) -> tuple[str, float] | None:
        """Most-voted zone and its share, from the fingertip votes for a point and the hand
        votes for a touch. On a boundary between parts of one region (left and right chest, two
        quadrants) with no majority, the whole region is the honest answer."""
        votes = self.point_votes if self.gesture == "point" else self.touch_votes
        total = sum(votes.values())
        if not total:
            return None
        zone, top = votes.most_common(1)[0]
        share = top / total
        if share < 0.5:
            regions = Counter()
            for z, v in votes.items():
                regions[ZONE_REGION.get(z, z)] += v
            region, r_top = regions.most_common(1)[0]
            if r_top / total >= 0.6 and region != zone:
                return region, r_top / total
        return zone, share

    def confidence(self, share: float) -> float:
        votes = self.point_votes if self.gesture == "point" else self.touch_votes
        conf = sum(votes.values()) / self.frames * share  # mean zone fit, scaled by agreement
        return conf if self.gesture == "point" else conf * 0.8  # a touch says less about intent

    def spread(self, since_ms: float, smooth: int) -> float:
        """RMS distance of the palm from its mean since ``since_ms``, after a short moving
        average so per-frame detector noise doesn't count as movement."""
        pts = [p for t, p in self.trail if t >= since_ms]
        if len(pts) < smooth + 1:
            return 0.0
        sm = [
            Point2(sum(p.x for p in pts[i : i + smooth]) / smooth, sum(p.y for p in pts[i : i + smooth]) / smooth)
            for i in range(len(pts) - smooth + 1)
        ]
        mx, my = sum(p.x for p in sm) / len(sm), sum(p.y for p in sm) / len(sm)
        return math.sqrt(sum((p.x - mx) ** 2 + (p.y - my) ** 2 for p in sm) / len(sm))



def _palm(hand: HandPose) -> Point2:
    pts = [hand.image[i] for i in (WRIST, INDEX_MCP, MIDDLE_MCP, PINKY_MCP)]
    return Point2(sum(p.x for p in pts) / 4, sum(p.y for p in pts) / 4)


class PointingTracker:
    """Feed it every BodyFrame; it returns a PointingEvent once a hand arrives on the body and
    stays still long enough: ``point_hold_ms`` if the hold was mostly an index-finger point,
    else ``touch_hold_ms``, and ``me_hold_ms`` for the middle of the chest. One event per hold.
    A hold ends when its hand moves more than ``max_jitter`` or is gone for longer than
    ``dropout_ms`` (a tap lifts off briefly).

    Filters against signs that touch the body: the hand must arrive (a resting hand never
    counts), stay still over the whole window (circling signs fail), touches need a longer
    hold, and a point at the middle of the chest is taken as ME unless held or after PAIN."""

    def __init__(self, th: Thresholds = DEFAULT_THRESHOLDS) -> None:
        self.th = th
        self._holds: list[_Hold] = []  # one per hand on the body
        # Every hand's (palm, depth) per frame, on the body or not, to tell an arrival from a
        # resting hand.
        self._palms: deque[tuple[float, tuple[tuple[Point2, float], ...]]] = deque()
        self._first_ms: float | None = None
        self._pain_until_ms = -math.inf
        self._face: dict[str, tuple[Point2, float]] = {}  # name -> (point, t_ms)
        self._last: PointingEvent | None = None
        self._last_point_ms = -math.inf
        self.candidate: Candidate | None = None
        # Why holds ended or were held back, for tuning in the lab.
        self.stats: Counter = Counter()

    def reset(self) -> None:
        self._holds, self.candidate = [], None

    def note_sign(self, label: str, t_ms: float) -> None:
        """Tell the tracker what was just signed. After PAIN/HURT/SICK a point at the middle of
        the chest is a location, not the sign ME, so it gets the normal short hold."""
        if label in PAIN_SIGNS:
            self._pain_until_ms = t_ms + self.th.pain_context_ms

    def _remember_palms(self, frame: BodyFrame | None, t_ms: float, sw: float) -> None:
        if self._first_ms is None:
            self._first_ms = t_ms
        hands = tuple((_palm(h), depth_ratio(h, sw, self.th)) for h in frame.hands) if frame and sw > 0 else ()
        self._palms.append((t_ms, hands))
        while self._palms and t_ms - self._palms[0][0] > self.th.approach_ms:
            self._palms.popleft()

    def _arrived(self, palm: Point2, depth: float, t_ms: float, sw: float) -> bool:
        """Did this hand come here, rather than rest here? True if, at the start of the
        approach window, it was missing, at least min_approach away on screen, or nearer the
        camera by min_depth_approach (it came back from signing space to touch)."""
        if t_ms - self._first_ms < 0.5 * self.th.approach_ms:
            return True  # just started watching: give the benefit of the doubt
        window = [ps for tt, ps in self._palms if t_ms - tt <= self.th.approach_ms]
        if not window:
            return True  # nothing seen lately (a gap in the feed): the hand came back
        then = [min(ps, key=lambda h: d2(h[0], palm)) for ps in window[:3] if ps]
        if not then:
            return True
        moved = min(d2(p, palm) for p, _ in then) / sw >= self.th.min_approach
        came_back = max(d for _, d in then) - depth >= self.th.min_depth_approach
        return moved or came_back

    def _hold_needed(self, hold: _Hold, zone: str, t_ms: float) -> float:
        need = self.th.point_hold_ms if hold.gesture == "point" else self.th.touch_hold_ms
        if zone in ME_ZONES and t_ms > self._pain_until_ms:
            need = max(need, self.th.me_hold_ms)
        return need

    def _with_face(self, pose: dict[str, Point2], t_ms: float) -> dict[str, Point2]:
        """A hand over the face hides the face points; reuse ones seen in the last moment."""
        merged = dict(pose)
        for name in FACE_NAMES:
            p = pose.get(name)
            if p is not None and p.vis >= self.th.min_visibility:
                self._face[name] = (p, t_ms)
            elif name in self._face and t_ms - self._face[name][1] <= self.th.face_cache_ms:
                merged[name] = self._face[name][0]
        return merged

    def _observe(self, frame: BodyFrame, pose: dict[str, Point2], sw: float) -> list[_Seen]:
        seen = []
        for hand in frame.hands:
            g = gesture(hand, self.th)
            side = pointing_side(hand, pose)
            depth = depth_ratio(hand, sw, self.th)
            point = touch = None
            if index_out(hand, self.th):
                tip = contact_point(hand, "point", self.th)
                if hit := resolve_zone(tip, pose, side, self.th):
                    point = (hit, tip)
            # Once a hold has started, a touch may drift a little deeper before it stops counting.
            near = any(d2(_palm(hand), h.palm) / sw <= self.th.max_jitter for h in self._holds)
            max_depth = self.th.max_touch_depth * (1.15 if near else 1.0)
            if self.th.touch_enabled and depth <= max_depth:
                tip = contact_point(hand, "touch", self.th)
                if hit := resolve_zone(tip, pose, side, self.th, arms=False):
                    touch = (hit, tip)
            if g == "point" and not point:
                g = "touch"
            if point or touch:
                seen.append(_Seen(hand, _palm(hand), g, depth, point, touch))
        return seen

    def _match(self, seen: list[_Seen], sw: float, prior, frame: BodyFrame, t_ms: float) -> None:
        """Give each hand seen this frame to its hold (the nearest, within max_jitter), or
        start a new hold for it."""
        unused = list(self._holds)
        kept: list[_Hold] = []
        for s in seen:
            hold = min(unused, key=lambda h: d2(s.palm, h.palm), default=None)
            if hold and d2(s.palm, hold.palm) / sw <= self.th.max_jitter:
                unused.remove(hold)
            else:
                if hold and t_ms - hold.last_seen_ms <= self.th.dropout_ms and len(seen) == 1:
                    self.stats["moved"] += 1  # the only hand moved off its hold
                    unused.remove(hold)
                hold = _Hold(start_ms=t_ms, palm=s.palm, last_seen_ms=t_ms, point_share=self.th.point_share)
                live = self._palms
                self._palms = deque(prior)  # judge the arrival by frames before this one
                hold.resting = not self._arrived(s.palm, s.depth, t_ms, sw)
                self._palms = live
                if hold.resting:
                    self.stats["resting"] += 1
            hold.add(s, t_ms)
            kept.append(hold)
        # Holds whose hand wasn't seen this frame survive a short dropout.
        for hold in unused:
            if t_ms - hold.last_seen_ms <= self.th.dropout_ms:
                kept.append(hold)
            else:
                self.stats["dropout"] += 1
        self._holds = kept

    def _ready(self, hold: _Hold, t_ms: float, sw: float) -> tuple[str, float, float] | None:
        """(zone, share, progress) for a hold; progress 1 means it may emit now."""
        z = hold.zone()
        if not z:
            return None
        zone, share = z
        need = self._hold_needed(hold, zone, t_ms)
        progress = min(1.0, (t_ms - hold.start_ms) / need)
        if progress >= 1 and hold.spread(t_ms - need, self.th.smooth_frames) / sw > self.th.max_spread:
            # Still for the whole hold window, not just near its mean: circling signs fail here.
            if not hold.moving_flagged:
                hold.moving_flagged = True
                self.stats["moving"] += 1
            progress = 0.99
        return zone, share, progress

    def push(self, frame: BodyFrame | None, t_ms: float) -> PointingEvent | None:
        pose = self._with_face(frame.pose, t_ms) if frame else {}
        prior = list(self._palms)
        if "lshoulder" not in pose or "rshoulder" not in pose:
            self._remember_palms(None, t_ms, 0.0)
            self._holds = [h for h in self._holds if t_ms - h.last_seen_ms <= self.th.dropout_ms]
            return None
        sw = d2(pose["lshoulder"], pose["rshoulder"])
        if sw <= 0:
            return None
        self._remember_palms(frame, t_ms, sw)
        self._match(self._observe(frame, pose, sw), sw, prior, frame, t_ms)

        ready = [(h, r) for h in self._holds if (r := self._ready(h, t_ms, sw))]
        # Show and emit points first: a point is the deliberate message.
        ready.sort(key=lambda hr: (hr[0].gesture != "point", -hr[1][2]))
        live = [hr for hr in ready if not hr[0].resting and not hr[0].emitted]
        top = (live or ready or [None])[0]
        if top:
            h, (zone, _, progress) = top
            self.candidate = Candidate(zone, h.gesture, progress, h.tip, h.depth if h.gesture == "touch" else None)
        else:
            self.candidate = None

        pointing = any(h.gesture == "point" and not h.resting for h in self._holds)
        for hold, (zone, share, progress) in live:
            if progress < 1:
                continue
            if hold.gesture == "touch" and (pointing or t_ms - self._last_point_ms < self.th.repeat_ms):
                # A point is in progress or just happened: the other hand's touch is not the message.
                if not hold.blocked_flagged:
                    hold.blocked_flagged = True
                    self.stats["touch_during_point"] += 1
                continue
            hold.emitted = True
            last = self._last
            if last and last.zone == zone and t_ms - last.end_ms < self.th.repeat_ms:
                # A shaky hold that broke and restarted on the same spot: not a new gesture.
                self.stats["repeat"] += 1
                continue
            self.stats["emitted"] += 1
            self._last = PointingEvent(
                zone=zone,
                confidence=round(hold.confidence(share), 3),
                start_ms=hold.start_ms,
                end_ms=t_ms,
                gesture=hold.gesture,
            )
            if hold.gesture == "point":
                self._last_point_ms = t_ms
            return self._last
        return None
