# Auditoría de seguridad API — hub + edge

**Fecha:** 2026-10-23  
**Alcance:** `@projectd/ac-data-backend` (hub), `@projectd/ac-data-edge`, `@projectd/ac-data-shared`  
**Método:** revisión estática de auth, rutas públicas, uploads, proxy/SSRF, CORS, rate limits  
**Fuera de alcance:** pentest live, Convex Host, malware scanning de ZIPs, este informe **no aplica fixes** (solo remediaciones sugeridas)

### Severidades

| Nivel | Criterio |
|-------|----------|
| **Crítico** | Compromiso de flota / config push / bypass auth en superficie pública con impacto alto |
| **Alto** | Exposición de secretos o metadata sensible, SSRF vía registro, downloads sin control en prod |
| **Medio** | Hardening (timing-safe, rate limit, deprecations) |
| **Bajo** / **Info** | Defaults de CORS/health, bind host, documentación |

---

## 1. Resumen ejecutivo (top 5)

1. **Hub HUD gateway sin API key** — `GET /hud/bootstrap` (y proxy snapshot/WS) no exigen `HUD_API_KEY` en el hub; cualquiera que llegue al hub puede enumerar routing/WS por `steamId`. El edge sí valida key en snapshot/WS.
2. **Integridad del fleet registry = frontera SSRF** — admin proxy y HUD gateway hacen fetch a `baseUrl` del registro. URL envenenada (Redis registry / env / DB) → hub como cliente hacia redes internas. Hay mitigaciones de path (`/admin` only, `redirect: manual`), no blocklist de IPs privadas.
3. **`ALLOW_INSECURE_DEFAULTS` en prod** — si se cuela, permite fallbacks de secretos y passwords débiles; impacto de flota completa.
4. **Client launcher / HUD download** — fuera de entornos prod-like, `/client/hud/*` puede quedar sin API key; CORS default `*`; `?api_key=` en query filtrable en logs/Referer.
5. **Control `/v1` y worker** — auth worker con comparación timing-safe (bien); sin rate limit dedicado; body JSON 50 MB y uploads hasta ~500 MB → DoS por volumen.

**Lo que está bien:** worker secret con `secretsMatch` (SHA-256 + `timingSafeEqual`); zip/HUD filename path traversal mitigado; `/admin/health` detrás de JWT; login admin rate-limited; edge admin vía hub proxy + `X-Worker-Secret`.

---

## 2. Mapa de auth (referencia rápida)

```
Público:     /api/live|health, /branding|mods/images/*, admin login/static,
             hub /hud/bootstrap|snapshot|cosmetics-fp (+ WS upgrade)
Opcional:    /client/* (API key según CLIENT_LAUNCHER_REQUIRE_API_KEY / prod-like)
Worker:      /v1/*, /api/mod-agent/*, /worker/*, /hud/registry/*, /hud/worker/*,
             edge /admin/* (hubOrAdminAuth)
Admin JWT:   hub /admin/* API (cookie httpOnly + Bearer)
API key:     edge HUD snapshot|ws, edge /ac-server, hub /client (si required)
Peer:        edge /api/mod-agent/v1/trees/* (MOD_PEER_SECRET)
```

---

## 3. Hallazgos

