# Documentation (canonical)

Fleet model: **hub** (`ac-data-backend`) + **edges** (`ac-data-edge`) + **shared Redis** + HUD **WSS**. Everything else is under [`archive/`](./archive/).

## Ops (start here)

| Doc | Purpose |
|-----|---------|
| [VPS_FLEET_SETUP.md](./VPS_FLEET_SETUP.md) | Stand up hub + edges |
| [MULTI_REGION_EDGE.md](./MULTI_REGION_EDGE.md) | Topology, env, Redis |
| [HUD_HARDENING_CUTOVER.md](./HUD_HARDENING_CUTOVER.md) | WSS + Convex `presence` + `LIVE_INGEST_CONVEX=false` |
| [MOD_DISTRIBUTION.md](./MOD_DISTRIBUTION.md) | Edge blobs, peer pull, hub catalog |
| [VPS_SECURITY_HARDENING.md](./VPS_SECURITY_HARDENING.md) | Secrets, firewall, Redis AUTH |
| [VPS_CAPACITY.md](./VPS_CAPACITY.md) | Host sizing |

## Product / APIs

| Doc | Purpose |
|-----|---------|
| [AC_DATA.md](./AC_DATA.md) | Packages layout |
| [CONTROL_API_V1.md](./CONTROL_API_V1.md) | Host Control API |
| [SERVER_PLATFORM.md](./SERVER_PLATFORM.md) | Host start / live roster paths |
| [HOST_CATALOG_SYNC.md](./HOST_CATALOG_SYNC.md) | Hub → Convex cars/tracks/servers |
| [TELEMETRY_DATA.md](./TELEMETRY_DATA.md) | Python → Redis events |
| [HUD_SNAPSHOT_POLL_FLICKER.md](./HUD_SNAPSHOT_POLL_FLICKER.md) | Overlay anti-flicker |

## ProjectD handoffs (`examples/`)

| Doc | Audience |
|-----|----------|
| [PROJECTD_WEB_CONVEX_HUB_HANDOFF.md](./examples/PROJECTD_WEB_CONVEX_HUB_HANDOFF.md) | Web / Convex ↔ hub |
| [PROJECTD_HOST_TEAM_HANDOFF.md](./examples/PROJECTD_HOST_TEAM_HANDOFF.md) | Host team |
| [PROJECTD_BFF_INSTALL.md](./examples/PROJECTD_BFF_INSTALL.md) | BFF install notes |

## Secrets (strict / prod)

Distinct values required:

- `CONVEX_WORKER_SECRET` — Convex worker only  
- `FLEET_EDGE_SECRET` — hub↔edge proxy / agent  
- `MOD_PEER_SECRET` — edge↔edge mod blobs  

Fallback to one secret only with `ALLOW_INSECURE_DEFAULTS=true` outside production-like `ASSETTO_ENV`.

## Related

- Scripts: [`../scripts/README.md`](../scripts/README.md)  
- Overlay: [`../ProjectD-HUD/`](../ProjectD-HUD/) (`./scripts/verify-requires.sh`)  
- Ship hub: `npm run sync:hub-repo` / `npm run package:hub`
