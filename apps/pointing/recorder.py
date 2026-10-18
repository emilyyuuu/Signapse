"""Record new examples of a sign for the recorded-sign model, from the same camera loop.

Staff use it from the /record page: pick a sign, press Record, sign once, put the hands down.
Each example is saved where apps/recognition-python's build_model.py reads them
(recorder/recordings/*.npz + labels.csv, gitignored except labels.csv), in the same format:
``raw_landmarks`` (frames, 2, 21, 3), mirrored layout, NaN for a missing hand. Hand points only,
never video. "Rebuild" backs up the current model, runs build_model.py unchanged, checks the new
model (leave-one-out) and loads it into the running camera program.
"""

from __future__ import annotations

import csv
import json
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter
from collections.abc import Callable
from pathlib import Path

import numpy as np

from .paths import SIGN_MODEL_DIR

APP_DIR = SIGN_MODEL_DIR.parents[1]  # apps/recognition-python/app
RECORDINGS_DIR = APP_DIR.parent / "recorder" / "recordings"  # backups go in recorder/model_backups
BUILD_SCRIPT = APP_DIR / "scripts" / "build_model.py"
SIGN_NAME = re.compile(r"^[a-z][a-z-]{1,23}$")
SEEDED_PREFIX = "model_template_"

START_FRAMES = 3  # hands seen this many frames in a row: the sign has started
END_GAP_MS = 600.0  # hands gone this long: the sign is over
MAX_MS = 8000.0
WAIT_MS = 15_000.0  # no hands at all after Record: give up
MIN_FRAMES = 8
PREROLL = 5
TAIL = 3  # frames without hands kept at the end


def _present(hands: np.ndarray) -> bool:
    return bool(np.isfinite(hands).all(axis=-1).all(axis=-1).any())


def read_labels(recordings: Path = RECORDINGS_DIR) -> list[tuple[str, str]]:
    path = recordings / "labels.csv"
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return [((r.get("path") or "").strip(), (r.get("sign") or "").strip()) for r in csv.DictReader(f)]


def counts(recordings: Path = RECORDINGS_DIR) -> dict[str, int]:
    """Usable examples per sign: listed in labels.csv and present on this computer."""
    c: Counter = Counter()
    for name, sign in read_labels(recordings):
        if name and sign and (recordings / name).exists():
            c[sign] += 1
    return dict(sorted(c.items()))


def _append_label(recordings: Path, name: str, sign: str) -> None:
    path = recordings / "labels.csv"
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["path", "sign"])
        w.writerow([name, sign])


def seed_from_model(model_dir: Path = SIGN_MODEL_DIR, recordings: Path = RECORDINGS_DIR) -> int:
    """Copy the current model's examples in as recordings, once, so a rebuild keeps them.

    Templates are stored normalized; build_model.py normalizes again, which leaves them as
    they are, so the rebuilt model contains the same examples.
    """
    recordings.mkdir(parents=True, exist_ok=True)
    if any(recordings.glob(f"{SEEDED_PREFIX}*.npz")):
        return 0
    labels = json.loads((model_dir / "labels.json").read_text(encoding="utf-8"))
    with np.load(model_dir / "templates.npz", allow_pickle=False) as archive:
        keys = sorted(archive.files)
        for i, (key, sign) in enumerate(zip(keys, labels)):
            name = f"{SEEDED_PREFIX}{i:03d}_{sign}.npz"
            np.savez_compressed(recordings / name, raw_landmarks=archive[key], sign=np.array(sign))
            _append_label(recordings, name, sign)
    return len(labels)


