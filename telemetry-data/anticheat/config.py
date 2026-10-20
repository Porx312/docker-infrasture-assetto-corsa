"""Anticheat configuration: conservative defaults + env / JSON overrides."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, fields, replace
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


_DEFAULT_JSON = Path(__file__).resolve().parent / "config.default.json"

# Hard-coded fallback if JSON is missing/corrupt (never raise into hot path).
_SAFE_DEFAULTS: Dict[str, Any] = {
    "enabled": False,
    "mode": "observe",
    "sanctions_enabled": False,
    "max_speed_kmh": 450.0,
    "min_dt_sec": 0.001,
    "max_dt_sec": 0.5,
    "position_jump_margin_m": 15.0,
    "position_jump_speed_factor": 2.5,
    "max_accel_ms2": 80.0,
    "spline_out_of_range_eps": 0.05,
    "min_valid_lap_ms": 10000,
    "max_valid_lap_ms": 36000000,
    "cuts_anomaly_threshold": 1,
    "score_decay_per_sec": 0.5,
    "score_weight_low": 1.0,
    "score_weight_medium": 3.0,
    "score_weight_high": 8.0,
    "evidence_score_threshold": 12.0,
    "ring_buffer_size": 8,
    "sink_queue_size": 256,
    "sink_drop_log_every": 50,
}


@dataclass(frozen=True)
class AnticheatConfig:
    enabled: bool = False
    mode: str = "observe"  # observe | enforce (enforce still cannot sanction without flag)
    sanctions_enabled: bool = False
    max_speed_kmh: float = 450.0
    min_dt_sec: float = 0.001
    max_dt_sec: float = 0.5
    position_jump_margin_m: float = 15.0
    position_jump_speed_factor: float = 2.5
    max_accel_ms2: float = 80.0
    spline_out_of_range_eps: float = 0.05
    min_valid_lap_ms: int = 10000
    max_valid_lap_ms: int = 36000000
    cuts_anomaly_threshold: int = 1
    score_decay_per_sec: float = 0.5
    score_weight_low: float = 1.0
    score_weight_medium: float = 3.0
    score_weight_high: float = 8.0
    evidence_score_threshold: float = 12.0
    ring_buffer_size: int = 8
    sink_queue_size: int = 256
    sink_drop_log_every: int = 50

    def sanctions_allowed(self) -> bool:
        """Hard gate: never sanction unless both enforce mode AND explicit flag."""
        return (
            self.enabled
            and self.sanctions_enabled
            and self.mode.strip().lower() == "enforce"
        )


@dataclass
class ConfigLoadResult:
    config: AnticheatConfig
    warnings: List[str]
    source: str


def _env_bool(name: str, default: bool) -> Tuple[Optional[bool], Optional[str]]:
    raw = os.getenv(name)
    if raw is None:
        return default, None
    text = raw.strip().lower()
    if text in ("1", "true", "yes", "on"):
        return True, None
    if text in ("0", "false", "no", "off", ""):
        return False, None
    return default, f"{name}={raw!r} invalid bool; using {default}"


def _env_float(name: str, default: float) -> Tuple[float, Optional[str]]:
    raw = os.getenv(name)
    if raw is None:
        return default, None
    try:
        return float(raw.strip()), None
    except ValueError:
        return default, f"{name}={raw!r} invalid float; using {default}"


def _env_int(name: str, default: int) -> Tuple[int, Optional[str]]:
    raw = os.getenv(name)
    if raw is None:
        return default, None
    try:
        return int(raw.strip()), None
    except ValueError:
        return default, f"{name}={raw!r} invalid int; using {default}"


def _load_json_file(path: Path) -> Tuple[Dict[str, Any], List[str]]:
    warnings: List[str] = []
    if not path.is_file():
        warnings.append(f"config file missing: {path}; using hard-coded defaults")
        return dict(_SAFE_DEFAULTS), warnings
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        warnings.append(f"config file unreadable ({path}): {exc}; using hard-coded defaults")
        return dict(_SAFE_DEFAULTS), warnings
    if not isinstance(data, dict):
        warnings.append(f"config file root not object ({path}); using hard-coded defaults")
        return dict(_SAFE_DEFAULTS), warnings
    merged = dict(_SAFE_DEFAULTS)
    for key, value in data.items():
        if key in _SAFE_DEFAULTS:
            merged[key] = value
        else:
            warnings.append(f"unknown config key ignored: {key}")
    return merged, warnings


def _coerce_field(name: str, value: Any, expected: type) -> Tuple[Any, Optional[str]]:
    try:
        if expected is bool:
            if isinstance(value, bool):
                return value, None
            if isinstance(value, (int, float)) and value in (0, 1):
                return bool(value), None
            if isinstance(value, str):
                low = value.strip().lower()
                if low in ("1", "true", "yes", "on"):
                    return True, None
                if low in ("0", "false", "no", "off", ""):
                    return False, None
            return _SAFE_DEFAULTS[name], f"{name}={value!r} invalid bool; using default"
        if expected is int:
            return int(value), None
        if expected is float:
            return float(value), None
        if expected is str:
            return str(value), None
    except (TypeError, ValueError):
        return _SAFE_DEFAULTS[name], f"{name}={value!r} invalid; using default"
    return _SAFE_DEFAULTS[name], f"{name} unexpected type; using default"


def _dict_to_config(raw: Dict[str, Any]) -> Tuple[AnticheatConfig, List[str]]:
    warnings: List[str] = []
    kwargs: Dict[str, Any] = {}
    field_types = {f.name: f.type for f in fields(AnticheatConfig)}
    # frozen dataclass field.type may be string under from __future__ annotations
    type_map = {
        "enabled": bool,
        "mode": str,
        "sanctions_enabled": bool,
        "max_speed_kmh": float,
        "min_dt_sec": float,
        "max_dt_sec": float,
        "position_jump_margin_m": float,
        "position_jump_speed_factor": float,
        "max_accel_ms2": float,
        "spline_out_of_range_eps": float,
        "min_valid_lap_ms": int,
        "max_valid_lap_ms": int,
        "cuts_anomaly_threshold": int,
        "score_decay_per_sec": float,
        "score_weight_low": float,
        "score_weight_medium": float,
        "score_weight_high": float,
        "evidence_score_threshold": float,
        "ring_buffer_size": int,
        "sink_queue_size": int,
        "sink_drop_log_every": int,
    }
    del field_types  # unused; type_map is authoritative
    for name, expected in type_map.items():
        value, warn = _coerce_field(name, raw.get(name, _SAFE_DEFAULTS[name]), expected)
        kwargs[name] = value
        if warn:
            warnings.append(warn)

    cfg = AnticheatConfig(**kwargs)
    # Sanitize ranges
    fixes: List[str] = []
    if cfg.min_dt_sec <= 0:
        cfg = replace(cfg, min_dt_sec=_SAFE_DEFAULTS["min_dt_sec"])
        fixes.append("min_dt_sec <= 0; reset to default")
    if cfg.max_dt_sec <= cfg.min_dt_sec:
        cfg = replace(cfg, max_dt_sec=_SAFE_DEFAULTS["max_dt_sec"])
        fixes.append("max_dt_sec <= min_dt_sec; reset max_dt_sec to default")
    if cfg.ring_buffer_size < 1:
        cfg = replace(cfg, ring_buffer_size=_SAFE_DEFAULTS["ring_buffer_size"])
        fixes.append("ring_buffer_size < 1; reset to default")
    if cfg.sink_queue_size < 1:
        cfg = replace(cfg, sink_queue_size=_SAFE_DEFAULTS["sink_queue_size"])
        fixes.append("sink_queue_size < 1; reset to default")
    if cfg.max_speed_kmh <= 0:
        cfg = replace(cfg, max_speed_kmh=_SAFE_DEFAULTS["max_speed_kmh"])
        fixes.append("max_speed_kmh <= 0; reset to default")
    mode = cfg.mode.strip().lower()
    if mode not in ("observe", "enforce"):
        cfg = replace(cfg, mode="observe")
        fixes.append(f"mode={mode!r} invalid; using observe")
    else:
        cfg = replace(cfg, mode=mode)
    # Accidental enforce without sanctions stays observe-safe for actions
    if cfg.mode == "enforce" and not cfg.sanctions_enabled:
        fixes.append(
            "ANTICHEAT_MODE=enforce but sanctions_enabled=false; "
            "no kicks/bans will run (hard gate)"
        )
    warnings.extend(fixes)
    return cfg, warnings


def _apply_env(base: AnticheatConfig) -> Tuple[AnticheatConfig, List[str]]:
    warnings: List[str] = []
    updates: Dict[str, Any] = {}

    enabled, w = _env_bool("ANTICHEAT_ENABLED", base.enabled)
    if w:
        warnings.append(w)
    updates["enabled"] = enabled

    sanctions, w = _env_bool("ANTICHEAT_SANCTIONS_ENABLED", base.sanctions_enabled)
    if w:
        warnings.append(w)
    updates["sanctions_enabled"] = sanctions

    mode_raw = os.getenv("ANTICHEAT_MODE")
    if mode_raw is not None:
        updates["mode"] = mode_raw.strip().lower() or base.mode

    float_env = {
        "ANTICHEAT_MAX_SPEED_KMH": "max_speed_kmh",
        "ANTICHEAT_MIN_DT_SEC": "min_dt_sec",
        "ANTICHEAT_MAX_DT_SEC": "max_dt_sec",
        "ANTICHEAT_POSITION_JUMP_MARGIN_M": "position_jump_margin_m",
        "ANTICHEAT_POSITION_JUMP_SPEED_FACTOR": "position_jump_speed_factor",
        "ANTICHEAT_MAX_ACCEL_MS2": "max_accel_ms2",
        "ANTICHEAT_SPLINE_EPS": "spline_out_of_range_eps",
        "ANTICHEAT_SCORE_DECAY_PER_SEC": "score_decay_per_sec",
        "ANTICHEAT_EVIDENCE_SCORE_THRESHOLD": "evidence_score_threshold",
    }
    for env_name, field_name in float_env.items():
        val, w = _env_float(env_name, getattr(base, field_name))
        if w:
            warnings.append(w)
        if os.getenv(env_name) is not None:
            updates[field_name] = val

    int_env = {
        "ANTICHEAT_MIN_VALID_LAP_MS": "min_valid_lap_ms",
        "ANTICHEAT_MAX_VALID_LAP_MS": "max_valid_lap_ms",
        "ANTICHEAT_RING_BUFFER_SIZE": "ring_buffer_size",
        "ANTICHEAT_SINK_QUEUE_SIZE": "sink_queue_size",
    }
    for env_name, field_name in int_env.items():
        val, w = _env_int(env_name, getattr(base, field_name))
        if w:
            warnings.append(w)
        if os.getenv(env_name) is not None:
            updates[field_name] = val

    merged = replace(base, **updates)
    # Re-run range sanitization via dict round-trip
    as_dict = {f.name: getattr(merged, f.name) for f in fields(AnticheatConfig)}
    cfg, extra = _dict_to_config(as_dict)
    warnings.extend(extra)
    return cfg, warnings


def load_config(
    path: Optional[Path] = None,
    *,
    apply_env: bool = True,
) -> ConfigLoadResult:
    """Load config with safe defaults. Never raises for bad input."""
    warnings: List[str] = []
    json_path = path if path is not None else _DEFAULT_JSON
    raw, w = _load_json_file(json_path)
    warnings.extend(w)
    cfg, w = _dict_to_config(raw)
    warnings.extend(w)
    source = str(json_path)
    if apply_env:
        cfg, w = _apply_env(cfg)
        warnings.extend(w)
        source = f"{json_path}+env"
    return ConfigLoadResult(config=cfg, warnings=warnings, source=source)


def default_config() -> AnticheatConfig:
    return load_config(apply_env=False).config
