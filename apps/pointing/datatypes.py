from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Point2:
    """Image point. x is scaled by width/height so distances are the same in every direction."""

    x: float
    y: float
    vis: float = 1.0


Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class HandPose:
    """The 21 MediaPipe hand landmarks: image points for where, world points (metres) for shape."""

    image: tuple[Point2, ...]
    world: tuple[Vec3, ...]


@dataclass(frozen=True)
class BodyFrame:
    """Pose landmarks by name (see features.POSE_NAMES) and the hands seen in one frame."""

    t_ms: float
    pose: dict[str, Point2]
    hands: tuple[HandPose, ...] = ()


def point_label(zone: str) -> str:
    """Sign label for a pointed zone, e.g. POINT-CHEST. Read back by complaintOf in language.ts."""
    return f"POINT-{zone.upper()}"


Gesture = str  # "point" (index finger out) or "touch" (any hand shape on the body)


@dataclass(frozen=True)
class PointingEvent:
    zone: str  # body-map zone id from packages/shared/src/bodyZones.ts
    confidence: float
    start_ms: float
    end_ms: float
    gesture: Gesture = "point"

    @property
    def adds_to_clause(self) -> bool:
        """Only points go into a clause's signs. A touch is a suggestion: it highlights the zone
        and opens the pain picker, and becomes a record only when the patient confirms it."""
        return self.gesture == "point"

    def to_sign_event(self) -> dict[str, float | str]:
        """Same shape as SignEvent in packages/shared/src/types.ts, so it can join a clause's signs."""
        return {
            "label": point_label(self.zone),
            "confidence": self.confidence,
            "startMs": self.start_ms,
            "endMs": self.end_ms,
        }


@dataclass(frozen=True)
class Thresholds:
    """Starting values. Tune them in the lab, not by guessing. Lengths are in shoulder widths."""

    index_extend_ratio: float = 1.3  # index tip-wrist vs index PIP-wrist (3D)
    curl_ratio: float = 1.35  # other fingertips-wrist vs their MCP-wrist (3D), at most
    finger_out_ratio: float = 1.5  # a fingertip this much further than its MCP counts as extended
    point_hold_ms: float = 200.0
    # A hold is a point if at least this share of its frames read as a point. A flat hand
    # practically never reads as one, while a real point flickers to "touch" now and then.
    point_share: float = 0.3
    # Touching is a looser signal: signs like MY touch the body for well under half a second.
    touch_hold_ms: float = 700.0
    # An index point at the middle of the chest is usually the sign ME, not a location. It only
    # counts if held this long, unless a PAIN-type sign came just before (see pain_context_ms).
    me_hold_ms: float = 1000.0
    pain_context_ms: float = 3000.0
    # A deliberate point or touch arrives and stops. Resting hands (no arrival) never count:
    # the palm must have moved at least min_approach in the approach_ms before the hold.
    # Moving in toward the body (mostly depth, little on-screen) counts too: depth_ratio falling
    # by at least min_depth_approach.
    approach_ms: float = 800.0
    min_approach: float = 0.25
    min_depth_approach: float = 0.2
    # Signs that touch the body keep moving (PLEASE and SORRY circle the chest). The palm's RMS
    # spread over the hold window, after light smoothing, must stay under this.
    max_spread: float = 0.08
    smooth_frames: int = 3
    touch_enabled: bool = True
    # How much bigger the hand may look than the body at the same depth before it counts
    # as in front of the body (signing space) rather than touching it. 1.0 = same depth.
    max_touch_depth: float = 1.35
    assumed_shoulder_m: float = 0.33  # distance between the pose shoulder landmarks
    dropout_ms: float = 250.0  # missed detections tolerated inside a hold (taps lift off)
    repeat_ms: float = 1500.0  # the same zone again this soon is the same gesture, not a new one
    max_jitter: float = 0.2  # palm movement that ends a hold, vs the hold's mean position
    zone_margin: float = 0.2
    # Within this fraction of the half-width from the midline: chest / navel, not a side.
    midline: float = 0.18
    min_visibility: float = 0.5
    face_cache_ms: float = 1500.0  # a hand over the face hides it; reuse recent face points


DEFAULT_THRESHOLDS = Thresholds()
