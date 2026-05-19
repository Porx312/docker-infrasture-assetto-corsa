"""Structured logging setup for telemetry-data."""

from __future__ import annotations

import logging
import sys

from core import settings

_CONFIGURED = False


def setup_logging() -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    level = getattr(logging, settings.LOG_LEVEL, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
        force=True,
    )
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    if not _CONFIGURED:
        setup_logging()
    return logging.getLogger(name)
