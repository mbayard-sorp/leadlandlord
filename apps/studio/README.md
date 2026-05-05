# @leadlandlord/studio

Sanity Studio for LeadLandlord. Schemas live in `packages/sanity-schema/`; this app only wires them into the Studio shell + provides Studio-specific config.

## Workspaces

- **production** — `/production` — live tenant content. The site-host Vercel project reads from this dataset.
- **development** — `/development` — local dev + agent runs against fake niches/cities.

## Local dev

```sh
pnpm --filter @leadlandlord/studio dev
```

Opens on `http://localhost:3333` by default.

## Deploy

Studio is hosted by Sanity at `https://leadlandlord.sanity.studio`. Deploy with:

```sh
pnpm --filter @leadlandlord/studio deploy
```

The first deploy will prompt to claim the `leadlandlord` studio host. The `studioHost: 'leadlandlord'` field in `sanity.cli.ts` locks this in for subsequent deploys.

## Env

The Studio reads `SANITY_STUDIO_PROJECT_ID` (defaults to `ybdv5za2`). Operators editing content authenticate via Sanity's hosted login — no token required client-side.
