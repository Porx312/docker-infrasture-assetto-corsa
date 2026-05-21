# Verificación: batallas Redis → Convex

Fecha: 2026-05-20. Entorno: `vps-eu-2`, Redis local, deployment `combative-rhinoceros-728`.

## Resumen

| Etapa | Estado | Notas |
|-------|--------|-------|
| telemetry → Redis `ac:events` | OK | `battle_update` + `battle_finished` presentes (p. ej. `battle-353202a3e4e1`) |
| ac-data bridge consume | OK | `lag=0`, consumer `ac-data-vps-eu-2` |
| bridge → Convex ingest | **Falla** | `ingestWorkerEventsBatch` devuelve `ok: false` por schema |
| Persistencia `event_battles` | **No** | Campo extra `scheduledTime` no está en el validador Convex |

## Redis

```bash
redis-cli XREVRANGE ac:events + - COUNT 50 | grep battle_finished
```

Ejemplo reciente: ganador `76561199230780195`, `battleId=battle-353202a3e4e1`, track `pk_akina`.

## Bridge

- Grupo `ac-data-consumers`, `lag=0`.
- PEL zombie (11 mensajes antiguos) limpiado con `XACK`.
- **Corrección aplicada:** el bridge ya no hace `XACK` si `ingestWorkerEventsBatch` devuelve `results[].ok === false` (antes ack-eaba aunque Convex fallara).

## Convex

Prueba directa (mismo payload que Redis):

```
serverEvents:ingestWorkerEventsBatch → results[0].ok: false
```

Error (resumido):

```
Failed to insert into table "event_battles": extra field `scheduledTime` not in validator
  at upsertEventBattleRow (../convex/battles.ts:189)
```

**Acción requerida en el proyecto Convex** (no está en `assetto-infra`):

1. Quitar `scheduledTime` del insert en `convex/battles.ts`, **o**
2. Añadir `scheduledTime: v.optional(v.float64())` al schema de `event_battles`.

Tras desplegar el fix en Convex, los eventos `battle_finished` pendientes en Redis se reintentarán automáticamente (sin ack hasta ingest OK).

## Cambios en assetto-infra

- `ac-data/src/services/redisConvexBridge.ts` — validar respuesta de ingest antes de `XACK`.
- `telemetry-data/network/event_dispatcher.py` — `serverName` = display name; empates publican `battle_finished` con `status: draw`.
- `telemetry-data/core/session_manager.py` — dispatch en empate (scores iguales, sin ganador).
- `.env.local` — indentación corregida en variables `CONVEX_*` (dotenv solo cargaba 1 variable).

## Comandos de seguimiento

```bash
# Nuevos eventos de batalla
redis-cli XREVRANGE ac:events + - COUNT 10

# Cola del bridge
redis-cli XINFO GROUPS ac:events
redis-cli XPENDING ac:events ac-data-consumers

# Errores de ingest (tras reiniciar ac-data)
grep 'convex ingest failed' /home/jose/assetto-infra/ac-data.log
```
