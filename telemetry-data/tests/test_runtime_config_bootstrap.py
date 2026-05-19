import json

from core import runtime_config
from core.redis_config_sync import bootstrap_runtime_config_from_stream


class _FakeRedis:
    def __init__(self, entries):
        self._entries = entries

    def xrevrange(self, _key, count=100):
        return self._entries


def test_bootstrap_loads_latest_snapshot_for_instance(monkeypatch):
    monkeypatch.setattr("core.redis_config_sync.settings", type("S", (), {
        "REDIS_CONFIG_STREAM_KEY": "ac:config",
        "AC_INSTANCE_ID": "vps-eu-2",
    })())
    runtime_config.set_server_modes([])

    payload = {
        "event": "server_config_snapshot",
        "instanceId": "vps-eu-2",
        "data": {
            "instanceId": "vps-eu-2",
            "version": "v1",
            "servers": [
                {"serverName": "server-2", "displayName": "battle test", "type": "battle"},
            ],
        },
    }
    client = _FakeRedis([("1-0", {"payload": json.dumps(payload)})])
    assert bootstrap_runtime_config_from_stream(client) is True
    assert runtime_config.get_mode_for_state(
        type("St", (), {
            "server_folder_id": "server-2",
            "config_server_name": "battle test",
            "server_name": "battle test",
        })()
    ) == "battle"
