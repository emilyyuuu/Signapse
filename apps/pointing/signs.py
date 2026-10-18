"""Sign recognition in the camera loop, using the recorded-sign model from apps/recognition-python.

The patient page opens a signing session ("Start signing"). While it is open, each time the
hands come up and go down again is one sign: the frames in between are matched against the
recorded examples (DTW + kNN, apps/recognition-python/app/recognition). Points at the body
join the clause as POINT-<ZONE>. The face during the signs gives the grammar flag (face.py, using
apps/facial_grammar). "Done" sends the sign labels, flag and marker scores to /clauses, which
makes a draft the patient checks before anything reaches the doctor.

Hand and face points stay in this process. Only sign labels and marker scores leave it.
"""

from __future__ import annotations

import math
import os
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from .paths import SIGN_MODEL_DIR

# Model label -> gloss token used by the rest of Signapse (packages/shared/src/language.ts).
LABEL_TO_GLOSS = {
    "chest": "CHEST",
    "face": "FACE",
    "fever": "FEVER",
    "headache": "HEADACHE",
    "jaw": "JAW",
    "nausea": "NAUSEA",
    "pain": "PAIN",
    "stomach": "STOMACH",
}

# Body-part signs. The patient signs what they feel; where it hurts is picked in the next
# step, so these are left out of the clause.
PLACE_SIGNS = frozenset({"CHEST", "FACE", "JAW", "STOMACH", "HEAD", "BACK"})

# Measured on the recorded model (leave-one-out): correct matches are at most ~1.5 away,
# random hand movement ~3. Further than this is "didn't catch that".
MAX_DISTANCE = 2.0


def to_gloss(label: str) -> str:
    return LABEL_TO_GLOSS.get(label, label.upper().replace(" ", "-"))


def confidence_of(distance: float) -> float:
    """0.99 for a near-perfect match, 0.7 at distance 1.5, 0.6 at the cutoff."""
    return round(max(0.3, min(0.99, 1.0 - 0.2 * distance)), 3)


def hands_array(hand_result: Any) -> np.ndarray:
    """(2, 21, 3) hand points in the layout the model was recorded with.

    The recorder ran MediaPipe on the mirrored (selfie) image and put the hand labelled "Left"
    in slot 0. This loop runs on the un-mirrored image, so x is flipped back (1 - x) and the
    labels, which flip with the image, are swapped. Missing hands are NaN.
    """
    out = np.full((2, 21, 3), np.nan, dtype=np.float32)
    if hand_result is None:
        return out
    for hand, handed in zip(hand_result.hand_landmarks or [], hand_result.handedness or []):
        label = handed[0].category_name if handed else ""
        slot = 0 if label == "Right" else 1 if label == "Left" else None
        if slot is None or len(hand) < 21:
            continue
        out[slot] = [(1.0 - float(p.x), float(p.y), float(p.z)) for p in hand[:21]]
    return out


def mirrored(seq: np.ndarray) -> np.ndarray:
    """The same signing done with the other hand: hands swapped and x flipped."""
    flipped = seq[:, ::-1].copy()
    flipped[..., 0] = 1.0 - flipped[..., 0]
    return flipped


class SignModel:
    """Wraps the recognition-python pipeline. Matches both hands' versions of a sign, so a
    left-handed and a right-handed signer both match the recorded examples."""

    def __init__(self, model_dir: Path | None = None, k: int = 3) -> None:
        model_dir = Path(os.environ.get("SIGNAPSE_SIGN_MODEL") or model_dir or SIGN_MODEL_DIR)
        app_dir = model_dir.parents[1]  # .../recognition-python/app
        if str(app_dir) not in sys.path:
            sys.path.insert(0, str(app_dir))
        from model_loader import load_model  # type: ignore[import-not-found]
        from recognition.pipeline import RecognitionPipeline  # type: ignore[import-not-found]

        templates, labels, config = load_model(model_dir)
        self.pipeline = RecognitionPipeline(templates=templates, labels=labels, k=k)
        self.signs = sorted(to_gloss(s) for s in config.get("supported_signs", set(labels)))

    def predict(self, frames: list[np.ndarray]) -> tuple[str | None, float]:
        seq = np.stack(frames).astype(np.float32)
        best: tuple[str | None, float] = (None, math.inf)
        for candidate in (seq, mirrored(seq)):
            label, distance = self.pipeline.predict(list(candidate))
            if label is not None and distance < best[1]:
                best = (label, float(distance))
        return best


# send(gloss, confidence, grammar_flag, nmm)
Send = Callable[[list[str], "float | None", str, "dict[str, float | str] | None"], None]


class FaceLike(Protocol):
    def start(self) -> None: ...
    def cancel(self) -> None: ...
    def finish(self, start_ms: float | None, end_ms: float | None) -> tuple[str, dict | None]: ...


@dataclass
class Word:
    gloss: str | None  # None while it is still being recognised
    confidence: float = 0.0
    t_ms: float = 0.0