| ID | Severidad | Área | Evidencia | Impacto | Remediation |
|----|-----------|------|-----------|---------|-------------|
| A1 | **Alto** (Crítico si hub es público sin WAF) | Hub HUD sin API key | [`hudGatewayRoutes.ts`](../packages/ac-data-backend/src/routes/hudGatewayRoutes.ts) L11–32 (`/bootstrap` sin middleware de key); [`index.ts`](../packages/ac-data-backend/src/index.ts) L86 monta `/hud` sin auth; contraste edge [`hudMiddleware.ts`](../packages/ac-data-edge/src/middleware/hudMiddleware.ts) L10–16 | Enum steamId → edge URLs / WS; abuso de gateway como proxy | Exigir `HUD_API_KEY` (o token de sesión Host) en hub bootstrap/snapshot/WS; rate-limit bootstrap; no devolver `baseUrl` privados al browser |
| A2 | **Alto** | SSRF vía registry | [`edgeAdminProxy.ts`](../packages/ac-data-backend/src/services/fleet/edgeAdminProxy.ts) `buildTargetUrl` L33–46, `redirect: 'manual'` L142; HUD gateway fetch a `edge.baseUrl` | Admin JWT o registry poison → hub SSRF interno | Validar `baseUrl` al registrar (allowlist esquema/host, denegar RFC1918 si hub multi-tenant); auditar quién escribe `ac:hud:registry:state` / fleet DB |
| A3 | **Alto** (Crítico si misconfig) | Insecure defaults | [`fleetSecrets.ts`](../packages/ac-data-shared/src/services/secrets/fleetSecrets.ts) L8–34; [`securityStartup.ts`](../packages/ac-data-shared/src/config/securityStartup.ts) L31–96 | Secretos compartidos / passwords débiles en prod | Nunca `ALLOW_INSECURE_DEFAULTS` en prod; secrets distintos `FLEET_EDGE_SECRET`, `MOD_PEER_SECRET`, `CONVEX_WORKER_SECRET` |
| A4 | **Alto** | Client HUD download | [`clientLauncherMiddleware.ts`](../packages/ac-data-shared/src/middleware/clientLauncherMiddleware.ts) L15–21, L59–64; [`clientSyncAuth.ts`](../packages/ac-data-shared/src/middleware/clientSyncAuth.ts) L12–18 | Descarga/metadata sin key si no prod-like; `api_key` en query | Forzar `CLIENT_LAUNCHER_REQUIRE_API_KEY=true` en prod; preferir solo header `x-api-key`; restringir CORS |
| A5 | **Alto** | CORS abierto | Hub [`index.ts`](../packages/ac-data-backend/src/index.ts) L51–55 `HUD_CORS_ORIGIN \|\| '*'`; launcher L9 `CLIENT_LAUNCHER_CORS_ORIGIN \|\| '*'`; edge HUD L8 | Cualquier origen browser puede llamar (con o sin cookies según ruta) | Setear orígenes explícitos Host / overlay |
| A6 | **Alto** | Admin cookie Secure | [`adminAuth.ts`](../packages/ac-data-shared/src/middleware/adminAuth.ts) L9–10 default false | Cookie admin robable en HTTP / MITM | `ADMIN_COOKIE_SECURE=true` detrás de HTTPS |
| A7 | **Alto** | DoS por tamaño | Hub [`index.ts`](../packages/ac-data-backend/src/index.ts) L65 `express.json({ limit: '50mb' })`; uploads multer ~500 MB (admin/library) | Agotar disco/CPU/memoria | Límites en reverse proxy; rate-limit `/v1` y uploads; alertas |
| M1 | **Medio** | Compare no timing-safe | [`clientSyncAuth.ts`](../packages/ac-data-shared/src/middleware/clientSyncAuth.ts) L18 `!==`; [`hudMiddleware.ts`](../packages/ac-data-edge/src/middleware/hudMiddleware.ts) L15 `===`; edge `API_KEY` similar | Posible timing leak de API keys cortas | Reusar `secretsMatch` / timing-safe para todas las API keys |
| M2 | **Medio** | Body `workerSecret` legacy | [`hudWorkerAuth.ts`](../packages/ac-data-shared/src/services/hud/hudWorkerAuth.ts) L4–17 | Secret en body → logs/proxies | Deprecar body; solo header `X-Worker-Secret` |
| M3 | **Medio** | Sin rate limit `/v1` / worker | Control API + worker ingest/query | Brute / flood tras leak parcial | Rate-limit por IP + por secret hash |
| M4 | **Medio** | Query `api_key` | clientSyncAuth L13–16; hudMiddleware L14 | Filtrado en access logs, Referer, historial | Documentar header-only; rechazar query en prod |
| M5 | **Medio** | OPTIONS global 200 | Hub [`index.ts`](../packages/ac-data-backend/src/index.ts) L59–60 | Ruido / fingerprinting | Responder OPTIONS solo en rutas CORS intencionadas |
| B1 | **Bajo** | Health público | `/api/live`, `/api/health` | Info mínima OK | Mantener; no exponer deps |
| B2 | **Info** | Admin health gated | [`adminRoutes.ts`](../packages/ac-data-backend/src/routes/adminRoutes.js) L88 `adminAuth` + `getAdminHealthHandler` | Correcto | — |
| B3 | **Info** | Zip / HUD path safety | `isUnsafeZipEntryPath` (hubLibraryZipUpload); `resolveSafeHudFilename`; `isSafeBrandingFilename` | Traversal mitigado | Mantener tests; fuzz ocasional |
| B4 | **Bajo** | Bind `0.0.0.0` | Hub [`index.ts`](../packages/ac-data-backend/src/index.ts) L49 | Expone todo el proceso de puertos | Bind privado + reverse proxy TLS |
| B5 | **Info** | Worker auth sólido | [`fleetSecrets.ts`](../packages/ac-data-shared/src/services/secrets/fleetSecrets.ts) L37–42 `secretsMatch`; Control `requireWorker` | Bien diseñado | No reutilizar el mismo secret para Convex y fleet |

---

## 4. Checklist deploy producción

Marcar antes de exponer hub/edge a Internet:

### Secrets y boot

- [ ] `ALLOW_INSECURE_DEFAULTS` **unset o false**
- [ ] `FLEET_EDGE_SECRET` fuerte y **distinto** de `CONVEX_WORKER_SECRET`
- [ ] `MOD_PEER_SECRET` distinto (si peer pull habilitado)
- [ ] `ADMIN_USER` / `ADMIN_PASS` / `ADMIN_JWT_SECRET` fuertes (no placeholders)
- [ ] `HUD_API_KEY` y `CLIENT_SYNC_API_KEY` fuertes
- [ ] Boot guards / `assertSecurityConfiguration` pasan sin warnings de insecure

### Auth / cookies / CORS

