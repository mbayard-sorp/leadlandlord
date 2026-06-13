/**
 * LeadLandlord — apply database migrations as part of the Vercel build.
 *
 * Migrations in this repo are hand-written and idempotent, but applying them was
 * a manual `pnpm db:migrate` step with no pipeline hook — so the deployed Neon DB
 * repeatedly drifted behind the code (e.g. migration 0042 `story_scaffold` shipped
 * in code but never ran, 500-ing /operator/content). This wires the catch-up into
 * the operator app's production build via its `vercel-build` script.
 *
 * Guards:
 *   - PRODUCTION ONLY. Runs only when VERCEL_ENV === 'production'. Preview branch
 *     builds share the production DATABASE_URL, so they must NOT mutate schema —
 *     and local `next build` (VERCEL_ENV unset) must not either.
 *   - No DATABASE_URL → skip (don't fail the build on a misconfigured env).
 *
 * Drizzle's neon-http migrator records applied migrations in `__drizzle_migrations`
 * and only runs the missing ones, so re-running every deploy is safe and cheap.
 * If a migration fails the build fails — by design, so we never ship code that
 * expects a schema that didn't apply.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const vercelEnv = process.env.VERCEL_ENV;
if (vercelEnv !== 'production') {
  console.log(
    `[migrate-on-deploy] Skipping migrations (VERCEL_ENV=${vercelEnv ?? 'unset'}; production-only).`,
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.log('[migrate-on-deploy] No DATABASE_URL set; skipping migrations.');
  process.exit(0);
}

console.log('[migrate-on-deploy] Production deploy — applying pending database migrations…');
const result = spawnSync('pnpm', ['--filter', '@leadlandlord/db', 'migrate'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error('[migrate-on-deploy] Failed to spawn migrate:', result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
