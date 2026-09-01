# Convex: push server config sync to ac-data (`refresh-config`)

When server configuration changes in ProjectD (create/update/delete/activate), schedule an immediate ac-data refresh instead of waiting for the slow fallback poll (~10 min). Bootstrap on ac-data start and the fallback poll remain as safety nets.

## Endpoint (ac-data)

```http
POST http://AC_DATA_HOST:3000/hud/worker/refresh-config
Content-Type: application/json

{
  "workerSecret": "<CONVEX_WORKER_SECRET>",
  "instanceId": "vps-eu-1",
  "configVersion": "stable-version-string",
  "reason": "server_updated"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `workerSecret` | yes | Or header `X-Worker-Secret` |
| `instanceId` | yes | Must match VPS `AC_INSTANCE_ID` or ac-data returns `404 instance_mismatch` |
| `configVersion` | recommended | Stable version from `workerSync:getWorkerInstanceSyncVersion`; skip publish if unchanged |
| `reason` | optional | Log label, e.g. `server_updated`, `server_activated`, `branding_updated` |

## What ac-data does

1. Validates worker secret and `instanceId === AC_INSTANCE_ID`
2. Calls `timeAttackServers:getWorkerInstanceServerConfigs` (Convex)
3. Updates managed-server registry (`hudManagedServers`)
4. `XADD ac:config` with `server_config_snapshot`
5. Existing consumers apply without changes:
   - `redisConfigApplier` → INI + restart
   - `telemetry-data` → runtime server modes

Response:

```json
{
  "ok": true,
  "instanceId": "vps-eu-1",
  "published": true,
  "configVersion": "cfg-2026-08-31T12:00:00Z",
  "snapshotVersion": "snap-abc",
  "totalServers": 4
}
```

When `configVersion` matches the last published version: `"published": false` (idempotent).

## Convex: internal action (ProjectD)

Deploy in **ProjectD** (not assetto-infra):

```typescript
"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const notifyAcDataConfigRefresh = internalAction({
  args: {
    instanceId: v.string(),
    configVersion: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const baseUrl = process.env.AC_DATA_BASE_URL;
    const workerSecret = process.env.CONVEX_WORKER_SECRET;
    if (!baseUrl || !workerSecret) {
      console.warn("[config] AC_DATA_BASE_URL or CONVEX_WORKER_SECRET missing");
      return null;
    }

    const body: Record<string, string> = {
      workerSecret,
      instanceId: args.instanceId.trim(),
    };
    if (args.configVersion?.trim()) {
      body.configVersion = args.configVersion.trim();
    }
    if (args.reason?.trim()) {
      body.reason = args.reason.trim();
    }

    const url = `${baseUrl.replace(/\/$/, "")}/hud/worker/refresh-config`;
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        return null;
      }
      lastError = await response.text();
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    console.warn("[config] ac-data refresh-config failed", lastError);
    return null;
  },
});
```

### Multi-VPS base URL

Per-instance URL resolution (pick one):

| Approach | When |
|----------|------|
| `workerInstances` table with `acDataBaseUrl` | Fleet with different hosts per VPS |
| Single `AC_DATA_BASE_URL` env | One VPS per Convex deployment |
| Convex env map `AC_DATA_BASE_URL_{instanceId}` | Small fixed fleet |

Always POST to the VPS whose `AC_INSTANCE_ID` matches `instanceId`.

## Schedule from server mutations

After any mutation that changes the worker snapshot:

1. Bump **stable** `configVersion` in worker sync metadata (never use `Date.now()` alone on every read — causes restart loops).
2. Read new `configVersion` from sync row.
3. Schedule:

```typescript
await ctx.scheduler.runAfter(0, internal.workerActions.notifyAcDataConfigRefresh, {
  instanceId: server.instanceId,
  configVersion,
  reason: "server_updated",
});
```

| Mutation (ProjectD) | `reason` |
|---------------------|----------|
| Create server | `server_created` |
| Update track/entries/mode | `server_updated` |
| Activate / deactivate | `server_activated` / `server_deactivated` |
| Branding / CM images | `branding_updated` |
| Delete server | `server_deleted` |

## Environment

### ac-data (VPS)

| Variable | Default | Purpose |
|----------|---------|---------|
| `REDIS_CONFIG_SYNC_INTERVAL_MS` | `600000` | Fallback poll interval (10 min) |
| `REDIS_CONFIG_SYNC_FALLBACK_ENABLED` | `true` | Set `false` for webhook-only |
| `AC_INSTANCE_ID` | `default` | Must match webhook `instanceId` |

### ProjectD (Convex dashboard)

| Variable | Purpose |
|----------|---------|
| `AC_DATA_BASE_URL` | e.g. `http://VPS_IP:3000` |
| `CONVEX_WORKER_SECRET` | Same secret as ac-data |

Optional: raise `pollIntervalMs` returned by `getWorkerInstanceSyncVersion` to `600000` so Convex and ac-data fallback align.

## Verification

```bash
# Manual webhook (from VPS or trusted host)
./scripts/verify-config-push.sh

# After admin edit in ProjectD
redis-cli XREVRANGE ac:config + - COUNT 1
tail -f ac-data.log | rg 'refresh-config|redis-config-sync.*reason='
```

## Rollout checklist

1. Deploy ac-data with `/hud/worker/refresh-config` + slow fallback (safe even before Convex hooks).
2. Set `AC_DATA_BASE_URL` on Convex deployment(s).
3. Deploy `notifyAcDataConfigRefresh` + wire server mutations.
4. Edit a server in admin → confirm `published: true` in ac-data log within seconds.
5. Optional: set `REDIS_CONFIG_SYNC_FALLBACK_ENABLED=false` once webhooks are reliable.

## Related

- [`docs/CONVEX_PUSH_USER_SYNC.md`](CONVEX_PUSH_USER_SYNC.md) — same webhook pattern for HUD user refresh
- [`docs/AC_DATA.md`](AC_DATA.md) — ac-data subsystem map
- [`telemetry-data/REDIS_CONTRACT.md`](../telemetry-data/REDIS_CONTRACT.md) — `server_config_snapshot` schema
