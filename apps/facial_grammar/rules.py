from __future__ import annotations

from collections.abc import Sequence
from statistics import fmean

from .datatypes import DEFAULT_THRESHOLDS, Baseline, Frame, GrammarFlag, GrammarResult, Thresholds


def sign_changes(values: Sequence[float], deadband: float) -> int:
    """Count direction flips of a signal around zero, ignoring values inside ±deadband.

    A headshake swings yaw left, right, left: that is two flips.
    """
    flips = 0
    last = 0
    for v in values:
        if abs(v) <= deadband:
            continue
        sign = 1 if v > 0 else -1
        if last and sign != last:
            flips += 1
        last = sign
    return flips


def _longest_hold_ms(window: Sequence[Frame], above: Sequence[bool]) -> float:
    """Longest continuous span, in ms, where ``above`` is true."""
    best = 0.0
    run_start: float | None = None
    for f, on in zip(window, above):
        if on:
            if run_start is None:
                run_start = f.t_ms
            best = max(best, f.t_ms - run_start)
        else:
            run_start = None
    return best


def grammar_flag(
    window: Sequence[Frame],
    baseline: Baseline,
    th: Thresholds = DEFAULT_THRESHOLDS,
) -> GrammarResult:
    """Classify one clause window. Precedence: negation, question, intensified, statement."""
    if not window:
        return GrammarResult(GrammarFlag.STATEMENT, 0.0, 0.0, 0.0, 0, 0.0)

    up_deltas = [f.brow - baseline.brow for f in window]
    up = fmean(up_deltas)
    down = fmean(f.brow_down - baseline.brow_down for f in window)
    sq = fmean(f.squint - baseline.squint for f in window)
    flips = sign_changes([f.yaw - baseline.yaw for f in window], th.yaw_deadband_deg)
    hold = _longest_hold_ms(window, [d > th.brow_up for d in up_deltas])

    if flips >= th.min_yaw_flips:
        flag = GrammarFlag.NEGATION
    elif up > th.brow_up and hold >= th.brow_hold_ms:
        flag = GrammarFlag.QUESTION
    elif down > th.brow_down or sq > th.squint:
        flag = GrammarFlag.INTENSIFIED
    else:
        flag = GrammarFlag.STATEMENT

    return GrammarResult(flag=flag, up=up, down=down, sq=sq, flips=flips, brow_hold_ms=hold)
