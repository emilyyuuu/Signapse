"""Frame types shared by the camera sources and the recognition pipeline."""

from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass

import numpy as np


@dataclass
class VideoFrame:
    image: np.ndarray
    timestamp_ms: int
    source_id: str


class FrameSource(ABC):
    @abstractmethod
    def frames(self) -> Iterator[VideoFrame]:
        """Yield Frames in a consistent format."""
        raise NotImplementedError

    @abstractmethod
    def close(self) -> None:
        """Release camera or streaming resources."""
        raise NotImplementedError
