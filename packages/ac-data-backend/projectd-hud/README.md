# ProjectD HUD releases (hub downloads)

Zips under `releases/` are what players download via the hub admin **ProjectD HUD** tab / `GET /client/hud/latest`.

**Source of truth for overlay code:** repo root [`ProjectD-HUD/`](../../../ProjectD-HUD/).

When uploading a new release from the admin UI, build the ZIP from that tree (so `session_version_dedupe.lua` / `session_context_guard.lua` ship with the release). Do not hand-edit files only inside `releases/`.
