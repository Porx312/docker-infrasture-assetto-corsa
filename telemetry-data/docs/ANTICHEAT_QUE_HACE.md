# Qué hace el anticheat ACSP (ahora)

Resumen del estado actual del módulo en `telemetry-data/anticheat/`.  
Detalle técnico, variables de entorno y calibración: [ANTICHEAT.md](ANTICHEAT.md).

## Modo actual

- **Observe-only:** observa y registra; **no expulsa ni banea**.
- **Desactivado por defecto** (`ANTICHEAT_ENABLED=false`). Con eso, los hooks no hacen nada y el comportamiento del servidor no cambia.
- Aunque se ponga `ANTICHEAT_MODE=enforce`, las sanciones siguen **apagadas** salvo que se active explícitamente `ANTICHEAT_SANCTIONS_ENABLED` (y aun así el módulo **no llama** a kick/ban hoy).

## Datos que mira

Solo campos ACSP que ya parsea el plugin UDP:

| Origen | Qué usa |
|--------|---------|
| `CAR_UPDATE` | Posición (≈ m), velocidad (m/s), spline de pista (~0–1) |
| `LAP_COMPLETED` | Tiempo de vuelta (ms) y número de *cuts* |
| Join / leave | Steam guid + `car_id` (ciclo de sesión) |

Identidad de estado: **servidor** (`server_folder_id` u otro nombre estable) + **guid**. El mismo `car_id` en dos servidores no se mezcla. Al desconectar se borra toda la sesión.

## Detectores activos

1. **Techo de velocidad** — `‖v‖` por encima del límite configurado (por defecto 450 km/h).
2. **Salto de posición** — desplazamiento demasiado grande frente a velocidad × Δt (solo si el intervalo de tiempo es válido).
3. **Pico de aceleración** — cambio brusco de velocidad / Δt fuera de banda laxa.
4. **Spline fuera de rango** — valor claramente fuera de ~[0, 1].
5. **Integridad de vuelta** — vuelta demasiado rápida respecto al mínimo, tiempo absurdo, o *cuts* reportados por ACSP.

No inventa sectores ni usa gear/rpm (hoy se leen y se descartan en el handler).

## Qué hace con las anomalías

1. Clasifica cada muestra: paquete inválido / muestra no usable / anomalía / evidencia.
2. Varios detectores en **la misma muestra** solo suman **una vez** al score (la más grave).
3. El score **decrece con el tiempo** (decay).
4. Si el score cruza el umbral → **evidencia** en cola acotada → log estructurado (`anticheat_evidence ...`) para **revisión humana**.
5. Una sola anomalía **no** se trata como prueba concluyente de trampas.

Los gaps grandes, paquetes fuera de orden, Δt inválido o NaN/Inf **no** generan evidencia cinemática (y no contaminan el estado).

## Qué no hace (de momento)

- No lee memoria compartida del cliente, inputs, setups, fuel/tyres ni “physics mods”.
- No demuestra manipulación de cliente o física; solo inconsistencias en telemetría ACSP.
- No hay expulsión automática en producción.
- No publica a Redis todavía (solo log / métricas en proceso).

## Cómo activarlo para observar

```bash
ANTICHEAT_ENABLED=true
# ANTICHEAT_MODE=observe   # valor por defecto
# ANTICHEAT_SANCTIONS_ENABLED=false
```

Luego revisar logs de `anticheat_evidence` y calibrar umbrales según [ANTICHEAT.md](ANTICHEAT.md).