- [ ] `ADMIN_COOKIE_SECURE=true` (HTTPS)
- [ ] `HUD_CORS_ORIGIN` = orígenes Host/overlay (no `*`)
- [ ] `CLIENT_LAUNCHER_CORS_ORIGIN` = origen Host (no `*`)
- [ ] `CLIENT_LAUNCHER_REQUIRE_API_KEY=true` (o ASSETTO_ENV prod-like)
- [ ] Host usa header `x-api-key`, no `?api_key=` en URLs compartidas

### Red

- [ ] Redis **no** expuesto a Internet (`ac:hud:registry:*` es crítico)
- [ ] Edges admin **no** públicos; solo hub → edge con worker secret
- [ ] Fleet / HUD registry `baseUrl` solo IPs/hosts controlados por ops
- [ ] Reverse proxy: TLS, body size limits, rate limit global
- [ ] Considerar `AC_DATA_BIND_HOST` privado detrás del proxy

### Uploads / HUD releases

- [ ] Monitorear disco bajo `PROJECTD_HUD_PATH` / content upload dirs
- [ ] Solo admins JWT suben HUD releases; players solo `/client/hud/download` con key

### Post-deploy smoke

- [ ] `GET /v1/...` sin `X-Worker-Secret` → 401
- [ ] `GET /admin/health` sin cookie → 401
- [ ] `GET /client/hud/latest` sin key (si required) → 401/500 config
- [ ] `GET /hud/bootstrap?steamId=...` — documentar si aceptable público o endurecer

---

## 5. Prioridad de fixes — estado (2026-10-23 remediation)

| Prioridad | IDs | Estado |
|-----------|-----|--------|
| **P0** | A3 | **Código:** fatal si `ALLOW_INSECURE_DEFAULTS` + prod. **Ops:** rotar secrets en VPS (checklist §4) |
| **P0** | A2 | **Código:** `outboundBaseUrl` en registry sync + admin proxy/fetch. Allowlist opcional `FLEET_OUTBOUND_BASE_URL_ALLOWLIST` |
| **P1** | A1 | **Código:** hub `/hud/*` + WS exigen `HUD_API_KEY` cuando `HUD_GATEWAY_REQUIRE_API_KEY` (default prod). Rate-limit bootstrap |
| **P1** | A4, A5, A6 | **Código:** cookie Secure default en prod; warn CORS `*`; query `api_key` rechazado en prod |
| **P1** | A7, M3 | **Código:** rate-limit `/v1` (`CONTROL_API_RATE_LIMIT_MAX`). JSON 50mb sin cambiar — cap en proxy |
| **P2** | M1, M2, M4, M5 | **Código:** `secretsMatch` en API keys; body `workerSecret` off en prod; OPTIONS solo `/hud`\|`/client` |

### Nuevas env (hub / shared)

| Variable | Default | Notas |
|----------|---------|--------|
| `HUD_GATEWAY_REQUIRE_API_KEY` | prod → true | Hub bootstrap/snapshot/WS |
| `FLEET_OUTBOUND_ALLOW_PRIVATE` | true | LAN edges |
| `FLEET_OUTBOUND_BASE_URL_ALLOWLIST` | unset | Comma hosts / `*.suffix` |
| `CONTROL_API_RATE_LIMIT_MAX` | 120/min/IP | `/v1` |
| `HUD_BOOTSTRAP_RATE_LIMIT_MAX` | 60/min/IP | |
| `ALLOW_BODY_WORKER_SECRET` | true en dev; false en prod | |
| `ALLOW_API_KEY_QUERY` | true en dev; false en prod | |

---

## 6. Referencias de código útiles

| Tema | Path |
|------|------|
| Hub mount | [`packages/ac-data-backend/src/index.ts`](../packages/ac-data-backend/src/index.ts) |
| Control worker gate | [`packages/ac-data-backend/src/controller/controlApiController.ts`](../packages/ac-data-backend/src/controller/controlApiController.ts) |
| Worker secret read | [`packages/ac-data-shared/src/services/hud/hudWorkerAuth.ts`](../packages/ac-data-shared/src/services/hud/hudWorkerAuth.ts) |
| Timing-safe compare | [`packages/ac-data-shared/src/services/secrets/fleetSecrets.ts`](../packages/ac-data-shared/src/services/secrets/fleetSecrets.ts) |
| Client launcher | [`packages/ac-data-shared/src/middleware/clientLauncherMiddleware.ts`](../packages/ac-data-shared/src/middleware/clientLauncherMiddleware.ts) |
| Edge HUD key | [`packages/ac-data-edge/src/middleware/hudMiddleware.ts`](../packages/ac-data-edge/src/middleware/hudMiddleware.ts) |
| Admin proxy SSRF mitigations | [`packages/ac-data-backend/src/services/fleet/edgeAdminProxy.ts`](../packages/ac-data-backend/src/services/fleet/edgeAdminProxy.ts) |
| Security boot | [`packages/ac-data-shared/src/config/securityStartup.ts`](../packages/ac-data-shared/src/config/securityStartup.ts) |

---

*Informe de revisión estática. Un pentest autenticado contra staging validaría A1/A2 en condiciones reales de red.*
