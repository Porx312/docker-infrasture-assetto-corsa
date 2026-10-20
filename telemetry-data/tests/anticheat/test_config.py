"""Config loading: defaults, env, invalid input → safe defaults."""

from __future__ import annotations

import json
from pathlib import Path

from anticheat.config import AnticheatConfig, default_config, load_config


def test_default_disabled_and_sanctions_off():
    cfg = default_config()
    assert cfg.enabled is False
    assert cfg.sanctions_enabled is False
    assert cfg.mode == "observe"
    assert cfg.sanctions_allowed() is False


def test_missing_config_file_uses_safe_defaults(tmp_path: Path):
    missing = tmp_path / "nope.json"
    result = load_config(missing, apply_env=False)
    assert result.config.enabled is False
    assert any("missing" in w for w in result.warnings)


def test_invalid_json_uses_safe_defaults(tmp_path: Path):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    result = load_config(bad, apply_env=False)
    assert result.config.enabled is False
    assert any("unreadable" in w for w in result.warnings)


def test_invalid_field_types_reset(tmp_path: Path):
    path = tmp_path / "c.json"
    path.write_text(
        json.dumps({"enabled": "maybe", "max_speed_kmh": "fast", "ring_buffer_size": -3}),
        encoding="utf-8",
    )
    result = load_config(path, apply_env=False)
    assert result.config.enabled is False  # invalid bool → default
    assert result.config.max_speed_kmh == 450.0
    assert result.config.ring_buffer_size >= 1
    assert result.warnings


def test_enforce_without_sanctions_hard_gate(monkeypatch):
    monkeypatch.setenv("ANTICHEAT_ENABLED", "true")
    monkeypatch.setenv("ANTICHEAT_MODE", "enforce")
    monkeypatch.setenv("ANTICHEAT_SANCTIONS_ENABLED", "false")
    result = load_config(apply_env=True)
    assert result.config.enabled is True
    assert result.config.mode == "enforce"
    assert result.config.sanctions_allowed() is False
    assert any("hard gate" in w for w in result.warnings)


def test_invalid_env_bool(monkeypatch):
    monkeypatch.setenv("ANTICHEAT_ENABLED", "banana")
    result = load_config(apply_env=True)
    assert result.config.enabled is False
    assert any("ANTICHEAT_ENABLED" in w for w in result.warnings)


def test_sanctions_allowed_only_when_all_flags():
    cfg = AnticheatConfig(enabled=True, mode="enforce", sanctions_enabled=True)
    assert cfg.sanctions_allowed() is True
    cfg2 = AnticheatConfig(enabled=True, mode="observe", sanctions_enabled=True)
    assert cfg2.sanctions_allowed() is False
