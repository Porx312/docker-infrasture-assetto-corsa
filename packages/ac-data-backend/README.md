# ac-data-backend

Do **not** run `npm install` only inside this folder. `@projectd/ac-data-shared` is a **local workspace package**, not published on npm.

## Install (Windows / Linux / Mac)

1. Clone or copy the full **assetto-infra** repo (must include root `package.json` and `packages/ac-data-shared`).
2. From the repo root:

```bash
cd path/to/assetto-infra
npm install
npm run build:shared
npm run build:backend
```

3. Create env (see `.env.example`) at repo root as `.env.backend` or set `ASSETTO_ENV_FILE`.

4. Run:

```bash
# Linux/Mac
ASSETTO_ENV_FILE=./.env.backend npm run dev:backend

# PowerShell
$env:ASSETTO_ENV_FILE="$PWD\.env.backend"; npm run dev:backend
```

See [docs/MULTI_REGION_EDGE.md](../../docs/MULTI_REGION_EDGE.md).
