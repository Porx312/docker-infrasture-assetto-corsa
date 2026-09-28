# Install Control API into ProjectD (Next.js BFF)

This monorepo is the **hub/edge**. ProjectD Host lives in a separate repo.

**Full team handoff (servers + mods + ensure):** [PROJECTD_HOST_TEAM_HANDOFF.md](./PROJECTD_HOST_TEAM_HANDOFF.md) — paste that into a ProjectD Cursor chat.

**Preferred BFF:** Next.js Route Handlers (`/api/control/*`) + Clerk — **not** Convex Actions (polling Actions is costly; hub reads are not reactive).

## Env (Vercel / `.env.local` on ProjectD — server only)

```bash
CONTROL_API_URL=https://your-hub.example.com
CONVEX_WORKER_SECRET=…    # same as hub X-Worker-Secret; NEVER NEXT_PUBLIC_
```

## Central library cutover (required)

Host must **not** build the mod library from per-VPS inventory:

```text
# WRONG
selected VPS → GET inventory → build library
```

```text
# RIGHT
GET /v1/mods                    # central library
GET /v1/mods/availability?instanceId=…
        → combined UI (AVAILABLE + LOCAL/MISSING/DOWNLOADING/ERROR)
```

Flow before start:

1. Catalog from `GET /v1/mods` (and `/v1/mods/:slug` for detail) — includes optional `imageUrl` cover
2. Availability for the selected VPS
3. Show badges: `LOCAL` / `MISSING` / `DOWNLOADING` / `INSTALLING` / `ERROR`
4. When needed: `POST /v1/instances/:id/mods/ensure`
5. Wait until artifacts are `LOCAL`
6. Only then allocate / apply-config / start

Legacy `GET /v1/instances/:id/mods/cars|tracks` is **LOCAL CONTENT / INVENTORY**: use it for **skins[]** (cars) and **configs[]** layouts (tracks) after a mod is `LOCAL` — join with catalog via `acContentSlug === carModel|trackSlug`. Do **not** use inventory alone as the global library. Details: [PROJECTD_HOST_TEAM_HANDOFF.md](./PROJECTD_HOST_TEAM_HANDOFF.md) §4b.

Exact version identity uses `artifactId` + `sha256` (+ `version` when present). Slug alone is not “LOCAL”.

## What to implement in ProjectD

See **[PROJECTD_HOST_TEAM_HANDOFF.md](./PROJECTD_HOST_TEAM_HANDOFF.md)** for the full checklist and Cursor prompt. Summary:

1. `src/lib/controlApi/server.ts` — `requireUser` (Clerk) + `controlGet`/`controlPost` with `X-Worker-Secret`
2. Route Handlers under `app/api/control/` mirroring hub `/v1`:
   - **mods catalog:** `GET /mods`, `GET /mods/:slug`, `GET /mods/availability`
   - **ensure:** `POST /instances/:id/mods/ensure`
   - **inventory (skins/layouts when LOCAL):** `GET /instances/:id/mods/cars|tracks`
   - live, summary, servers, allocate, apply-config, start/stop/restart
3. Client hooks: `fetch('/api/control/…')` — catalog ~60s, availability ~5–15s while ensuring, inventory after LOCAL, live ~5s
4. Host UI: region + Convex preset → allocate → **ensure** → **inventory for skins/layouts** → apply-config → start
5. Live path uses **lobby name**, not Convex `servers._id`
6. After Host no longer needs `live_players`: ops sets `LIVE_INGEST_CONVEX=false` on every edge

Hub contracts: [CONTROL_API_V1.md](../CONTROL_API_V1.md), [MOD_DISTRIBUTION.md](../MOD_DISTRIBUTION.md), [SERVER_PLATFORM.md](../SERVER_PLATFORM.md), [CONTROL_API_HOST_CUTOVER.md](../CONTROL_API_HOST_CUTOVER.md), [openapi/control-api-v1.yaml](../openapi/control-api-v1.yaml).

## Smoke (hub reachable)

```bash
export HUB=https://your-hub.example.com
export SECRET=…
export INSTANCE=vps-eu-2
export LOBBY=ProjectD

# Central library
curl -sS "$HUB/v1/mods" -H "X-Worker-Secret: $SECRET" | head -c 400
curl -sS "$HUB/v1/mods/availability?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET" | head -c 400

# Ensure (example artifact)
# curl -sS -X POST "$HUB/v1/instances/$INSTANCE/mods/ensure" \
#   -H "X-Worker-Secret: $SECRET" -H "Content-Type: application/json" \
#   -d '{"tracks":[{"modId":"otarumi_touge","version":"1.2"}]}'

# Legacy inventory (cutover only)
curl -sS "$HUB/v1/instances/$INSTANCE/mods/cars" -H "X-Worker-Secret: $SECRET" | head -c 200

curl -sS "$HUB/v1/live/summary" -H "X-Worker-Secret: $SECRET"
curl -sS "$HUB/v1/servers/$LOBBY/live?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET"
curl -sS "$HUB/v1/servers?region=eu&status=idle" -H "X-Worker-Secret: $SECRET"
```

Browser DevTools on Host must show only `/api/control/*` — never the hub host.
