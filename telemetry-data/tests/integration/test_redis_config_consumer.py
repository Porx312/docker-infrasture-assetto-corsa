import json

import pytest

from core import runtime_config, settings
from core.redis_config_sync import apply_snapshot


class _FakeRedisConsumer:
    def __init__(self, messages):
        self._messages = list(messages)
        self.acked = []

    def xack(self, stream, group, msg_id):
        self.acked.append((stream, group, msg_id))


def _process_consumer_batch(client, servers, messages):
    """One iteration of start_redis_config_consumer inner loop (for tests)."""
    for _stream, batch in messages:
        for msg_id, fields in batch:
            raw_payload = fields.get("payload")
            if not raw_payload:
                client.xack(
                    settings.REDIS_CONFIG_STREAM_KEY,
                    settings.REDIS_CONFIG_CONSUMER_GROUP,
                    msg_id,
                )
                continue
            payload = json.loads(raw_payload)
            if payload.get("event") != "server_config_snapshot":
                client.xack(
                    settings.REDIS_CONFIG_STREAM_KEY,
                    settings.REDIS_CONFIG_CONSUMER_GROUP,
                    msg_id,
                )
                continue
            apply_snapshot(servers, payload)
            client.xack(
                settings.REDIS_CONFIG_STREAM_KEY,
                settings.REDIS_CONFIG_CONSUMER_GROUP,
                msg_id,
            )


def test_consumer_batch_applies_snapshot_and_acks(monkeypatch, tmp_path):
    versions_file = str(tmp_path / "versions.json")
    monkeypatch.setattr(settings, "AC_INSTANCE_ID", "vps-test")
    monkeypatch.setattr(settings, "REDIS_CONFIG_STREAM_KEY", "ac:config")
    monkeypatch.setattr(settings, "REDIS_CONFIG_CONSUMER_GROUP", "test-group")
    monkeypatch.setattr(settings, "REDIS_APPLIED_CONFIG_VERSIONS_FILE", versions_file)

    runtime_config.set_server_modes([])

    payload = {
        "event": "server_config_snapshot",
        "instanceId": "vps-test",
        "data": {
            "instanceId": "vps-test",
            "version": "v-consumer",
            "servers": [{"serverName": "server-3", "displayName": "TA", "type": "time-attack"}],
        },
    }
    batch = [("42-0", {"payload": json.dumps(payload)})]
    fake = _FakeRedisConsumer(batch)

    _process_consumer_batch(fake, {}, [(settings.REDIS_CONFIG_STREAM_KEY, batch)])

    assert fake.acked == [("ac:config", "test-group", "42-0")]
    assert runtime_config.get_mode_for_state(
        type("St", (), {
            "server_folder_id": "server-3",
            "config_server_name": "TA",
            "server_name": "TA",
        })()
    ) == "time-attack"


def test_consumer_batch_skips_non_snapshot(monkeypatch):
    monkeypatch.setattr(settings, "REDIS_CONFIG_STREAM_KEY", "ac:config")
    monkeypatch.setattr(settings, "REDIS_CONFIG_CONSUMER_GROUP", "test-group")

    batch = [("1-0", {"payload": json.dumps({"event": "player_join"})})]
    fake = _FakeRedisConsumer(batch)
    _process_consumer_batch(fake, {}, [(settings.REDIS_CONFIG_STREAM_KEY, batch)])
    assert fake.acked == [("ac:config", "test-group", "1-0")]
