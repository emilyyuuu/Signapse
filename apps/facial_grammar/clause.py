from __future__ import annotations

from .datatypes import Frame


class ClauseRecorder:
    """Collects the frames of one clause. Facial markers apply to the whole clause.

    For now the lab marks clauses by hand; the sign segmenter will drive this later.
    """

    def __init__(self) -> None:
        self._frames: list[Frame] | None = None

    @property
    def active(self) -> bool:
        return self._frames is not None

    def start(self) -> None:
        self._frames = []

    def push(self, frame: Frame | None) -> None:
        if self._frames is not None and frame is not None:
            self._frames.append(frame)

    def end(self) -> list[Frame]:
        frames, self._frames = self._frames or [], None
        return frames
