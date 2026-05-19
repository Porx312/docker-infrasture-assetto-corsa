# Modo batallas (touge) — estado actual

Documentación del modo touge/batallas tal como está implementado en `telemetry-data`: activación por Convex, emparejamiento automático, máquina de estados por pareja, reglas de puntuación y eventos Redis.

## Activación del servidor

Una instancia de AC solo ejecuta lógica de batallas si su modo en la snapshot de Convex es `battle`:

- Convex → bridge Node (`ac-data`) → stream Redis `ac:config` → `core/runtime_config.py`
- En cada paquete de telemetría, `core/packet_processor.py` resuelve el modo y llama `battle_manager.set_server_mode(server_mode == "battle")`
- Si no hay snapshot Redis aún, el modo es `None` y **no hay batallas** hasta que llegue la config

## Arquitectura: muchas batallas 1v1 en paralelo

```mermaid
flowchart TB
  subgraph telemetry [telemetry-data]
    PP[packet_processor UPDATE]
    BM[BattleManager orchestrator]
    PM1[PairBattleManager A vs B]
    PM2[PairBattleManager C vs D]
    SM[session_manager callbacks]
  end
  Convex[Convex type=battle] --> Redis[Redis ac:config]
  Redis --> RC[runtime_config]
  RC --> PP
  PP --> BM
  BM --> PM1
  BM --> PM2
  PM1 --> SM
  PM2 --> SM
  SM --> Chat[send_chat ACSP]
  SM --> Webhook[battle_update / battle_finished]
```

- `engines/battlesystem/orchestrator.py` (`BattleManager`): caché global de `CarState` por GUID, **matchmaking** y un `PairBattleManager` por pareja
- `engines/battlesystem/pair_manager.py` (`PairBattleManager`): máquina de estados de una batalla touge concreta
- Colisiones entre coches **no dan puntos** (`handle_collision` es no-op)

## Emparejamiento (matchmaking)

En cada `update()` de telemetría (`orchestrator._try_matchmake`):

1. Candidatos: activos en los últimos **3 s**, sin pareja asignada
2. Se emparejan si están a **≤ 15 m** (`BATTLE_ARM_MAX_GAP_METERS`) y ambos van a **> 40 km/h** (`BATTLE_ARM_MIN_SPEED_KMH`)
3. Algoritmo **greedy nearest-neighbor**: el par más cercano que cumple condiciones se bloquea primero; se repite hasta agotar candidatos
4. Un jugador solo puede estar en **una** batalla a la vez (`guid_to_pair`)

## Máquina de estados por pareja

Estados: `IDLE` → `ARMED` → `LAUNCHING` → `ACTIVE` → `FINISHED` (`engines/battlesystem/state_machine.py`)

| Estado | Qué ocurre |
|--------|------------|
| **IDLE** | Tras cooldown post-partida (20 s). Si `can_arm` (≤15 m, ambos >40 km/h) → **ARMED** + chat "X vs Y — ARMED" |
| **ARMED** | Si se separan >45 m con ambos ≥20 km/h tras 2 s de gracia → abort sin punto. Si ambos >40 km/h → **LAUNCHING** + "GO — both over 40 km/h". Se crea `battle_id` vía `on_battle_start` |
| **LAUNCHING** | Espera roles lead/chase claros en spline (gap ≥0.0006 en pista, ~6 s máx). Si no → abort `leader_not_clear`. OK → **ACTIVE** + "You are LEAD/CHASE" |
| **ACTIVE** | Puntuación en vivo (overtake, finish, abandon). Roles: **lead** adelante en spline, **chase** detrás |
| **FINISHED** | Cooldown 20 s, marcador se conserva, luego reset a IDLE para rematch con la misma pareja |

Constantes tunables en `engines/battlesystem/config.py` (variables de entorno con prefijo `BATTLE_` / `OVERTAKE_`).

## Cómo se puntúa

### Durante ACTIVE

1. **Overtake (+1 al chase)** — `engines/battlesystem/rules/overtake.py`
   - Tras **2 s** de gracia al entrar en ACTIVE
   - Cooldown **2 s** entre puntos de adelantamiento
   - Solo si distancia **10–15 m** (paso claro, misma batalla)
   - Chase pasa al lead en spline (margen `0.0003` en loop de pista)

