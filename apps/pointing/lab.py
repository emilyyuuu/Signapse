"""Pointing lab: point at your own body, see the zone, send it to the screens.

Run with ``python -m pointing.lab``. Point at a body part (0.2 s; 1 s at the middle of the
chest, where pointing usually means ME) or touch / tap it with any hand shape (0.7 s) and
the zone is posted to /point. Only points join a clause. Keys:
  space   start / end a clause; at the end its signs (e.g. PAIN POINT-CHEST) go to /clauses
  p       PAIN was signed (stand-in until sign recognition exists): added to an open clause,
          and a point at the middle of the chest right after it counts as a location, not ME
  q / esc quit
Clauses from the lab are sent as statements; the real grammar flag comes from facial_grammar.
Only zone ids and sign labels are sent. Use --dry-run to print instead.
"""

from __future__ import annotations

import argparse
import time

import cv2

from . import BodyFrame, Point2, PointingEvent, PointingTracker, point_label
from .api_client import ApiClient
from .capture import frames

WHITE, GREEN, AMBER, RED = (255, 255, 255), (100, 230, 140), (40, 200, 255), (110, 110, 255)
SKELETON = [
    ("lshoulder", "rshoulder"),
    ("lshoulder", "lelbow"),
    ("lelbow", "lwrist"),
    ("rshoulder", "relbow"),
    ("relbow", "rwrist"),
    ("lshoulder", "lhip"),
    ("rshoulder", "rhip"),
    ("lhip", "rhip"),
]


def _text(img, s: str, y: int, color=WHITE, scale: float = 0.6) -> int:
    """Text on a dark translucent panel so it reads on any background. ``y`` is the top of
    the line; returns the y just below it, for the next line."""
    font, thick, pad = cv2.FONT_HERSHEY_SIMPLEX, 1 if scale < 0.7 else 2, 5
    (w, h), base = cv2.getTextSize(s, font, scale, thick)
    x0, y0, x1, y1 = 8, y, 8 + w + 2 * pad, y + h + base + 2 * pad
    H, W = img.shape[:2]
    x1, y1 = min(x1, W), min(y1, H)
    if x1 > x0 and y1 > y0:
        roi = img[y0:y1, x0:x1]
        img[y0:y1, x0:x1] = cv2.addWeighted(roi, 0.2, roi * 0, 0.8, 0)
    cv2.putText(img, s, (x0 + pad, y0 + pad + h), font, scale, color, thick, cv2.LINE_AA)
    return y1 + 2


def _px(p: Point2, w: int, h: int, mirror: bool) -> tuple[int, int]:
    """Back from aspect-corrected, un-mirrored coordinates to display pixels."""
    x = p.x / (w / h) * w
    return (int(w - x) if mirror else int(x), int(p.y * h))


def _draw_body(img, body: BodyFrame, mirror: bool) -> None:
    h, w = img.shape[:2]
    for a, b in SKELETON:
        pa, pb = body.pose.get(a), body.pose.get(b)
        if pa and pb and min(pa.vis, pb.vis) > 0.5:
            cv2.line(img, _px(pa, w, h, mirror), _px(pb, w, h, mirror), (200, 200, 200), 1, cv2.LINE_AA)


def run(camera: int, dry_run: bool) -> None:
    api = ApiClient(dry_run=dry_run)
    tracker = PointingTracker()
    clause: list[str] | None = None  # sign labels while a clause is open
    last_event: PointingEvent | None = None
    status = f"Encounter {api.encounter_id}. Point at a body part and hold."
    mirror = True
    fps, last_tick = 0.0, time.monotonic()

    for img, body, t_ms in frames(camera, mirror=mirror):
        now = time.monotonic()
        fps = 0.9 * fps + 0.1 / max(now - last_tick, 1e-3)
        last_tick = now
        event = tracker.push(body, t_ms)
        if event:
            last_event = event
            api.post_point(event.zone, event.confidence, event.gesture)
            # Only points join the clause; a touch is a suggestion the patient confirms on screen.
            label = point_label(event.zone)
            if event.adds_to_clause and clause is not None and (not clause or clause[-1] != label):
                clause.append(label)

        h, w = img.shape[:2]
        y = 8
        if body is None:
            y = _text(img, "No body", y, RED)
        else:
            _draw_body(img, body, mirror)
        cand = tracker.candidate
        if cand:
            color = GREEN if cand.progress >= 1 else AMBER
            cv2.circle(img, _px(cand.tip, w, h, mirror), 8, color, 2)
            depth = f"  depth {cand.depth:.2f}" if cand.depth is not None else ""
            y = _text(img, f"{cand.zone} ({cand.gesture}){depth}", y, color, 0.8)
            cv2.rectangle(img, (8, y), (8 + int(180 * cand.progress), y + 8), color, -1)
            y += 12
        if last_event:
            y = _text(img, f"sent: {last_event.zone} {last_event.gesture} ({last_event.confidence:.2f})", y)
        st = tracker.stats
        y = _text(
            img,
            f"{fps:.0f} fps  sent {st['emitted']}  ended: moved {st['moved']} lost {st['dropout']} repeat {st['repeat']}",
            y,
            scale=0.5,
        )
        _text(
            img,
            f"filtered: resting {st['resting']}  moving {st['moving']}  touch during point {st['touch_during_point']}",
            y,
            scale=0.5,
        )
        if clause is not None:
            _text(img, f"CLAUSE: {' '.join(clause) or '...'}  (space to end, p = PAIN)", h - 64, RED)
        _text(img, status, h - 32, scale=0.5)
        cv2.imshow("Signapse pointing lab", img)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        elif key == ord("p"):
            # Stand-in for sign recognition: after PAIN, a point at mid-chest is a location, not ME.
            tracker.note_sign("PAIN", t_ms)
            if clause is not None:
                clause.append("PAIN")
        elif key == ord(" "):
            if clause is None:
                clause = []
            else:
                if clause:
                    api.post_clause(clause)
                    status = f"Sent clause: {' '.join(clause)}"
                else:
                    status = "Empty clause, nothing sent."
                clause = None

    cv2.destroyAllWindows()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true", help="print events instead of posting them")
    args = parser.parse_args()
    run(args.camera, args.dry_run)


if __name__ == "__main__":
    main()
