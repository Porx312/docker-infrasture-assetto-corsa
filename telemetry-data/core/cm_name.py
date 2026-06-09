"""Strip Content Manager lobby suffix from server display names (ℹ{port})."""

from __future__ import annotations

import re

# Same separator as ac-server-wrapper / ac-data cmWrapper.ts
CM_SUFFIX_SEP = "\u2139"
_CM_SUFFIX_RE = re.compile(r"\s[\u2139ℹ]\d+$")


def strip_cm_name_suffix(name: str) -> str:
    """Remove trailing CM wrapper port marker, e.g. 'projectd ℹ18081' -> 'projectd'."""
    if not name:
        return name
    text = name.strip()
    idx = text.find(CM_SUFFIX_SEP)
    if idx != -1:
        return text[:idx].rstrip()
    m = _CM_SUFFIX_RE.search(text)
    if m:
        return text[: m.start()].rstrip()
    return text


def display_server_name(server_state) -> str:
    """Readable server name for Redis/Convex, never including CM suffix."""
    raw = (
        getattr(server_state, "config_server_name", None)
        or getattr(server_state, "server_name", "")
        or getattr(server_state, "server_folder_id", None)
        or ""
    )
    return strip_cm_name_suffix(str(raw))