2. **Position recovery (+1 al lead)** — tras un overtake del chase, si el lead recupera posición adelante

3. **Abandon por separación (≥250 m)** — `engines/battlesystem/rules/finish.py` (`check_abandon_by_gap`)
   - Parado / muy lento → abandona ese piloto
   - Lead mucho más rápido y adelante en pista → lead se fue, gana chase
   - Si ya hubo puntos en el marcador → victoria al no-abandonador; si **0-0** → cancelación sin ganador

### Fin de vuelta (lead completa el tramo)

- Lead debe recorrer **~100% del spline** (`RUN_END_SPLINE_FRACTION=1.0`, umbral efectivo 0.995) usando `driven_spline` acumulado
- Al cruzar meta:
  - Gap final **≥ 100 m** → **+1 finish** al lead (`finish_outrun`) y gana la sesión
  - Gap **< 100 m** → **empate**, sin punto de finish
- Chat: `FINISH — WIN …` o `FINISH — DRAW … | Rematch in 20s`

### Desconexión / inactividad

- Disconnect en ARMED/LAUNCHING/ACTIVE → intenta `_finalize_abandon` al que queda
- Telemetría stale >20 s o jugador inactivo >5 s → cancel o abandon según estado y marcador

## Feedback al jugador

- Mensajes **privados in-game** vía `handle_chat_message` → `send_chat` por `car_id` (`core/session_manager.py`)
- Formato de puntos: `OVERTAKE +1`, `RECOVER +1`, `FINISH +1`, marcador `NombreA 2 : NombreB 1`, etc. (`engines/battlesystem/chat.py`)

## Persistencia / backend

- Al pasar a **ARMED**, se genera `battle-{uuid12}` (`handle_battle_start` en `session_manager.py`)
- **Solo al terminar** una sesión con `winner_guid` definido se publica Redis:
  - `battle_update` + `battle_finished` con scores, `pointsLog`, track, coches (`network/event_dispatcher.py`)
- No hay updates intermedios por cada punto; el webhook es al cierre de la serie/sesión

Ver también [REDIS_CONTRACT.md](../REDIS_CONTRACT.md) para el esquema de eventos.

## Qué NO hace el modo batalla

- No usa vueltas cronometradas del modo time-attack
- No puntúa colisiones coches-coches
- No escribe `server_cfg.ini` (lo hace `ac-data` desde Convex)
- No funciona sin modo `battle` en la snapshot de config

## Archivos clave

| Rol | Archivo |
|-----|---------|
| Orquestación multi-pareja | `engines/battlesystem/orchestrator.py` |
| Estado 1v1 | `engines/battlesystem/state_machine.py` |
| Umbrales | `engines/battlesystem/config.py` |
| Integración AC | `core/packet_processor.py` |
| Tests reglas | `tests/battlesystem/` |

## Referencia rápida de umbrales

| Regla | Umbral (default) | Variable de entorno |
|-------|------------------|---------------------|
| Arm / pair lock | ≤ 15 m, ambos > 40 km/h | `BATTLE_ARM_MAX_GAP_METERS`, `BATTLE_ARM_MIN_SPEED_KMH` |
| Abort prestart | > 45 m, ambos ≥ 20 km/h tras 2 s | `MAX_BATTLE_GAP_METERS`, `BATTLE_PRESTART_GAP_ABORT_GRACE_SEC` |
| Overtake / recovery | gap 10–15 m | `OVERTAKE_MIN_GAP_METERS`, `OVERTAKE_MAX_GAP_METERS` |
| Finish | lead completa vuelta + gap ≥ 100 m | `RUN_END_SPLINE_FRACTION`, `BATTLE_FINISH_POINT_MIN_GAP_METERS` |
| Abandon | gap ≥ 250 m | `BATTLE_DISAPPEAR_GAP_METERS` |
| Rematch cooldown | 20 s | `BATTLE_FINISHED_COOLDOWN_SEC` |