class Recorder:
    """Captures one example per Record press. Thread-safe like SignSession."""

    def __init__(
        self,
        recordings: Path = RECORDINGS_DIR,
        on_rebuilt: Callable[[], None] | None = None,
        model_dir: Path = SIGN_MODEL_DIR,
    ) -> None:
        self.recordings = recordings
        self.model_dir = model_dir
        self._on_rebuilt = on_rebuilt
        self._lock = threading.Lock()
        self._state = "off"  # off | waiting | recording
        self._sign: str | None = None
        self._frames: list[np.ndarray] = []
        self._recent: list[np.ndarray] = []
        self._streak = 0
        self._started_ms: float | None = None
        self._first_ms = 0.0
        self._last_seen_ms = 0.0
        self._note: str | None = None
        self._last_saved: str | None = None
        self._seq = 0
        self._rebuild: dict = {"state": "idle"}

    @property
    def active(self) -> bool:
        return self._state != "off"

    @property
    def recording(self) -> bool:
        return self._state == "recording"

    def start(self, sign: str) -> dict:
        sign = (sign or "").strip().lower()
        if not SIGN_NAME.match(sign):
            return {"ok": False, "error": "Sign names are 2 to 24 lowercase letters, e.g. pain or dizzy."}
        with self._lock:
            if self._rebuild.get("state") == "running":
                return {"ok": False, "error": "Wait for the rebuild to finish."}
            self._state, self._sign = "waiting", sign
            self._frames, self._recent, self._streak = [], [], 0
            self._started_ms, self._note, self._seq = None, None, self._seq + 1
        return {"ok": True}

    def cancel(self) -> dict:
        with self._lock:
            self._state, self._frames, self._note, self._seq = "off", [], None, self._seq + 1
        return {"ok": True}

    def push(self, hands: np.ndarray, t_ms: float) -> None:
        save: tuple[str, list[np.ndarray]] | None = None
        with self._lock:
            if self._state == "off":
                return
            if self._started_ms is None:
                self._started_ms = t_ms
            present = _present(hands)
            if self._state == "waiting":
                self._recent = (self._recent + [hands])[-PREROLL:]
                self._streak = self._streak + 1 if present else 0
                if self._streak >= START_FRAMES:
                    self._state, self._frames = "recording", list(self._recent)
                    self._first_ms = self._last_seen_ms = t_ms
                    self._seq += 1
                elif t_ms - self._started_ms > WAIT_MS:
                    self._state, self._note, self._seq = "off", "No hands were seen. Press Record and try again.", self._seq + 1
                return
            self._frames.append(hands)
            if present:
                self._last_seen_ms = t_ms
            if t_ms - self._last_seen_ms >= END_GAP_MS or t_ms - self._first_ms >= MAX_MS:
                frames = self._frames
                while len(frames) > 1 and not any(_present(f) for f in frames[-TAIL:]):
                    frames = frames[:-1]
                save, self._state, self._frames, self._seq = (self._sign, frames), "off", [], self._seq + 1
        if save is not None:
            self._save(*save)

    def _save(self, sign: str, frames: list[np.ndarray]) -> None:
        if sum(_present(f) for f in frames) < MIN_FRAMES:
            with self._lock:
                self._note, self._seq = "That was too short to be a sign. Try again.", self._seq + 1
            return
        self.recordings.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
        name = f"recording_{stamp}Z_{uuid.uuid4().hex[:8]}.npz"
        np.savez_compressed(self.recordings / name, raw_landmarks=np.stack(frames).astype(np.float32), sign=np.array(sign))
        _append_label(self.recordings, name, sign)
        with self._lock:
            self._last_saved, self._note, self._seq = sign, f"Saved an example of {sign}.", self._seq + 1
        print(f"recorded: {sign} ({len(frames)} frames) -> {name}")

    def status(self) -> dict:
        with self._lock:
            return {
                "state": self._state,
                "sign": self._sign,
                "frames": len(self._frames),
                "note": self._note,
                "lastSaved": self._last_saved,
                "counts": counts(self.recordings),
                "rebuild": dict(self._rebuild),
                "seq": self._seq,
            }

    # ---- rebuild ------------------------------------------------------------------------

    def rebuild(self) -> dict:
        with self._lock:
            if self._rebuild.get("state") == "running":
                return {"ok": False, "error": "Already rebuilding."}
            if self._state != "off":
                return {"ok": False, "error": "Finish recording first."}
            self._rebuild = {"state": "running"}
        threading.Thread(target=self._rebuild_now, daemon=True).start()
        return {"ok": True}

    def _rebuild_now(self) -> None:
        backup = self.recordings.parent / "model_backups" / time.strftime("%Y%m%d-%H%M%S")
        try:
            shutil.copytree(self.model_dir, backup)
            done = subprocess.run(
                [sys.executable, str(BUILD_SCRIPT), "--dataset-dir", str(self.recordings), "--model-dir", str(self.model_dir)],
                capture_output=True,
                text=True,
                timeout=300,
            )
            output = (done.stdout + done.stderr).strip()
            # Recordings listed in labels.csv but kept on another computer are skipped: not an error.
            lines = [line for line in output.splitlines() if "No such file" not in line and "cannot find" not in line.lower()]
            if done.returncode != 0:
                raise RuntimeError(lines[-1] if lines else "build_model.py failed")
            check = leave_one_out(self.model_dir)
            if self._on_rebuilt:
                self._on_rebuilt()
            result = {"state": "done", "backup": backup.name, "output": lines[-6:], **check}
        except Exception as e:
            result = {"state": "failed", "error": str(e), "backup": backup.name if backup.exists() else None}
        with self._lock:
            self._rebuild, self._seq = result, self._seq + 1
        print(f"rebuild: {result}")


def leave_one_out(model_dir: Path = SIGN_MODEL_DIR) -> dict:
    """Each example matched against all the others: how often the model gets its own signs right."""
    if str(APP_DIR) not in sys.path:
        sys.path.insert(0, str(APP_DIR))
    from model_loader import load_model  # type: ignore[import-not-found]
    from recognition.pipeline import RecognitionPipeline  # type: ignore[import-not-found]

    templates, labels, _ = load_model(model_dir)
    per: dict[str, list[int]] = {}
    mixed: Counter = Counter()
    for i, sign in enumerate(labels):
        rest_t, rest_l = templates[:i] + templates[i + 1 :], labels[:i] + labels[i + 1 :]
        if not rest_t:
            continue
        guess, _ = RecognitionPipeline(rest_t, rest_l, k=min(3, len(rest_t))).predict(list(templates[i]))
        right = per.setdefault(sign, [0, 0])
        right[1] += 1
        if guess == sign:
            right[0] += 1
        elif guess:
            mixed[f"{sign} -> {guess}"] += 1
    total = sum(n for _, n in per.values())
    correct = sum(c for c, _ in per.values())
    return {
        "examples": total,
        "correct": correct,
        "perSign": {s: {"correct": c, "total": n} for s, (c, n) in sorted(per.items())},
        "mixedUp": dict(mixed.most_common(6)),
    }
