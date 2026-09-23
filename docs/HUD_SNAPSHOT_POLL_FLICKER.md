# HUD parpadeo: poll `sections=session` / `sections=full`

## Qué muestra el debug

Si en **Last values** ves muchas líneas alternando:

- `.../hud/snapshot?...&sections=session`
- `.../hud/snapshot?...&sections=full`

el **overlay ProjectD-HUD** (Lua en el cliente) está haciendo HTTP poll al hub (`:3001`), no es el hub “solo por existir”. Cada respuesta aplicada repinta perfil + ladder + battle → parpadeo.

## Causas habituales

1. **`session_context_guard`** detecta mismatch track/layout/servidor entre sim en vivo y `cached_bundle` → invalida caché cada ~2s → `sections=full` otra vez.
2. **Poll de cosmetics** pide `sections=session` cuando cambia el fingerprint (correcto), pero si no hay dedupe de versión, cada respuesta repinta igual.
3. **WSS no conectado** → el overlay depende casi solo de HTTP snapshot (más poll).

## Fixes en ac-data-edge (VPS)

- `playerVersion` estable (no `Date.now()` en cada snapshot).
- Menos `refreshPlayerJoinFromConvex` si el mismo `folderSlug` de servidor.

Reinicia **edge** tras `npm run build:edge`.

## Fixes en ProjectD-HUD (copiar al Content Manager / overlay)

Copia desde este repo a tu carpeta **ProjectD-HUD** instalada en AC:

| Archivo | Qué hace |
|---------|----------|
| [`common/api/session_context_guard.lua`](../ProjectD-HUD/common/api/session_context_guard.lua) | Evita bucle por layout `default`/vacío, track compuesto, nombres de servidor distintos pero mismo lobby |
| [`common/api/session_version_dedupe.lua`](../ProjectD-HUD/common/api/session_version_dedupe.lua) | Helper para no aplicar UI si `version|lbVersion|playerVersion` no cambió |

En tu `common/api/session_snapshot.lua` (o donde proceses el JSON del snapshot), **antes** de resetear animaciones / `bundle.apply`:

```lua
local dedupe = require("common.api.session_version_dedupe")
local should_apply, fp = dedupe.should_apply(state.last_applied_version_fp, payload.version)
if not should_apply then
    state.snapshot_inflight = false
    return
end
state.last_applied_version_fp = fp
-- ... apply session as today ...
```

Aumenta intervalos en `common/config.lua` si hace falta:

```lua
HUD_SNAPSHOT_POLL_SEC = 5
HUD_COSMETICS_FP_POLL_SEC = 3
```

No dispares `request_full` y `request_session` en el mismo tick si `snapshot_inflight` ya es true.

## Comprobar

- Debug: las URLs de snapshot deberían espaciarse varios segundos, no cada frame.
- Edge log: no ráfaga de `[hud-snapshot]` con join refresh en cada línea.
- Activa transport debug: `ac.storage("ProjectD-HUD:show_transport", true):set()` — idealmente **WSS** activo además del poll de respaldo.
