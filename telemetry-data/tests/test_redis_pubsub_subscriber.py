"""Tests for Redis pub/sub helpers."""

import threading
import time
from unittest.mock import MagicMock, patch

from core.redis_pubsub_subscriber import parse_steam_id_message, run_pubsub_subscriber_loop


def test_parse_steam_id_message_json():
    assert parse_steam_id_message('{"steamId":"76561199000000001","ts":1}') == "76561199000000001"
    assert parse_steam_id_message('{"steam_id":"76561199000000002"}') == "76561199000000002"


def test_parse_steam_id_message_plain_string():
    assert parse_steam_id_message("76561199000000003") == "76561199000000003"


def test_parse_steam_id_message_empty():
    assert parse_steam_id_message("") is None
    assert parse_steam_id_message("   ") is None


@patch("core.redis_pubsub_subscriber.time.sleep")
@patch("core.redis_pubsub_subscriber.settings.REDIS_HOST", "127.0.0.1")
@patch("core.redis_client.get_redis_blocking_client")
def test_run_pubsub_subscriber_loop_reconnects_after_error(mock_get_client, mock_sleep):
    pubsub = MagicMock()
    pubsub.listen.side_effect = RuntimeError("connection lost")
    redis = MagicMock()
    redis.pubsub.return_value = pubsub
    mock_get_client.return_value = redis

    thread = threading.Thread(
        target=run_pubsub_subscriber_loop,
        kwargs={
            "channel": "ac:test:channel",
            "handler": lambda _raw: None,
            "log_label": "test subscriber",
        },
        daemon=True,
    )
    thread.start()
    time.sleep(0.05)

    assert mock_sleep.called
    assert pubsub.subscribe.call_count >= 1
