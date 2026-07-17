from core import settings
from core.redis_client import (
    _socket_timeout_from_sec,
    get_redis_blocking_client,
    get_redis_client,
    reset_client_for_tests,
)


def test_socket_timeout_from_sec():
    assert _socket_timeout_from_sec(0) is None
    assert _socket_timeout_from_sec(-1) is None
    assert _socket_timeout_from_sec(10) == 10.0


def test_blocking_and_default_clients_are_separate(monkeypatch):
    reset_client_for_tests()
    monkeypatch.setattr(settings, "REDIS_HOST", "")
    try:
        get_redis_client()
        assert False, "expected RuntimeError"
    except RuntimeError:
        pass
    reset_client_for_tests()
