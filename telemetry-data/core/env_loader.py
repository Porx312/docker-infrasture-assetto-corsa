"""Load repo-root env file before settings reads os.environ."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
_loaded = False


def resolve_env_file_path() -> Path:
    explicit = os.getenv("ASSETTO_ENV_FILE", "").strip()
    if explicit:
        p = Path(explicit)
        return p if p.is_absolute() else _REPO_ROOT / p

    mode = os.getenv("ASSETTO_ENV", "dev").strip().lower()
    name = ".env.production" if mode in ("prod", "production") else ".env.local"
    return _REPO_ROOT / name


def _should_skip_missing_env_file() -> bool:
    """CI / pytest / unit isolation — allow import without a real .env.local."""
    if os.getenv("SKIP_ASSETTO_ENV_LOAD", "").strip() in ("1", "true", "yes", "on"):
        return True
    if os.getenv("CI", "").strip().lower() in ("1", "true", "yes"):
        return True
    if os.getenv("PYTEST_CURRENT_TEST"):
        return True
    # pytest often imports settings before PYTEST_CURRENT_TEST is set
    if os.getenv("PYTEST_VERSION") or "pytest" in os.getenv("_", ""):
        return True
    return False


def load_env() -> None:
    global _loaded
    if _loaded:
        return

    env_path = resolve_env_file_path()
    if not env_path.is_file():
        if _should_skip_missing_env_file():
            _loaded = True
            return
        raise FileNotFoundError(
            f"Env file not found: {env_path}. "
            "Copy .env.example to .env.local or .env.production, or set ASSETTO_ENV_FILE."
        )

    load_dotenv(env_path)
    _loaded = True


load_env()
