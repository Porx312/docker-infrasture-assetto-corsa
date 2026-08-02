from core import runtime_config, settings
from core.redis_config_sync import _is_transient_redis_loop_error, apply_snapshot

try:
    import redis.exceptions as redis_exceptions
except Exception:
    redis_exceptions = None


class _FakeState:
    def __init__(self, cfg_path, folder_id, config_name):
        self.cfg_path = cfg_path
        self.server_folder_id = folder_id
        self.config_server_name = config_name
        self.server_name = config_name


def test_apply_snapshot_runtime_only(monkeypatch, tmp_path):
    versions_file = str(tmp_path / "versions.json")
    monkeypatch.setattr(settings, "AC_INSTANCE_ID", "test-instance")
    monkeypatch.setattr(settings, "REDIS_APPLIED_CONFIG_VERSIONS_FILE", versions_file)

    runtime_config.set_server_modes([])
    payload = {
        "instanceId": "test-instance",
        "data": {
            "instanceId": "test-instance",
            "version": "v1",
            "servers": [
                {
                    "serverName": "server-1",
                    "displayName": "BattleOne",
                    "type": "battle",
                }
            ],
        },
    }
    applied, errors = apply_snapshot({}, payload)
    assert applied == 1
    assert errors == 0
    assert runtime_config.get_mode_for_state(
        _FakeState("", "server-1", "BattleOne")
    ) == "battle"


def test_transient_redis_loop_error_detects_timeout():
    if redis_exceptions is None:
        return
    assert _is_transient_redis_loop_error(redis_exceptions.TimeoutError("timed out"))
    assert _is_transient_redis_loop_error(redis_exceptions.ConnectionError("reset"))
    assert not _is_transient_redis_loop_error(ValueError("bad payload"))
