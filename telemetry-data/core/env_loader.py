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


def load_env() -> None:
    global _loaded
    if _loaded:
        return

    env_path = resolve_env_file_path()
    if not env_path.is_file():
        raise FileNotFoundError(
            f"Env file not found: {env_path}. "
            "Copy .env.example to .env.local or .env.production, or set ASSETTO_ENV_FILE."
        )

    load_dotenv(env_path)
    _loaded = True


load_env()
