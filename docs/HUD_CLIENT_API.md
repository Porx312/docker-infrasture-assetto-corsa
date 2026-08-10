# HUD client API (`/client/hud/*`)

Public read API for **ProjectD HUD overlay** distribution. Players install the CSP Lua app into Assetto Corsa; runtime data comes from `/hud/*` (SSE), not from `/client/*`.

## Install path (player PC)

Copy or extract the HUD ZIP to:

```
assettocorsa/apps/lua/ProjectD-HUD/
```

Source in this repo: [`ProjectD-HUD/`](../ProjectD-HUD/). See [`ProjectD-HUD/README.md`](../ProjectD-HUD/README.md) for CSP setup and `config.API_BASE_URL`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/client/bootstrap` | `{ ok, hud }` — latest HUD release metadata (or `hud: null`) |
| GET | `/client/hud/latest` | Latest release metadata |
| GET | `/client/hud/download` | Download latest HUD ZIP |
| GET | `/client/hud/download/:filename` | Download specific release |

### Example metadata

```json
{
  "ok": true,
  "version": "ProjectD-HUD",
  "filename": "ProjectD-HUD.zip",
  "sha256": "...",
  "sizeBytes": 1234567,
  "uploadedAt": "2026-01-15T12:00:00.000Z"
}
```

### Example usage

```bash
BASE=https://dev-api.projectd.space

curl -s "$BASE/client/hud/latest" | jq
curl -L "$BASE/client/hud/download" -o ProjectD-HUD.zip
```

ZIP downloads return **200 with full body** (no `304` caching) so clients always get the file.

## Runtime API (in-game)

After install, the overlay connects to:

| Path | Purpose |
|------|---------|
| `GET /hud/stream` | SSE — profile, competition, battle |
| `GET /hud/snapshot` | Poll fallback |
| `GET /hud/version` | Version check |

Optional: set `HUD_API_KEY` on the server and `ac.storage("ProjectD-HUD:api_key", "…")` in-game.

See [`docs/HUD_BATTLE_INTEGRATION.md`](HUD_BATTLE_INTEGRATION.md), [`docs/HUD_TIME_ATTACK_INTEGRATION.md`](HUD_TIME_ATTACK_INTEGRATION.md).

## Admin upload

Admin panel → **ProjectD HUD** tab, or:

- `GET /admin/hud/releases`
- `POST /admin/hud/releases` (multipart ZIP)
- `DELETE /admin/hud/releases/:filename`

## Environment

| Variable | Purpose |
|----------|---------|
| `PROJECTD_HUD_PATH` | Directory with `manifest.json` + `releases/` |
| `CLIENT_SYNC_MAX_ZIP_MB` | Max upload size for HUD ZIP |
| `CLIENT_LAUNCHER_*` | Rate limits / CORS on `/client/*` (applies to HUD routes) |
| `CLIENT_LAUNCHER_REQUIRE_API_KEY` + `CLIENT_SYNC_API_KEY` | Optional API key on `/client/*` |

## Removed (no longer supported)

Desktop launcher app, `/client/launcher/*`, `/client/servers`, and `/client/content/*` mod sync were removed. Manage mods on the player side (Steam, manual install). VPS content is managed via the admin **Cars/Tracks** panel only.
