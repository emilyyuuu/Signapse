from sign_recognition import paths


def test_models_live_in_the_package():
    assert paths.HAND_MODEL.parent == paths.PACKAGE_ROOT / "models"


def test_sign_templates_live_at_the_repo_root():
    assert paths.SIGNS_DIR == paths.REPO_ROOT / "data" / "signs"
    assert (paths.REPO_ROOT / "apps" / "sign_recognition").is_dir()
