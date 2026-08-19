# HUD getHudSession vs lap_completed — audit report

Read-only audit (2026-08-19). See also [`CONVEX_LAP_HUD_PUSH.md`](CONVEX_LAP_HUD_PUSH.md), [`JOIN_HUD_FANOUT_INVESTIGATION.md`](JOIN_HUD_FANOUT_INVESTIGATION.md).

## Incidente prod (~106 getHudSession/min en cualquier vuelta)

**Deployment:** `honorable-ptarmigan-477` (prod). **Este VPS dev** usa `combative-rhinoceros-728` — no comparte contadores Convex con prod.

| Campo | Valor |
|-------|-------|
| Pico reportado | ~106 `hud:getHudSession` / min (ej. **12:44–12:45 CEST**) |
| Trigger operador | **Cualquier vuelta** (incl. no-PB) |
| Ventana anclada | `T_MS=1787136240000` → `[1787136120000, 1787136360000]` (±2 min) |
| Script correlación | `./scripts/verify-lap-spike-correlation.sh --anchor-ms 1787136240000` |

### Veredicto causal (1 línea)

> Vuelta no-PB → `ingestWorkerEventsBatch` en **ProjectD** dispara ~N× `getHudSession` interno (N ≈ jugadores en `live_players` / ventana leaderboard); ac-data solo hace `patch_last_lap_ms`, **0** `refresh-user` y **0** `fetchHudSession` en el path no-PB.

### Evidencia dev VPS (2026-08-19, controlado)

Simulación: `./scripts/simulate-lap-completed.sh 76561199588591028 --lap-ms 350000` (vuelta lenta, no-PB).

| Métrica | Antes | Después | Δ |
|---------|-------|---------|---|
| `fetchHudSession` (ac-data) | 19 | 19 | **0** |
| `fetchPlayerJoinContext` | 6 | 6 | **0** |
| `refresh-user` webhooks | — | 0 nuevos | **0** |
| Redis `lap_completed` en ventana | — | 1 | — |

Correlación: `./scripts/verify-lap-spike-correlation.sh --last-minutes 10` → 1 lap, hint fan-out ProjectD si Convex prod muestra ~106 en el mismo minuto.

**Nota:** el proceso ac-data en este host arrancó antes del deploy de `[hud-lap-post-ingest]` — reiniciar `./stop.sh && ./start.sh dev` para ver `action=patch_only` en log tras ingest.

### Árbol de decisión (prod)

| Evidencia | Veredicto |
|-----------|-----------|
| 1 lap Redis, 0–3 `refresh-user`, spike ~106 Convex, ac-data `fetchHudSession` Δ0 | **Convex ingest interno** (ProjectD) |
| 1 lap, ~106 `refresh-user` steamIds distintos | Webhook fan-out Convex → ac-data (`getPlayerJoinContext` ×N) |
| ~106 `lap_completed` en ventana | Carga (~106 laps/min); revisar 1 query/lap en ingest |
| `[hud-lap-post-ingest] action=patch_only` + spike | ac-data **no** es caller directo en no-PB |

---

## Diagnóstico (ráfagas idle ~150 / 10–15 min)

**Causa probable de ráfagas ~150 cada 10–15 min:** no es el path legacy `lap_completed → getHudSession` (desactivado y **sin cablear**). El patrón O(N) con N ≈ jugadores conectados encaja con **keepalive WSS** que, antes de `peekSessionCache`, llamaba `getSessionCached` cada 30s y hacía fetch a Convex cuando expiraba `HUD_SESSION_TTL_SEC` (300s). Secundario en PB real: webhooks Convex `POST /hud/worker/refresh-user` (`lap_pb` / `rival_pb`). ac-data **no lee** `lap.pbChanged` ni `lap.saved` del batch de ingest Convex.

## Verificación runtime (VPS dev / 2026-08-19)

| Check | Resultado |
|-------|-----------|
| `HUD_LAP_AC_DATA_REFRESH_ENABLED` | **No definida** → default `false` |
| `peekSessionCache` en `hudWs.ts` | **Sí** (keepalive fix desplegado en código) |
| `scheduleHudRefreshAfterLap` callers prod | **Ninguno** (solo tests + definición en scheduler) |
| `fetchHudSession` vs `fetchPlayerJoinContext` | 19 vs 6 (event-driven, no O(N) en muestra idle) |
| `wsConnected` | 0 en muestra (sin HUD in-game) |
| `[hud-worker] refresh-user` en log | 3 (lap_pb + rival_pb) |
| `[hud-refresh]` en log | 4 (**battle_finished**, no lap legacy) |

Script: `./scripts/verify-hud-lap-session-audit.sh`, `./scripts/verify-lap-spike-correlation.sh`

## ProjectD ingest — checklist de auditoría (repo Convex, read-only)

No está en assetto-infra. Revisar en **honorable-ptarmigan-477** durante ventana del pico:

