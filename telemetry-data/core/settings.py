"""Centralized environment configuration for telemetry-data."""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


def _env_bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: str) -> int:
    return int(os.getenv(name, default))


AC_INSTANCE_ID = os.getenv("AC_INSTANCE_ID", "default").strip() or "default"

REDIS_HOST = os.getenv("REDIS_HOST", "").strip()
REDIS_PORT = _env_int("REDIS_PORT", "6379")
REDIS_USERNAME = os.getenv("REDIS_USERNAME", "").strip() or None
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "").strip() or None
REDIS_DB = _env_int("REDIS_DB", "0")
REDIS_SSL = _env_bool("REDIS_SSL", "false")

REDIS_STREAM_KEY = os.getenv("REDIS_STREAM_KEY", "ac:events").strip()
REDIS_CONFIG_STREAM_KEY = os.getenv("REDIS_CONFIG_STREAM_KEY", "ac:config").strip() or REDIS_STREAM_KEY
REDIS_STREAM_MAXLEN = _env_int("REDIS_STREAM_MAXLEN", "200000")
REDIS_SCHEMA_VERSION = os.getenv("REDIS_SCHEMA_VERSION", "1")

REDIS_CONFIG_CONSUMER_ENABLED = _env_bool("REDIS_CONFIG_CONSUMER_ENABLED", "true")
REDIS_CONFIG_CONSUMER_GROUP = os.getenv("REDIS_CONFIG_CONSUMER_GROUP", "ac-config-consumers").strip()
REDIS_CONFIG_CONSUMER_NAME = os.getenv(
    "REDIS_CONFIG_CONSUMER_NAME", f"py-{AC_INSTANCE_ID}"
).strip()
# When false (default), Python only updates in-memory runtime_config; ac-data writes INI + restarts.
REDIS_CONFIG_INI_WRITE_ENABLED = _env_bool("REDIS_CONFIG_INI_WRITE_ENABLED", "false")

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").strip().upper()

GHOST_DRIVER_TIMEOUT_MS = _env_int("GHOST_DRIVER_TIMEOUT_MS", "90000")
GHOST_CARINFO_DEBOUNCE_MS = _env_int("GHOST_CARINFO_DEBOUNCE_MS", "2000")
MIN_VALID_LAP_MS = _env_int("MIN_VALID_LAP_MS", "10000")
REGISTRATION_REFRESH_MIN_MS = _env_int("REGISTRATION_REFRESH_MIN_MS", "5000")
CAR_UPDATE_WATCHDOG_MS = _env_int("CAR_UPDATE_WATCHDOG_MS", "3000")

SERVER_STATUS_POLL_INTERVAL_SEC = _env_int("SERVER_STATUS_POLL_INTERVAL_SEC", "15")
SERVER_STATUS_PUBLISH_INTERVAL_SEC = _env_int("SERVER_STATUS_PUBLISH_INTERVAL_SEC", "30")
SERVER_STATUS_HEARTBEAT_INTERVAL_SEC = _env_int("SERVER_STATUS_HEARTBEAT_INTERVAL_SEC", "300")
SERVER_STATUS_ON_CHANGE_ONLY = _env_bool("SERVER_STATUS_ON_CHANGE_ONLY", "true")

REDIS_PUBLISH_QUEUE_SIZE = _env_int("REDIS_PUBLISH_QUEUE_SIZE", "4096")
REDIS_PUBLISH_WORKERS = _env_int("REDIS_PUBLISH_WORKERS", "1")
