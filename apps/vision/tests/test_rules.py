from apps.vision.tests.helpers import BASE, shake, window

from apps.vision.synapse_vision.grammar import GrammarFlag, grammar_flag, sign_changes


def test_neutral_is_statement():
    assert grammar_flag(window(), BASE).flag is GrammarFlag.STATEMENT


def test_empty_window_is_statement():
    assert grammar_flag([], BASE).flag is GrammarFlag.STATEMENT


def test_raised_brows_held_is_question():
    r = grammar_flag(window(brow=lambda t: 0.5), BASE)
    assert r.flag is GrammarFlag.QUESTION
    assert r.brow_hold_ms >= 300


def test_brief_brow_flash_is_not_question():
    # Very high for 200 ms so the mean clears the threshold, but not held 300 ms.
    r = grammar_flag(window(ms=400, brow=lambda t: 1.0 if t < 200 else 0.0), BASE)
    assert r.up > 0.25
    assert r.flag is GrammarFlag.STATEMENT


def test_headshake_is_negation():
    assert grammar_flag(window(yaw=shake()), BASE).flag is GrammarFlag.NEGATION


def test_single_head_turn_is_not_negation():
    r = grammar_flag(window(yaw=lambda t: 15 if t > 600 else 0), BASE)
    assert r.flips == 0
    assert r.flag is GrammarFlag.STATEMENT


def test_jitter_inside_deadband_is_ignored():
    r = grammar_flag(window(yaw=shake(amplitude_deg=4, period_ms=100)), BASE)
    assert r.flips == 0


def test_furrowed_brows_is_intensified():
    assert grammar_flag(window(brow_down=lambda t: 0.4), BASE).flag is GrammarFlag.INTENSIFIED


def test_squint_is_intensified():
    assert grammar_flag(window(squint=lambda t: 0.4), BASE).flag is GrammarFlag.INTENSIFIED


def test_negation_beats_question():
    r = grammar_flag(window(brow=lambda t: 0.5, yaw=shake()), BASE)
    assert r.flag is GrammarFlag.NEGATION


def test_question_beats_intensified():
    r = grammar_flag(window(brow=lambda t: 0.5, squint=lambda t: 0.4), BASE)
    assert r.flag is GrammarFlag.QUESTION


def test_baseline_is_subtracted():
    # A face whose neutral brow is already high should not read as a question.
    high = BASE.__class__(**{**BASE.__dict__, "brow": 0.6})
    frames = window(brow=lambda t: 0.5)  # absolute brow 0.6 == this person's neutral
    assert grammar_flag(frames, high).flag is GrammarFlag.STATEMENT


def test_sign_changes():
    assert sign_changes([10, -10, 10], deadband=6) == 2
    assert sign_changes([10, 3, -3, 10], deadband=6) == 0
    assert sign_changes([0, 0, 0], deadband=6) == 0
    assert sign_changes([-8, 8], deadband=6) == 1
