# Scripts (ops)

Scripts for normal fleet ops live here. One-off verify/debug/load-test tools are under [`archive/`](./archive/).

---

## Deploy / day-to-day

| Script | Use |
|--------|-----|
| [`deploy-from-main.sh`](./deploy-from-main.sh) | On-VPS deploy to `origin/main` (`edge`\|`hub`); edge reloads infra (keeps lobbies) and runs symlink fix |
| [`../reload-infra.sh`](../reload-infra.sh) | Restart edge + telemetry **without** killing `acServer` (repo root; default `dev`) |
| [`smoke-vps-fleet.sh`](./smoke-vps-fleet.sh) | Quick hub/edge health smoke (`npm run smoke:fleet`) |
| [`wait-edge-health.sh`](./wait-edge-health.sh) | Wait until an edge `/api/health` (or similar) is ready |

---

## VPS servers (ports, binaries, Convex)

Typical new/broken VPS:

```bash
./scripts/open-server-ports.sh --servers-path "$SERVERS_PATH"          # dry-run
sudo ./scripts/open-server-ports.sh --servers-path "$SERVERS_PATH" --apply
./scripts/fix-server-symlinks.sh --servers-path "$SERVERS_PATH" --apply
./scripts/sync-host-catalog-servers.sh                                 # push all folders → Convex
```

| Script | Use |
|--------|-----|
| [`open-server-ports.sh`](./open-server-ports.sh) | Open game/HTTP/CM ports from each folder’s INI (dry-run default; `--apply`) |
| [`fix-server-symlinks.sh`](./fix-server-symlinks.sh) | Repair `acServer`/`system` links (`../acServer`; rewrite `/home/jose` → host). Edge deploy runs `--apply` |
| [`sync-host-catalog-servers.sh`](./sync-host-catalog-servers.sh) | On edge: force-upsert all local `server`/`server-N` to Convex via hub |

See also [`docs/HOST_CATALOG_SYNC.md`](../docs/HOST_CATALOG_SYNC.md).

---

## Packaging / hub release

| Script | Use |
|--------|-----|
| [`package-backend-hub.sh`](./package-backend-hub.sh) | Tarball hub (`npm run package:hub`) |
| [`verify-backend-hub-package.sh`](./verify-backend-hub-package.sh) | Pack + content checks + isolated build (`npm run verify:hub-package`) |
| [`sync-projectd-backend-servers.sh`](./sync-projectd-backend-servers.sh) | Ship hub → `ProjectD-Backend-Servers` (`npm run sync:hub-repo`) |

---

## Redis / HUD / ingest

| Script | Use |
|--------|-----|
| [`apply-redis-local-auth.sh`](./apply-redis-local-auth.sh) | Redis AUTH (sudo; restarts Redis) |
| [`clear-hud-presence.sh`](./clear-hud-presence.sh) | Clear HUD presence keys for a steamId |
| [`clear-ingest-pending.sh`](./clear-ingest-pending.sh) | Reclaim stuck `ac:events` consumers |

---

## Security / capacity / CM / logs

| Script | Use |
|--------|-----|
| [`audit-firewall.sh`](./audit-firewall.sh) | Firewall audit (read-only) |
| [`rotate-vps-secrets.sh`](./rotate-vps-secrets.sh) | Secret rotation helper |
| [`vps-capacity-check.sh`](./vps-capacity-check.sh) | Host capacity snapshot |
| [`cleanup-stale-procs.sh`](./cleanup-stale-procs.sh) | List/kill stale node/tsx/CM/telemetry + hung `*.test.js`/`*.test.ts` (dry-run default; `--apply`; never acServer/Redis/Cursor). If edge dies: `./reload-infra.sh` |
| [`resilience-probe.sh`](./resilience-probe.sh) | Curl `/api/live` (timeout + HTTP check; exit ≠0 on failure; optional webhook). See [docs/RESILIENCE.md](../docs/RESILIENCE.md) |
| [`start-cm-proxies.sh`](./start-cm-proxies.sh) / [`stop-cm-proxies.sh`](./stop-cm-proxies.sh) | CM details wrappers |
| [`rotate-assetto-logs.sh`](./rotate-assetto-logs.sh) + [`logrotate-assetto.conf`](./logrotate-assetto.conf) | Log rotation under `logs/` (`LOG_DIR`, default `$ROOT/logs`) |

---

HUD require checks live in [`ProjectD-HUD/scripts/`](../ProjectD-HUD/scripts/), not here.
