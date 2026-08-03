# Staging HTTPS (Caddy + Let's Encrypt)

Expose ac-data on **HTTPS** for launcher, HUD overlay, and admin on this VPS.

## Architecture

```
Launcher / HUD / Browser
        ↓
Caddy :443 on VPS (Let's Encrypt)
        ↓
ac-data 127.0.0.1:3000
```

Optional later: Cloudflare in front of `projectd.touge.com` — see [Troubleshooting](#troubleshooting).

## Hostnames (this VPS — active today)

| Role | URL |
|------|-----|
| Launcher + HUD | `https://dev-api.projectd.space` |
| Admin panel | `https://dev-admin.projectd.space` |

Configured in [`deploy/caddy/caddy.env`](../deploy/caddy/caddy.env). DNS **A** records must point directly to the VPS public IP (Hostinger / no Cloudflare proxy required for LE).

**Legacy / future:** `dev-api.projectd.touge.com` is documented for a Cloudflare setup but is **not** active until DNS + TLS are configured for that domain.

Prod later: `api.projectd.space` / `admin.projectd.space` (or `projectd.touge.com` when migrated).

## One-time setup

### 1. DNS

Create **A** records pointing to this VPS public IP (`13.140.160.131`):

- `dev-api.projectd.space`
- `dev-admin.projectd.space`

For Cloudflare + `projectd.touge.com` (optional, not required for current staging):

- `dev-api` → VPS IP (proxied or DNS-only depending on SSE needs)
- `dev-admin` → VPS IP

SSL/TLS mode on Cloudflare: **Full** when proxied. Use **Full (strict)** only with a Cloudflare Origin Certificate or public LE cert on the origin.

Optional: [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) on admin (email allowlist).

### 2. Start Caddy on the VPS

**Docker (no sudo):**

```bash
chmod +x scripts/start-caddy-docker.sh scripts/setup-caddy-staging.sh
./scripts/start-caddy-docker.sh
```

**Systemd (with sudo):**

```bash
./scripts/setup-caddy-staging.sh
```

### 3. Environment (`.env.local`)

```bash
AC_DATA_BIND_HOST=127.0.0.1
CORS_ORIGIN=https://dev-admin.projectd.space
ADMIN_COOKIE_SECURE=true
STAGING_API_URL=https://dev-api.projectd.space
STAGING_ADMIN_URL=https://dev-admin.projectd.space
```

Restart ac-data:

```bash
./stop.sh && ./start.sh dev
```

### 4. Launcher desktop

Set base URL to `https://dev-api.projectd.space` (not `http://IP:3000`).

HUD overlay:

```text
https://dev-api.projectd.space/hud/stream?steamId=...
```

ZIP downloads (`/client/hud/download`, `/client/content/.../download`) always return **200 with a full body** — no conditional `304` caching.

## Verification

```bash
curl -s https://dev-api.projectd.space/api/health
curl -s https://dev-api.projectd.space/client/bootstrap | jq '.hud'
curl -sI https://dev-api.projectd.space/client/content/cars/MOD_NAME/download | grep -i content-length
curl -sS -D - -o /dev/null -H 'If-None-Match: W/"test"' \
  https://dev-api.projectd.space/client/hud/download | head -3
# Must be HTTP 200, not 304
# Admin login in browser: https://dev-admin.projectd.space/admin
# HUD SSE: keep connected >5 min while in session
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 502 from Caddy | ac-data not running or `AC_DATA_BIND_HOST=127.0.0.1` without ac-data up |
| Cert errors / TLS `unrecognized name` | Wrong hostname — use `projectd.space` until `touge.com` DNS is configured; check `deploy/caddy/caddy.env` |
| HUD disconnects ~100s | Cloudflare proxy timeout — try DNS-only (grey cloud) on `dev-api` or disable proxy for `/hud/stream` |
| Admin login fails | `ADMIN_COOKIE_SECURE=true` requires HTTPS; `CORS_ORIGIN` must match admin URL |

## Files

| Path | Purpose |
|------|---------|
| [`deploy/caddy/Caddyfile`](../deploy/caddy/Caddyfile) | Reverse proxy + long timeouts for ZIP/SSE |
| [`deploy/caddy/caddy.env`](../deploy/caddy/caddy.env) | Hostnames and upstream |
| [`scripts/start-caddy-docker.sh`](../scripts/start-caddy-docker.sh) | Start Caddy via Docker (no sudo) |
| [`docker-compose.caddy.yml`](../docker-compose.caddy.yml) | Caddy container (host network) |
