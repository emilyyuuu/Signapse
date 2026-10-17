import pytest
from apps.vision.tests.helpers import BASE, window

from apps.vision.synapse_vision.grammar import CalibrationError, Calibrator


def run(frames, missing_every=0):
    cal = Calibrator(duration_ms=1000)
    for i, f in enumerate(frames):
        cal.push(None if missing_every and i % missing_every == 0 else f, f.t_ms)
        if cal.done(f.t_ms):
            break
    return cal


def test_baseline_is_mean_of_neutral_face():
    cal = run(window(ms=1500))
    assert cal.done(1000)
    b = cal.baseline()
    assert b.brow == pytest.approx(BASE.brow)
    assert b.yaw == pytest.approx(BASE.yaw)


def test_rejects_when_face_lost_too_often():
    with pytest.raises(CalibrationError, match="lost"):
        run(window(ms=1500), missing_every=3).baseline()


def test_rejects_head_movement():
    with pytest.raises(CalibrationError, match="Head moved"):
        run(window(ms=1500, yaw=lambda t: t / 50)).baseline()


def test_rejects_no_face():
    with pytest.raises(CalibrationError):
        Calibrator().baseline()