@dataclass
class SegmentRules:
    start_frames: int = 3  # hands seen this many frames in a row: a sign has started
    end_gap_ms: float = 450.0  # hands gone this long: the sign is over
    # A sign longer than this is cut and matched anyway (hands resting in view never "go down").
    # Some recorded examples are ~5 s long, so this must stay above that.
    max_ms: float = 6000.0
    min_frames: int = 8  # fewer frames with hands than this: too short to be a sign
    preroll: int = 4  # frames kept from just before the hands appeared
    idle_cancel_ms: float = 90_000.0  # no hands for this long: the session closes by itself
    point_overlap_ms: float = 300.0  # a point this close to a sign means the movement was the point


@dataclass
class _Segment:
    start_ms: float
    frames: list[np.ndarray] = field(default_factory=list)
    with_hands: int = 0
    last_seen_ms: float = 0.0


class SignSession:
    """Turns a stream of hand frames into words while the patient's session is open.

    Thread-safe: the camera loop calls push()/note_point(), the preview server calls
    start()/finish()/cancel()/status(). Recognition runs on one worker thread, in order.
    """

    def __init__(
        self,
        model: SignModel | None,
        send: Send,
        rules: SegmentRules | None = None,
        on_sign: Callable[[str, float], None] | None = None,
        error: str | None = None,
        face: FaceLike | None = None,
    ) -> None:
        self.model = model
        self.error = error
        self.face = face
        self._span: list[float] = []  # first sign start, last sign end
        self._send = send
        self._on_sign = on_sign
        self.rules = rules or SegmentRules()
        self._lock = threading.Lock()
        self._open = False
        self._words: list[Word] = []
        self._seg: _Segment | None = None
        self._streak: list[np.ndarray] = []
        self._recent: list[np.ndarray] = []
        self._points: list[float] = []  # t_ms of points during the session
        self._last_hands_ms = 0.0
        self._now_ms = 0.0
        self._note: str | None = None
        self._sent: list[str] | None = None
        self._flag: str | None = None
        self._seq = 0
        self._busy = 0
        self._jobs: list[threading.Thread] = []
        self._worker_lock = threading.Lock()

    # ---- page controls -------------------------------------------------------------------

    def start(self) -> dict:
        with self._lock:
            if self.model is None:
                return {"ok": False, "error": self.error or "Sign recognition is not available."}
            self._open = True
            self._words, self._points, self._seg, self._streak, self._span = [], [], None, [], []
            self._note, self._sent, self._flag = None, None, None
            if self.face:
                self.face.start()
            self._last_hands_ms = self._now_ms
            self._seq += 1
            return {"ok": True}

    def cancel(self) -> dict:
        with self._lock:
            self._open = False
            self._words, self._seg, self._streak = [], None, []
            self._note = None
            self._seq += 1
            if self.face:
                self.face.cancel()
        return {"ok": True}

    def finish(self, wait_s: float = 3.0) -> dict:
        """Close the session and send what was signed. Waits briefly for signs still being matched."""
        with self._lock:
            if not self._open:
                return {"ok": False, "error": "Signing is not on."}
            seg, self._seg = self._seg, None
            self._open = False
        if seg is not None:
            self._recognise(seg)
        deadline = time.monotonic() + wait_s
        for job in list(self._jobs):
            job.join(max(0.0, deadline - time.monotonic()))
        with self._lock:
            gloss = _dedupe([w.gloss for w in self._words if w.gloss])
            confs = [w.confidence for w in self._words if w.gloss]
            span = (min(self._span), max(self._span)) if self._span else (None, None)
            self._words = []
            self._seq += 1
        # The face during the signs: question, no, very bad, or a plain statement.
        flag, nmm = self.face.finish(*span) if self.face else ("statement", None)
        with self._lock:
            if not gloss:
                self._note = "No signs were caught. Try again."
                return {"ok": False, "error": self._note}
            self._sent, self._flag = gloss, flag
            self._note = None
        self._send(gloss, min(confs) if confs else None, flag, nmm)
        return {"ok": True, "gloss": gloss, "grammarFlag": flag}

    def status(self) -> dict:
        with self._lock:
            state = "off"
            if self._open:
                state = "signing" if self._seg is not None else "watching"
            elif self._busy:
                state = "thinking"
            return {
                "available": self.model is not None,
                "error": None if self.model is not None else self.error,
                "signs": self.model.signs if self.model else [],
                "state": state,
                "words": [{"gloss": w.gloss, "confidence": w.confidence} for w in self._words],
                "note": self._note,
                "sent": self._sent,
                "grammarFlag": self._flag,
                "face": self.face is not None,
                "seq": self._seq,
            }

    def reload_model(self) -> None:
        """Load the model again (after a rebuild), without restarting the camera."""
        model = SignModel()
        with self._lock:
            self.model, self.error, self._seq = model, None, self._seq + 1
        print(f"Sign model reloaded: {', '.join(model.signs)}")

    @property
    def is_open(self) -> bool:
        return self._open

    @property
    def capturing(self) -> bool:
        return self._seg is not None

    # ---- camera loop ---------------------------------------------------------------------

    def note_point(self, gloss: str, confidence: float, t_ms: float) -> None:
        """A point at the body during the session joins the clause in order."""
        with self._lock:
            if not self._open:
                return
            self._points.append(t_ms)
            self._span += [t_ms, t_ms]
            self._words.append(Word(gloss, confidence, t_ms))
            self._seq += 1

    def ignore_point(self, t_ms: float, gesture: str = "point") -> None:
        """A point at the body happened: that movement is not a sign, and adds nothing.

        Only an index-finger point counts. A touch (any hand held on the body) is not: most
        signs touch the body (FEVER the forehead, NAUSEA the stomach), so skipping touches
        would throw those signs away."""
        if gesture != "point":
            return
        with self._lock:
            if self._open:
                self._points.append(t_ms)

    def push(self, hands: np.ndarray, t_ms: float) -> None:
        r = self.rules
        done: _Segment | None = None
        with self._lock:
            self._now_ms = t_ms
            if not self._open:
                return
            present = bool(np.isfinite(hands).all(axis=-1).all(axis=-1).any())
            if present:
                self._last_hands_ms = t_ms
            elif t_ms - self._last_hands_ms > r.idle_cancel_ms:
                self._open, self._words, self._seg = False, [], None
                self._note = "Signing stopped because no hands were seen."
                self._seq += 1
                return

            seg = self._seg
            if seg is None:
                self._recent = (self._recent + [hands])[-r.preroll :]
                self._streak = self._streak + [hands] if present else []
                if len(self._streak) >= r.start_frames:
                    pre = self._recent[: -len(self._streak)] if len(self._recent) > len(self._streak) else []
                    self._seg = _Segment(start_ms=t_ms, frames=pre + self._streak, with_hands=len(self._streak), last_seen_ms=t_ms)
                    self._streak = []
                    self._seq += 1
                return

            seg.frames.append(hands)
            if present:
                seg.with_hands += 1
                seg.last_seen_ms = t_ms
            if t_ms - seg.last_seen_ms >= r.end_gap_ms or t_ms - seg.start_ms >= r.max_ms:
                done, self._seg = seg, None
                self._recent, self._seq = [], self._seq + 1
        if done is not None:
            self._recognise(done)

    # ---- recognition ---------------------------------------------------------------------

    def _recognise(self, seg: _Segment) -> None:
        r = self.rules
        with self._lock:
            if seg.with_hands < r.min_frames:
                print(f"sign: skipped a movement too short to be a sign ({seg.with_hands} frames with hands)")
                return
            # The movement was a point at the body, not a sign.
            if any(seg.start_ms - r.point_overlap_ms <= p <= seg.last_seen_ms + r.point_overlap_ms for p in self._points):
                print("sign: skipped a movement that was a point at the body")
                return
            word = Word(None, 0.0, seg.start_ms)
            self._words.append(word)
            self._span += [seg.start_ms, seg.last_seen_ms]
            self._busy += 1
            self._seq += 1
        # Trailing frames without hands are just the hands going down.
        frames = seg.frames
        while frames and not np.isfinite(frames[-1]).all(axis=-1).all(axis=-1).any():
            frames = frames[:-1]

        def run() -> None:
            with self._worker_lock:  # one at a time, in order
                try:
                    label, distance = self.model.predict(frames) if self.model else (None, math.inf)
                except Exception as e:  # never stop the camera over one bad sign
                    print(f"Sign recognition failed: {e}", file=sys.stderr)
                    label, distance = None, math.inf
            gloss = to_gloss(label) if label is not None and distance <= MAX_DISTANCE else None
            with self._lock:
                self._busy -= 1
                self._seq += 1
                if gloss is None or gloss in PLACE_SIGNS:
                    if word in self._words:
                        self._words.remove(word)
                    if gloss is None:
                        self._note = "Didn't catch that sign. Try it again."
                        print(f"sign: no match (best {label} at {distance:.2f})")
                    else:
                        self._note = "Sign how you feel. You choose where it hurts next."
                        print(f"sign: {gloss} left out (body part; chosen in the next step)")
                    return
                word.gloss, word.confidence = gloss, confidence_of(distance)
                self._note = None
            print(f"sign: {gloss} (distance {distance:.2f}, confidence {word.confidence})")
            if self._on_sign:
                self._on_sign(gloss, seg.start_ms)

        job = threading.Thread(target=run, daemon=True)
        self._jobs = [j for j in self._jobs if j.is_alive()] + [job]
        job.start()


def _dedupe(gloss: list[str]) -> list[str]:
    """Drops a sign repeated straight after itself (a sign caught twice)."""
    out: list[str] = []
    for g in gloss:
        if not out or out[-1] != g:
            out.append(g)
    return out


def load_session(send: Send, on_sign=None, face: FaceLike | None = None) -> SignSession:
    """A session with the model loaded, or one that explains why signing is unavailable."""
    try:
        model = SignModel()
        print(f"Sign model loaded: {', '.join(model.signs)}")
        return SignSession(model, send, on_sign=on_sign, face=face)
    except Exception as e:
        print(f"Sign recognition unavailable: {e}", file=sys.stderr)
        return SignSession(None, send, error=f"The sign model could not be loaded ({e}).", face=face)
