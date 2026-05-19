# Capacidad VPS y escalado de servidores AC

## Snapshot (VPS 10, 2026-05-18)

Medición con `./scripts/vps-capacity-check.sh` en el host de producción:

| Métrica | Valor |
|---------|--------|
| RAM total | 7.8 GiB |
| RAM available | ~6.0 GiB |
| Cores | 4 |
| Load average | ~1.5–1.8 |
| Procesos `acServer` activos | 3 (de 12 configurados en ese momento) |
| Listeners UDP 96xx/120xx | 15 |

Con carga casi vacía, **8 GB es suficiente para ~12 instancias**. Subir plan si `available` &lt; 1 GiB sostenido o load &gt; 4 con pocos jugadores.

## Servidores recomendados por plan

| Plan | CPU | RAM | Vacío / ligero | ~2 jugadores/servidor |
|------|-----|-----|----------------|----------------------|
| VPS 10 | 4 | 8 GB | 12–14 | 8–10 |
| VPS 20 | 6 | 12 GB | 18–22 | 12–14 |
| VPS 30 | 8 | 24 GB | 32–38 | 20–24 |
| VPS 40 | 12 | 48 GB | 50+ | 35–40 |

Mejor relación precio/capacidad desde 12 servidores vacíos: **VPS 20**.

## ~300 servidores bajo demanda (50–100 en pico)

Lo que limita el hardware son **procesos `acServer` vivos**, no filas en Convex:

| Pico simultáneo | RAM orientativa | CPU orientativa |
|-----------------|-----------------|-----------------|
| 50 | ~24–35 GB | 12–16 cores |
| 100 | ~40–70 GB | 16–32 cores |

### VPS cloud vs dedicado

| Opción | 50–100 AC en pico |
|--------|-------------------|
| 1× VPS 60 (96 GB) | Justo; CPU compartida |
| **1× dedicado 128 GB** | **Recomendado** |
| 2× VPS 50 | Alternativa (~50 procesos por host) |

**No recomendado:** cientos de VPS pequeños (content duplicado, operación inviable).

### Pool on-demand (código)

| Variable | Default | Efecto |
|----------|---------|--------|
| `SERVER_POOL_MODE` | `false` | Si `true`, solo arranca AC cuando Convex envía `isActive: true` |
| `SERVER_POOL_ENABLED` | `false` | Si `true`, para procesos tras N min sin jugadores (`server_status`) |
| `SERVER_POOL_IDLE_SHUTDOWN_MINUTES` | `15` | Minutos sin jugadores antes de `stopServerCore` |

- Activar sala: Convex `isActive: true` en snapshot, o `POST /ac-server/servers/:name/activate` (API key).
- Telemetría publica `server_status`; `ac-data` actualiza actividad y aplica idle shutdown.

### Prueba de carga local

```bash
chmod +x scripts/load-test-ac-servers.sh scripts/vps-capacity-check.sh
# Requiere API_KEY y ac-data en :3000
./scripts/load-test-ac-servers.sh --count 12 --hold 60
```

Logs en `scripts/load-test-results/`. En VPS 10 no subas `--count` por encima de carpetas existentes (~12). En dedicado futuro, repetir con 30–50 y comparar RAM/load.

## Escalar más allá de `server-11`

1. Clonar instancia: [`server-templates/CloneServer.sh`](../server-templates/CloneServer.sh)  
   Ejemplo: `./CloneServer.sh server-12 9720 8093`
2. Entrada en Convex + snapshot Redis (`ac:config`)
3. `ac-data` lee puertos desde cada `server_cfg.ini` (`serverPorts.ts`)
4. Telemetry en prod: `network_mode: host` en [`docker-compose.prod.yml`](../docker-compose.prod.yml)
5. Firewall: UDP juego + puerto plugin (`UDP_PLUGIN_ADDRESS`)

## Decisión de hardware (checklist)

Tras `./scripts/load-test-ac-servers.sh` con el pico que esperes:

| Resultado bajo carga | Acción |
|----------------------|--------|
| `available` &gt; 2 GiB con N procesos vacíos | Mismo plan aguanta más instancias vacías |
| `available` &lt; 1 GiB o load &gt; cores | Subir a VPS 20 o dedicado 64 GB |
| Necesitas 50–100 con jugadores | **Dedicado 128 GB** (o 2× VPS 50 con `AC_INSTANCE_ID` distinto) |
| Solo 12 servidores, casi vacíos | **Mantener VPS 10** |

## Scripts y límites

| Componente | Escala |
|------------|--------|
| `telemetry-data` | Descubre cualquier `server-N/cfg/server_cfg.ini` |
| `ac-data` | Puertos desde INI; pool + start/stop API |
| Redis / Convex | Más `server_status`; límite = plan Redis Cloud |

Ver también [telemetry-data/docs/BATTLE_MODE.md](../telemetry-data/docs/BATTLE_MODE.md).
