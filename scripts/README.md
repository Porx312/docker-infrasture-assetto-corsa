# Scripts (ops)

Only scripts that are part of normal fleet ops live here. One-off verify/debug/load-test tools are under [`archive/`](./archive/).

| Script | Use |
|--------|-----|
| [`sync-projectd-backend-servers.sh`](./sync-projectd-backend-servers.sh) | Ship hub → `ProjectD-Backend-Servers` (`npm run sync:hub-repo`) |
| [`package-backend-hub.sh`](./package-backend-hub.sh) | Tarball hub (`npm run package:hub`) — use `npm run verify:hub-package` / `release:hub-package` before upload |
| [`verify-backend-hub-package.sh`](./verify-backend-hub-package.sh) | Pack + content checks + isolated build (`npm run verify:hub-package`) |
| [`deploy-from-main.sh`](./deploy-from-main.sh) | On-VPS deploy to `origin/main` (`edge`\|`hub`); edge uses infra reload (keeps lobbies) |
| [`../reload-infra.sh`](../reload-infra.sh) | Restart edge + telemetry **without** killing `acServer` (repo root; default `dev`) |
| [`smoke-vps-fleet.sh`](./smoke-vps-fleet.sh) | Quick hub/edge health smoke (`npm run smoke:fleet`) |
| [`rotate-assetto-logs.sh`](./rotate-assetto-logs.sh) + [`logrotate-assetto.conf`](./logrotate-assetto.conf) | Log rotation under `logs/` (`LOG_DIR`, default `$ROOT/logs`) |
| [`rotate-vps-secrets.sh`](./rotate-vps-secrets.sh) | Secret rotation helper |
| [`apply-redis-local-auth.sh`](./apply-redis-local-auth.sh) | Redis AUTH (sudo; restarts Redis) |
| [`audit-firewall.sh`](./audit-firewall.sh) | Firewall audit |
| [`open-server-ports.sh`](./open-server-ports.sh) | Open game/HTTP/CM ports for existing `server`/`server-N` folders (dry-run default; `--apply`) |
| [`fix-server-symlinks.sh`](./fix-server-symlinks.sh) | Repair instance `acServer`/`system` links (relative `../acServer`; rewrite `/home/jose` → host). Edge deploy runs `--apply` |
| [`clear-ingest-pending.sh`](./clear-ingest-pending.sh) | Reclaim stuck `ac:events` consumers |
| [`clear-hud-presence.sh`](./clear-hud-presence.sh) | Clear HUD presence keys for a steamId |
| [`start-cm-proxies.sh`](./start-cm-proxies.sh) / [`stop-cm-proxies.sh`](./stop-cm-proxies.sh) | CM wrappers |
| [`vps-capacity-check.sh`](./vps-capacity-check.sh) | Host capacity snapshot |

HUD require checks live in [`ProjectD-HUD/scripts/`](../ProjectD-HUD/scripts/), not here.
