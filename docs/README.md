# Documentation index (canonical)

Source of truth for the **hub + edge + shared Redis** fleet. Prefer these over older SSE/monolith docs.

## Start here

| Doc | Purpose |
|-----|---------|
| [AC_DATA.md](./AC_DATA.md) | Package layout (`ac-data-shared` / edge / backend) |
| [MULTI_REGION_EDGE.md](./MULTI_REGION_EDGE.md) | Multi-VPS topology |
| [VPS_FLEET_SETUP.md](./VPS_FLEET_SETUP.md) | Ops checklist to stand up a fleet |
| [HUD_HARDENING_CUTOVER.md](./HUD_HARDENING_CUTOVER.md) | HUD WSS + Convex `presence` + `LIVE_INGEST_CONVEX=false` |
| [CONTROL_API_V1.md](./CONTROL_API_V1.md) | Host Control API |

## Architecture (short)

- **Edge** (`ac-data-edge`): AC process, Redis→ingest bridge, HUD **WSS** primary, mod agent.
- **Hub** (`ac-data-backend`): Convex, admin UI, HUD bootstrap/gateway fallback, Control API, Postgres mods.
- **Shared** (`ac-data-shared`): Redis HUD keys, fleet registry, secrets, content/health helpers.
- Overlay: repo [`ProjectD-HUD/`](../ProjectD-HUD/) — WSS + snapshot poll; secrets via `ac.storage` / bootstrap, not committed keys.

## Secrets (strict / prod)

Set **distinct** values:

- `CONVEX_WORKER_SECRET` — Convex worker queries only  
- `FLEET_EDGE_SECRET` — hub↔edge proxy / agent / inventory  
- `MOD_PEER_SECRET` — edge↔edge mod blob pull  

Fallbacks that reuse one secret are only allowed with `ALLOW_INSECURE_DEFAULTS=true` outside production-like `ASSETTO_ENV`.

## Ship path (hub)

Prefer **git sync clone** → `ProjectD-Backend-Servers` (see `scripts/sync-projectd-backend-servers.sh`). Treat `dist/` tarballs as regenerable artifacts, not source of truth.

## Historical / superseded

Moved under [`archive/`](./archive/) or marked historical:

- SSE-era HUD notes (`CONVEX_PROFILE_COSMETICS`, join-context SSE wording)
- Monolithic `ac-data` paths in old security audits
- Root `SETUP_GUIDE.md` (Server Manager era) — prefer this index + `VPS_FLEET_SETUP.md`
