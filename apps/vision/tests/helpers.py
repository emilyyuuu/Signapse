from __future__ import annotations

import math
from collections.abc import Callable

from apps.vision.synapse_vision.grammar import Baseline, Frame

BASE = Baseline(brow=0.10, brow_down=0.05, squint=0.10, yaw=2.0, pitch=-3.0)


def window(
    ms: float = 1200,
    fps: float = 30,
    brow: Callable[[float], float] = lambda t: 0.0,
    brow_down: Callable[[float], float] = lambda t: 0.0,
    squint: Callable[[float], float] = lambda t: 0.0,
    yaw: Callable[[float], float] = lambda t: 0.0,
) -> list[Frame]:
    """Synthetic clause; the callables give the delta from BASE at time t (ms)."""
    n = int(ms / 1000 * fps)
    out = []
    for i in range(n):
        t = i * 1000 / fps
        out.append(
            Frame(
                t_ms=t,
                brow=BASE.brow + brow(t),
                brow_down=BASE.brow_down + brow_down(t),
                squint=BASE.squint + squint(t),
                yaw=BASE.yaw + yaw(t),
                pitch=BASE.pitch,
            )
        )
    return out


def shake(amplitude_deg: float = 15, period_ms: float = 500) -> Callable[[float], float]:
    return lambda t: amplitude_deg * math.sin(2 * math.pi * t / period_ms)
