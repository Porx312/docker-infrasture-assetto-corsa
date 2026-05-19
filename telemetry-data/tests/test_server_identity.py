import os
from pathlib import Path

import pytest

from core.server_identity import (
    cfg_path_priority,
    derive_server_folder_id,
    is_legacy_root_server_cfg,
)


@pytest.mark.parametrize(
    "cfg_path,expected",
    [
        ("/home/jose/assetto-infra/server/server-2/cfg/server_cfg.ini", "server-2"),
        ("/home/jose/assetto-infra/server/server/cfg/server_cfg.ini", "server"),
        ("/home/jose/assetto-infra/server/server_cfg.ini", "server"),
        (r"C:\assetto\server\server-1\cfg\server_cfg.ini", "server-1"),
        ("", ""),
    ],
)
def test_derive_server_folder_id(cfg_path, expected):
    assert derive_server_folder_id(cfg_path) == expected


def test_cfg_path_priority_prefers_numbered_instance():
    numbered = "/repo/server/server-2/cfg/server_cfg.ini"
    nested = "/repo/server/server/cfg/server_cfg.ini"
    legacy = "/repo/server/server_cfg.ini"
    assert cfg_path_priority(numbered) > cfg_path_priority(nested)
    assert cfg_path_priority(nested) > cfg_path_priority(legacy)


def test_is_legacy_root_server_cfg(tmp_path):
    base = str(tmp_path)
    legacy = os.path.join(base, "server_cfg.ini")
    Path(legacy).write_text("[SERVER]\n", encoding="utf-8")
    assert is_legacy_root_server_cfg(legacy, base) is True
    assert is_legacy_root_server_cfg(os.path.join(base, "server", "cfg", "server_cfg.ini"), base) is False
