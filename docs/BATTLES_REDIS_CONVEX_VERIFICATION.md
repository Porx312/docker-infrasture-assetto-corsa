# Verificación: batallas Redis → Convex

Última revisión: **2026-08-20** (`vps-eu-2`, Redis local, deployment `combative-rhinoceros-728`).

## Resumen

| Etapa | Estado | Notas |
|-------|--------|-------|
| telemetry → Redis `ac:events` | OK | `battle_update` + `battle_finished` (p. ej. `battle-242d2a412c08`) |
| ac-data bridge consume | OK | `lag=0`, `pending=0`, consumer `ac-data-vps-eu-2` |
| bridge → Convex ingest | **OK en Convex** | `ingestWorkerEventsBatch` persiste batalla (`ok: true`, `coalescedFrom: 2`) |
| bridge XACK / after-ingest | **Fallaba (fix 2026-08-20)** | Desajuste resultados coalescidos → reintento falso de `battle_finished` |
| Persistencia `event_battles` | OK (dev) | Error histórico `scheduledTime` ya no reproduce en dev |

## Causa raíz (2026-08-20)

Convex **coalesce** `battle_update` + `battle_finished` en un solo resultado:

```json
{
  "coalescedFrom": 2,
  "ok": true,
  "processed": 1,
  "results": [{ "ok": true, "index": 0, "eventType": "battle_finished" }]
}
```

El bridge esperaba un resultado por evento. Con 2 eventos y 1 fila indexada en `0`:

- `battle_update` (índice 0) se marcaba como OK por error.
- `battle_finished` (índice 1) quedaba sin fila → **reintento** → log `convex batch ingest failed (retrying): 1 of 2 events`.
- `handleBattleFinishedAfterIngest` (refresh ELO HUD) solo corría tras XACK de `battle_finished` → retrasado o ausente en el primer intento.

**Fix en assetto-infra:** `ac-data/src/services/ingestBatchAck.ts` — si `ok: true`, `failed: 0` y todos los `results[]` son OK pero hay menos filas que eventos, ack de todo el batch (Convex coalesció).

**Nota:** El error documentado en mayo 2025 (`scheduledTime` extra en `event_battles`) **no reproduce** en dev hoy; la sonda directa a Convex inserta batallas correctamente.

## Correlación de logs (batallas reales)

| battleId | telemetry | ac-data ingest | worker_error |
|----------|-----------|----------------|--------------|
| `battle-b02495ec46a6` | `battle_finished` OK | batch 2 eventos → ingest failed 1/2 | sí |
| `battle-242d2a412c08` | `battle_finished` OK | batch 2 eventos → ingest failed 1/2 | sí |

## Redis

```bash
source .env.local
redis-cli -a "$REDIS_PASSWORD" --no-auth-warning XREVRANGE ac:events + - COUNT 20
redis-cli -a "$REDIS_PASSWORD" --no-auth-warning XINFO GROUPS ac:events
redis-cli -a "$REDIS_PASSWORD" --no-auth-warning XPENDING ac:events ac-data-consumers
```

## Sondas directas Convex

```bash
# Solo battle_finished sintético
npx tsx scripts/diag-battle-convex-ingest.ts

# Batch real battle_update + battle_finished (como el bridge)
npx tsx scripts/diag-battle-convex-ingest-batch.ts

# Verificación completa
./scripts/verify-battle-convex-ingest.sh
```

## Checklist post-fix (reiniciar ac-data)

```bash
# 1. Reiniciar ac-data para cargar ingestBatchAck fix
./stop.sh && ./start.sh dev

# 2. Batalla real o simulate SIN --skip-stream
./scripts/simulate-battle-complete.sh --fast

# 3. Sin falsos reintentos
rg 'convex batch ingest failed' ac-data.log | tail -5   # vacío tras batalla

# 4. HUD ELO post-batalla (WSS conectado)
rg 'hud-refresh.*battle|refresh-user' ac-data.log | tail -10
```

## Cambios en assetto-infra

- `ac-data/src/services/ingestBatchAck.ts` — ack batch cuando Convex coalesce eventos de batalla.
- `ac-data/src/services/redisConvexBridge.ts` — log de error con `eventType` y detalle por fila.
- `scripts/diag-battle-convex-ingest.ts` — sonda battle_finished.
- `scripts/diag-battle-convex-ingest-batch.ts` — sonda batch coalesced.
- `scripts/verify-battle-convex-ingest.sh` — Redis + logs + sonda Convex.

## Histórico (2026-05-20)

Error Convex previo (ProjectD, posiblemente ya corregido en dev):

```
Failed to insert into table "event_battles": extra field `scheduledTime` not in validator
  at upsertEventBattleRow (../convex/battles.ts:189)
```

Si reaparece en prod: quitar `scheduledTime` del insert o añadir `scheduledTime: v.optional(v.number())` al schema.
