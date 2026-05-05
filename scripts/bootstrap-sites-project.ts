#!/usr/bin/env -S tsx
/**
 * Phase D-1: Bootstrap the multi-tenant `leadlandlord-sites` Vercel project.
 *
 * Steps:
 *  1. Create (or find) the leadlandlord-sites project via REST.
 *  2. Set rootDirectory + framework via PATCH.
 *  3. Push the env vars site-host needs (DATABASE_URL, OPERATOR_PUBLIC_URL,
 *     SANITY_*, NEXT_PUBLIC_SANITY_*).
 *  4. Print the project ID — operator stores it as VERCEL_SITES_PROJECT_ID.
 *
 * Idempotent — safe to re-run.
 *
 * Usage:  pnpm tsx scripts/bootstrap-sites-project.ts
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function findEnvFile(start: string, name: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
const envLocal = findEnvFile(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });

import { createProject, setEnvVars, vercelFetch } from '@leadlandlord/integrations/vercel';

const PROJECT_NAME = 'leadlandlord-sites';
const ROOT_DIR = 'apps/site-host';

async function main() {
  console.log(`[bootstrap] step 1: create-or-find project ${PROJECT_NAME}`);
  const project = await createProject({ name: PROJECT_NAME, framework: 'nextjs' });
  console.log(`[bootstrap] OK — project id=${project.id}`);

  console.log(`[bootstrap] step 2: PATCH rootDirectory=${ROOT_DIR}`);
  await vercelFetch(`/v9/projects/${project.id}`, {
    method: 'PATCH',
    body: {
      rootDirectory: ROOT_DIR,
      framework: 'nextjs',
      // Monorepo: Vercel auto-detects the workspace package, but we set the
      // build/install commands explicitly so it picks up the pnpm workspace.
      installCommand: 'pnpm install --frozen-lockfile',
      buildCommand: 'pnpm --filter @leadlandlord/site-host build',
    },
  });
  console.log('[bootstrap] OK');

  console.log('[bootstrap] step 3: push env vars (production + preview + development)');
  const envs: Record<string, string | undefined> = {
    DATABASE_URL: process.env.DATABASE_URL,
    OPERATOR_PUBLIC_URL: 'https://leadlandlord-operator.vercel.app',
    SANITY_PROJECT_ID: process.env.SANITY_PROJECT_ID,
    SANITY_DATASET: 'development', // Phase D smoke uses development dataset
    SANITY_API_TOKEN: process.env.SANITY_API_TOKEN,
    SANITY_REVALIDATE_SECRET: process.env.SANITY_REVALIDATE_SECRET,
    NEXT_PUBLIC_SANITY_PROJECT_ID: process.env.SANITY_PROJECT_ID,
    NEXT_PUBLIC_SANITY_DATASET: 'development',
  };
  const filtered = Object.fromEntries(
    Object.entries(envs).filter(([, v]) => typeof v === 'string' && v.length > 0),
  ) as Record<string, string>;
  const skipped = Object.entries(envs).filter(([, v]) => !v).map(([k]) => k);
  if (skipped.length > 0) {
    console.warn(`[bootstrap] WARN — these env vars are missing locally and won't be pushed: ${skipped.join(', ')}`);
  }
  await setEnvVars(project.id, filtered);
  console.log(`[bootstrap] OK — pushed ${Object.keys(filtered).length} env vars`);

  console.log('');
  console.log('[bootstrap] DONE.');
  console.log('');
  console.log(`  VERCEL_SITES_PROJECT_ID=${project.id}`);
  console.log('');
  console.log('  → add this to .env.local AND set it on the operator project in Vercel.');
}

main().catch((err) => {
  console.error('[bootstrap] fatal:', err);
  process.exit(1);
});