| # | Pregunta | Esperado (contrato) | Si falla |
|---|----------|---------------------|----------|
| 1 | ¿`ingestWorkerEventsBatch` llama `getHudSession` / `buildHudSessionForSteamId` en loop sobre `live_players` o tablero completo? | Solo steamIds afectados (autor ± rivals) | Explica ~106/min con N≈conectados **en cualquier vuelta** |
| 2 | ¿`notifyAcDataHudRefresh` está gated por `pbChanged === true` / rank change? | **Solo PB** o cambio rank/rivals ([`CONVEX_LAP_HUD_PUSH.md`](CONVEX_LAP_HUD_PUSH.md)) | Webhooks en todo lap → ac-data vería N× `refresh-user` (no solo `getHudSession` en dashboard) |
| 3 | ¿Rival notify limitado a `above`/`below` before+after? | Set dedupe ≤5 steamIds típ. | Fan-out a todos los conectados |
| 4 | Functions log: caller de `getHudSession` en minuto 12:44 | Mutation ingest, no HTTP ac-data | Confirma origen interno |
| 5 | ¿`getPlayerJoinContext` duplica conteo dashboard vs `getHudSession`? | Misma función interna `buildHudSessionForSteamId` ([`CONVEX_PLAYER_JOIN_CONTEXT.md`](CONVEX_PLAYER_JOIN_CONTEXT.md)) | Dashboard puede inflar si ingest llama join context en masa |

**Fix ProjectD (si #1):** tras persistir lap, recomputar leaderboard en DB; llamar `buildHudSessionForSteamId` solo para `{ author, rivals… }`; programar `notifyAcDataHudRefresh` solo si `pbChanged || rankChanged`. No iterar `live_players`.

**Fix ProjectD (si #2):** gate webhooks; ac-data ya asume no-PB = patch Redis only.

## Env relevantes

| Variable | Default código | Dev (`.env.local`) |
|----------|----------------|---------------------|
| `HUD_LAP_AC_DATA_REFRESH_ENABLED` | `false` | unset → false |
| `CONVEX_DEPLOYMENT_URL` | required | dev deployment activo |
| `CONVEX_WORKER_SECRET` | — | definido |
| `AC_INSTANCE_ID` | `default` | `vps-eu-2` |
| `HUD_WS_KEEPALIVE_MS` | 30000 | 30000 |
| `HUD_SESSION_TTL_SEC` | 300 | default |
| `AC_DATA_BASE_URL` | — | Convex dashboard (ProjectD) |

## Path lap_completed

Tras ingest ack → [`handleLapCompletedAfterIngest`](../ac-data/src/services/eventHandlers/lapCompleted.ts):

- `patchLastLapInCaches` (Redis `last_lap_ms` only)
- Si PB local (`isLapPersonalBest`) → `invalidateHudCachesForSteamId` (DEL keys, **no Convex**)
- Log: `[hud-lap-post-ingest] steamId=… pbLocal=… action=patch_only|invalidate_cache`

**No** llama `getHudSession`. **No** usa `lap.saved` / `lap.pbChanged` del batch Convex.

Legacy [`scheduleHudRefreshAfterLap`](../ac-data/src/services/hud/hudRefreshScheduler.ts) gated por `HUD_LAP_AC_DATA_REFRESH_ENABLED` — **unwired** (cero callers en producción).

## Webhook refresh-user

`POST /hud/worker/refresh-user` → [`refreshHudUserStatusFromConvex`](../ac-data/src/services/hud/hudUserStatusNotify.ts):

1. `getPlayerJoinContext` → escribe `ac:hud:session:*`
2. Push WSS con `preferCachedSession` (lap_pb/rival_pb/session) o bypass (cosmetics)
3. Log: `[hud-worker] refresh-user done … joinContext=1 fetchSession=0|1`

## Tabla origen → getHudSession

| Origen | getHudSession |
|--------|---------------|
| `lap_completed` after ingest | **No** |
| Legacy lap scheduler | **Sí** si enabled + wired (**off / unwired**) |
| `refresh-user` webhook | 0–1 por webhook |
| WSS keepalive (post peekSessionCache) | **No** en idle |
| `/hud/snapshot` poll | Sí si WSS down |
| `battle_finished` | Sí (2 jugadores típ.) |

## Logs de trazabilidad

| Prefix | Origen |
|--------|--------|
| `[hud-lap-post-ingest]` | Post-ingest lap (sin fetch session) |
| `[hud-push] fetchHudSession` | Push path que llama Convex session |
| `[hud-ws-keepalive]` | Keepalive cache peek (sampled on miss) |
| `[hud-worker] refresh-user` / `done` | Webhook Convex |
| `[hud-refresh]` | battle_finished scheduler (legacy lap si enabled) |

## Fix recomendado

1. **ProjectD (prioridad):** auditar ingest lap — eliminar loop `getHudSession` sobre todos los `live_players`; gate `notifyAcDataHudRefresh` por `pbChanged`/rank change.
2. Mantener `HUD_LAP_AC_DATA_REFRESH_ENABLED=false`; no cablear legacy lap scheduler.
3. Confirmar `peekSessionCache` desplegado en prod (elimina ráfagas O(N) idle).
4. Reiniciar ac-data tras deploy para logs `[hud-lap-post-ingest]` / `[hud-worker] refresh-user done`.
5. Correlación post-incidente: `./scripts/verify-lap-spike-correlation.sh --anchor-ms 1787136240000 --env prod` en VPS prod con Redis + log.

## Riesgos

- HUD stale si webhook Convex falla → monitor `[hud-worker] refresh-user failed`
- Rivales dependen de Convex `rival_pb` (legacy fan-out off)
- `patchLastLapInCaches` sigue actualizando `last_lap_ms` local sin PB Convex
