# Resilience notes (assetto-infra)

Honest limits and what code actually does. **systemd/Dokploy install is operator-owned** until enabled on each host.

## Liveness vs readiness

| Endpoint | Meaning | Depends on Redis? |
|----------|---------|-------------------|
| `GET /api/live` | Process up | **No** |
| `GET /api/health` | Readiness (Redis ping when configured) | Yes when `REDIS_*` set |

Use `/api/live` for process probes. Do **not** restart solely because `/api/health` is 503 (dependency outage thrash).

## Ingest (Redis stream → hub/Convex)

- Delivery is **at-least-once** via consumer group + PEL reclaim.
- Hub forward uses `INGEST_FORWARD_TIMEOUT_MS` (default 15s). Timeout → throw → **no XACK** → reclaim.
- **No HTTP retries** in `edgeIngestForward` (PEL/buffer already retry).
- Bridge `flushIngestBuffer`: `forwardBatchToConvex` runs **before** the XACK loop; a throw leaves messages in PEL.
- **Duplicate window:** if Convex/hub accepts events but the HTTP response never reaches the edge, reclaim may re-forward. Destination **must** dedupe by `eventId` (see `telemetry-data/REDIS_CONTRACT.md`). This repo does not claim exactly-once.

### Convex idempotency (BLOCKED in this repo)

| Step | Location | Status |
|------|----------|--------|
| `eventId` on payloads | edge publish / `ingestEventBuilder` → `_meta.eventId` | Present |
| Mutation name | `serverEvents:ingestWorkerEventsBatch` (`CONVEX_MUTATION_BATCH`) | Wired |
| Atomic dedupe by `eventId` in Convex | **Not in assetto-infra** (Convex app lives elsewhere) | **BLOCKED** |

**Handoff (minimal proposal, do not invent schema here):** in the Convex mutation, reject or no-op events whose `eventId` / `_meta.eventId` was already ingested (unique index or idempotency table). Until that exists, treat prod deploy as blocked for exactly-once claims; staging may proceed with known duplicate risk.

## Config stream (`ac:config`)

- Apply success → `XACK`.
- Apply failure → Redis fail counter (`INCR`, TTL set once) → leave unacked until `CONFIG_APPLY_MAX_FAILURES`.
- At threshold → optional `SET ac:config:dlq:seen:{msgId} NX` → `XADD` `ac:config:dlq` (field `originalMsgId`) → then `XACK`.
- If DLQ `XADD` fails → **no ACK** (`acked=false`).
- **DLQ + ACK are not atomic:** crash after DLQ write and before ACK can enqueue the same `originalMsgId` again unless `setNx` claimed first. Treat DLQ as **at-least-once**; ops dedupe by `originalMsgId`.
- Concurrent INCR at threshold can race two DLQ writes without `setNx`; production applier wires `setNx`.

### Isolated Redis integration

Never point tests at shared/prod Redis.

```bash
bash scripts/redis-test-up.sh
REDIS_TEST_HOST=127.0.0.1 REDIS_TEST_PORT=16379 SKIP_REDIS_INTEGRATION=0 \
  npm run test:integration -w @projectd/ac-data-edge
bash scripts/redis-test-down.sh
```

Without Redis test: integration suite **SKIP** with that command in the message (staging evidence required before prod).

## Telemetry / UDP

- In-memory publish queue can **drop** when full (`REDIS_PUBLISH_QUEUE_SIZE`).
- Stream `MAXLEN` can trim old entries under backlog.
- Assetto UDP has **no retransmission** — packets during telemetry/Redis downtime are lost.

## HUD / multi-region

- Bootstrap `ws.fallback` is hub proxy to the **same** edge, not regional failover.
- Dead edge → 502 / unreachable for that player's presence target.

## Process supervision

- Templates: [`deploy/systemd/`](../deploy/systemd/) — **pending install**.
- Edge/hub: `uncaughtException` → `process.exit(1)` for supervisor restart.
- Telemetry Docker: `restart: unless-stopped` in compose (do not double-supervise).
- Do **not** run systemd unit and `nohup`/`reload-infra.sh` on the same edge process.

## Probe

```bash
./scripts/resilience-probe.sh                    # live only (default)
./scripts/resilience-probe.sh --check=live
./scripts/resilience-probe.sh --check=health
./scripts/resilience-probe.sh --check=both
LIVE_URLS='http://127.0.0.1:3000/api/live' ./scripts/resilience-probe.sh
HEALTH_URLS='http://127.0.0.1:3000/api/health' ./scripts/resilience-probe.sh --check=health
# optional: ALERT_WEBHOOK_URL=… (webhook failure does not hide probe failure)
```

Exit `0` only if all selected URLs return HTTP 2xx within `PROBE_TIMEOUT_SEC`. Down/closed port → exit `1`.

## Staging checklist (no prod)

1. Suites: `npm test -w @projectd/ac-data-shared` and `npm test -w @projectd/ac-data-edge` PASS.
2. Optional Redis integration PASS on ephemeral `:16379`, or document SKIP + exact staging command.
3. Probe against closed port exits `1`; against staging live exits `0`.
4. Install systemd from template **or** keep nohup — not both.
5. Confirm Convex mutation dedupe before claiming prod-ready (otherwise **BLOCKED** for prod).

## Rollback

1. `systemctl stop ac-data-edge` (or stop nohup edge) → restore previous `dist/` / git revision → start again.
2. Redis streams/DLQ keys are durable; do not flush prod streams as “rollback”.
3. Config DLQ entries remain for ops review (`originalMsgId`).
