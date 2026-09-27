# SGSITS Campus Access

Fresh accessibility-aware campus map with a public map and a protected editor. The repository is a pnpm workspace with `apps/web`, `apps/api`, and shared typed contracts.

## Local configuration

Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env.local`. Do not commit either file. Local API development needs the **resolved public Railway PostgreSQL TCP URL** as `DATABASE_URL`; `${{Postgres.DATABASE_URL}}` works only inside Railway. Use a new database dedicated to this application. Local edits and uploaded evidence persist in those live services, so automated write tests must use a disposable database and a Cloudinary mock or isolated account.

## Commands

```powershell
pnpm install
pnpm --filter @campus-access/api migrate
pnpm --filter @campus-access/api import:osm
pnpm --filter @campus-access/api dev
```

In a second terminal:

```powershell
pnpm --filter @campus-access/web dev
```

Run all local checks with `pnpm qa`. Migrations are additive and the OSM importer performs stable-ID upserts; neither command truncates tables.

## Deployment

- Railway API: repository root; build `pnpm install --frozen-lockfile && pnpm --filter @campus-access/api build`; start `pnpm --filter @campus-access/api start`. Run migrate and import as explicit safe deploy steps. Set `DATABASE_URL` to the new PostgreSQL service's internal variable reference and set editor, Cloudinary, and exact `WEB_ORIGIN` values. Do not set `PORT`.
- Vercel web: root directory `apps/web`, Vite, install `pnpm install --frozen-lockfile`, build `pnpm build`, output `dist`. Set only `VITE_API_URL` to the Railway HTTPS origin.
- Cloudinary: credentials belong only in the API environment. Visitor evidence is uploaded as authenticated media and is viewed through short-lived signed URLs.

The bundled `apps/api/data/campus.osm` is copied from the read-only reference project and is the production campus geometry source.
