# Shared server branding and Content Manager proxy

Edit [`server-branding.json`](server-branding.json) to change text for all instances:

- `description` → `DESCRIPTION=` in `server_cfg.ini` `[DATA]`
- `webLink` → `WEBLINK=`
- `cmDescription` → Content Manager panel via CM proxy
- `loadingImageUrl` / `bannerImageUrl` → portada (CM loading screen)
- `logoImageUrl` → reservado (no usar en `cmDescription`; CM duplicaba `[img=...]`)
- `cmDescriptionBody` → texto bajo la portada (Discord, web, reglas)
- `bannerImageUrl` → portada arriba del texto en CM (`[img=url]ProjectD[/img]` + cuerpo)

Apply changes:

```bash
./scripts/set-server-description.sh
./scripts/generate-cm-wrapper-params.sh
./scripts/apply-cm-name-suffix.sh
./scripts/stop-cm-proxies.sh && ./scripts/start-cm-proxies.sh
```

Restart affected `acServer` processes so lobby registration picks up the new `NAME` suffix (`ℹ` + wrapper port).

CM proxy ports: `HTTP_PORT + 10000` (e.g. 8081 → 18081). Open TCP 18081–18100 on the firewall if players use Content Manager from outside the VPS.
