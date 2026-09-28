# Install Control API into ProjectD (Next.js BFF)

This monorepo is the **hub/edge**. ProjectD Host lives in a separate repo.

**Preferred BFF:** Next.js Route Handlers (`/api/control/*`) + Clerk — **not** Convex Actions (polling Actions is costly; hub reads are not reactive).

## Env (Vercel / `.env.local` on ProjectD — server only)

```bash
CONTROL_API_URL=https://your-hub.example.com
CONVEX_WORKER_SECRET=…    # same as hub X-Worker-Secret; NEVER NEXT_PUBLIC_
```

## What to implement in ProjectD

Paste the handoff plan into a Cursor chat on the **ProjectD** repo (do not implement Host UI here):

1. `src/lib/controlApi/server.ts` — `requireUser` (Clerk) + `controlGet`/`controlPost` with `X-Worker-Secret`
2. Route Handlers under `app/api/control/` mirroring hub `/v1` (mods, live, summary, servers, allocate, apply-config, start/stop/restart)
3. Client hooks: `fetch('/api/control/…')` — mods ~60s, live ~5s
4. Host UI: region + Convex preset → allocate → apply-config → start
5. Live path uses **lobby name**, not Convex `servers._id`
6. After Host no longer needs `live_players`: ops sets `LIVE_INGEST_CONVEX=false` on every edge

Hub contracts: [CONTROL_API_V1.md](../CONTROL_API_V1.md), [SERVER_PLATFORM.md](../SERVER_PLATFORM.md), [CONTROL_API_HOST_CUTOVER.md](../CONTROL_API_HOST_CUTOVER.md), [openapi/control-api-v1.yaml](../openapi/control-api-v1.yaml).

## Smoke (hub reachable)

```bash
export HUB=https://your-hub.example.com
export SECRET=…
export INSTANCE=vps-eu-2
export LOBBY=ProjectD

curl -sS "$HUB/v1/instances/$INSTANCE/mods/cars" -H "X-Worker-Secret: $SECRET" | head -c 200
curl -sS "$HUB/v1/live/summary" -H "X-Worker-Secret: $SECRET"
curl -sS "$HUB/v1/servers/$LOBBY/live?instanceId=$INSTANCE" -H "X-Worker-Secret: $SECRET"
curl -sS "$HUB/v1/servers?region=eu&status=idle" -H "X-Worker-Secret: $SECRET"
```

Browser DevTools on Host must show only `/api/control/*` — never the hub host.
