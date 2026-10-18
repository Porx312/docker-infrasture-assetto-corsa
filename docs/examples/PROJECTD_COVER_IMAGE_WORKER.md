# ProjectD: hub covers → Convex `coverImageId` (public URL)

Paste into the Host/Convex repo. Hub side: `assetto-infra` `hostCatalog/coverUpload.ts` + sync upsert.

## What hub does

1. Admin uploads a mod preview → hub stores under `mod-previews/` → public `https://<hub>/mods/images/<file>`.
2. On catalog upsert / preview change, hub sends that URL as `coverImageId` on `workerUpsertBattleCar` / `workerUpsertBattleTrack` (field is a plain `string`).
3. If there is no preview, hub **omits** `coverImageId` — Host UI uses a placeholder.

No Convex Storage upload. No `workerGenerateUploadUrl`.

## Host UI (required)

Wherever you resolve a car/track cover:

```ts
const src = coverImageId?.startsWith("http")
  ? coverImageId
  : coverImageId
    ? await ctx.storage.getUrl(coverImageId) // legacy `_storage` ids only
    : null;
// null → placeholder image in UI
```

Store the hub URL string on `battle_cars` / `battle_tracks.coverImageId` as today (already `v.optional(v.string())`).

## Env (hub)

| Variable | Notes |
|----------|--------|
| `CONVEX_HOST_CATALOG_COVER_SYNC` | Default on; `false` skips sending the preview URL |
| `HUD_PUBLIC_BASE_URL` (or `PUBLIC_API_BASE_URL` / `MOD_HUB_PUBLIC_URL`) | Required to build `/mods/images/…` URLs |

See [HOST_CATALOG_SYNC.md](../HOST_CATALOG_SYNC.md).
