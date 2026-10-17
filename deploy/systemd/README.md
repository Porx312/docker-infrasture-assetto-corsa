# systemd units (edge host)

**Status: templates only — not installed by deploy scripts.** Operator must copy and adapt paths.

## ac-data-edge

1. Build: `npm run build -w @projectd/ac-data-shared && npm run build -w @projectd/ac-data-edge`
2. Copy [`ac-data-edge.service.example`](./ac-data-edge.service.example) → `/etc/systemd/system/ac-data-edge.service`
3. Replace `__INSTALL_ROOT__`, `__ENV_FILE__`, `__SERVICE_USER__`, `__SERVICE_GROUP__`, `__NODE_BIN__`
4. `sudo systemctl daemon-reload && sudo systemctl enable --now ac-data-edge`
5. Probe: `curl -sf http://127.0.0.1:3000/api/live` (liveness, no Redis)
6. Readiness: `curl -sf http://127.0.0.1:3000/api/health` (Redis-aware)

### Coexistence with `start.sh` / `reload-infra.sh`

Those scripts use `nohup` + `tsx watch`. **Do not run both** nohup edge and this unit.

- Prefer: `systemctl restart ac-data-edge` after builds instead of `./reload-infra.sh`
- Or: `systemctl stop ac-data-edge` before legacy `./reload-infra.sh` / `./start.sh … edge`

`uncaughtException` now exits with code 1 so `Restart=on-failure` can recover.

## Hub (Dokploy)

Hub typically runs under Dokploy/Docker — verify restart policy there. Do not stack a second supervisor on the same process. Optional self-host unit can mirror this example with `packages/ac-data-backend/dist/index.js`.

## Telemetry

Production Docker already uses `restart: unless-stopped` in `docker-compose.prod.yml`. Do not add a conflicting systemd unit for the same container.
