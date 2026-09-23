# ac-data (split packages)

Node control plane lives under `packages/`:

| Package | Path |
|---------|------|
| Edge (VPS) | [`packages/ac-data-edge`](../packages/ac-data-edge) |
| Backend (hub) | [`packages/ac-data-backend`](../packages/ac-data-backend) |
| Shared | [`packages/ac-data-shared`](../packages/ac-data-shared) |

```bash
npm install          # repo root
npm run build
npm run dev:edge     # spawn + HUD + telemetry bridge
npm run dev:backend  # ingest + gateway + admin
```

Architecture and fleet setup: [`MULTI_REGION_EDGE.md`](MULTI_REGION_EDGE.md).

Public HTTPS for the **hub** is handled by your deploy platform (e.g. Dokploy), not on the game VPS.
