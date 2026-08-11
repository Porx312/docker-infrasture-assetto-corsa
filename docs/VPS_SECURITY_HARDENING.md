# VPS Security Hardening (Phase 2)

Follow-up to [VPS_SECURITY_AUDIT_PHASE1.md](./VPS_SECURITY_AUDIT_PHASE1.md).

## Completed in repo

| Item | Action |
|------|--------|
| HUD auth bypass | `hudBattleAuth.ts` fails closed when `HUD_API_KEY` unset |
| Admin weak defaults | Removed code fallbacks; startup validation in `securityStartup.ts` |
| Admin brute force | Rate limit on `POST /admin/login` (10 / 15 min default) |
| `/ac-server` path traversal | `assertValidServerName` on all mutating routes |
| Secret rotation script | `./scripts/rotate-vps-secrets.sh` |
| Redis AUTH script | `./scripts/apply-redis-local-auth.sh` (sudo, restarts Redis) |
| Firewall audit | `./scripts/audit-firewall.sh` |
| config.yml secrets | Removed from file; added to `.gitignore`; template `config.yml.example` |
| Git history purge | `./scripts/purge-config-secrets-from-git-history.sh` (manual, force-push) |

## Manual steps (operator)

### 1. Rotate local secrets

```bash
chmod +x scripts/rotate-vps-secrets.sh scripts/apply-redis-local-auth.sh
./scripts/rotate-vps-secrets.sh
```

Save the printed `ADMIN_PASS` securely. Update ProjectD HUD overlay with new `HUD_API_KEY`.

### 2. Apply Redis password

```bash
./scripts/apply-redis-local-auth.sh
```

### 3. Restart stack

```bash
./stop.sh && ./start.sh dev
```

### 4. Rotate Convex secrets

In Convex dashboard, rotate and update `.env.local`:

- `CONVEX_PRODUCT_KEY`
- `CONVEX_WORKER_SECRET`
- `CONVEX_INGEST_SECRET`

Redeploy Convex functions if worker secret changes.

### 5. Rotate Steam password

The previous Steam password was in git history. **Rotate in Steam** and set:

```bash
export STEAM_PASSWORD='...'
```

when running Server Manager, or use a local `config.yml` (gitignored).

### 6. Git history

```bash
git rm --cached config.yml   # if still tracked
./scripts/purge-config-secrets-from-git-history.sh
# Coordinate force-push with team
```

### 7. OS isolation (not automated)

Target architecture:

| User | Runs | Access |
|------|------|--------|
| `acdata` | ac-data | `.env` subset, Redis RW, spawn servers |
| `telemetry` | telemetry-data | Redis RW streams, UDP localhost |
| `gameserver` | acServer only | No `.env`, no docker, no home secrets |

Steps: create users, move `SERVERS_PATH` ownership, systemd units with `User=`, drop `jose` from `docker` group or use rootless Docker for Caddy only.

### 8. SSH / firewall

- Set `PermitRootLogin no` in `/etc/ssh/sshd_config.d/`
- Install fail2ban
- Run `./scripts/audit-firewall.sh` and close unnecessary public ports
- Restrict admin vhost by IP in Caddy if possible

### 9. Dev-only escape hatch

For local development with weak credentials (never on VPS):

```bash
ALLOW_INSECURE_DEFAULTS=true
```

Do not set this on staging/production.
