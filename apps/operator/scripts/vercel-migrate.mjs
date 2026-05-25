// Runs pending Drizzle migrations during the Vercel build, but only for
// production deploys. This keeps schema changes from shipping ahead of the code
// that depends on them — the failure mode that took /operator/calls down when
// migration 0032 (caller_name) was deployed but never applied to the prod DB.
//
// Gated on VERCEL_ENV so preview/dev builds never mutate the production
// database. A migration failure aborts the build by design: better to block a
// deploy than to ship code that queries columns the DB doesn't have.
import { spawnSync } from 'node:child_process';

const env = process.env.VERCEL_ENV;

if (env !== 'production') {
  console.log(
    `[vercel-migrate] VERCEL_ENV=${env ?? '(unset)'} — skipping DB migrations (production deploys only).`,
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error(
    '[vercel-migrate] Production deploy but DATABASE_URL is not set — cannot run migrations.',
  );
  process.exit(1);
}

console.log('[vercel-migrate] Production deploy — applying pending DB migrations…');

const result = spawnSync('pnpm', ['--filter', '@leadlandlord/db', 'migrate'], {
  stdio: 'inherit',
});

if (result.error) {
  console.error('[vercel-migrate] Failed to launch migration step:', result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error('[vercel-migrate] Migration step failed — aborting build.');
  process.exit(result.status ?? 1);
}

console.log('[vercel-migrate] Migrations applied.');
