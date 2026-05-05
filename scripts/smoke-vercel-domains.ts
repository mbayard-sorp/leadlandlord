#!/usr/bin/env -S tsx
/**
 * Phase C smoke test for the Vercel Domains API wrapper.
 *
 * Steps (read-only — no side effects on Vercel):
 *  1. Find the leadlandlord-operator project to confirm VERCEL_TOKEN auth works.
 *  2. Call getDomainStatus on a deliberately-nonexistent host — expect a
 *     structured 404 IntegrationError. Anything else means the wrapper or
 *     URL building is wrong.
 *
 * Usage:  pnpm tsx scripts/smoke-vercel-domains.ts
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

import { findProjectByName, getDomainStatus } from '@leadlandlord/integrations/vercel';
import { IntegrationError } from '@leadlandlord/shared/errors';

async function main() {
  console.log('[smoke] step 1: find leadlandlord-operator project');
  const project = await findProjectByName('leadlandlord-operator');
  if (!project) {
    console.error('[smoke] FAIL — leadlandlord-operator project not found. Check VERCEL_TOKEN scope.');
    process.exit(1);
  }
  console.log(`[smoke] OK — project id=${project.id} name=${project.name}`);

  console.log('[smoke] step 2: getDomainStatus against a nonexistent host (expect 404)');
  const fakeHost = `phase-c-smoke-${Date.now()}.example.com`;
  try {
    const status = await getDomainStatus(project.id, fakeHost);
    console.error('[smoke] FAIL — expected 404 but got', status);
    process.exit(1);
  } catch (err) {
    if (err instanceof IntegrationError && err.status === 404) {
      console.log(`[smoke] OK — Vercel returned 404 for ${fakeHost} (wrapper + auth + zod all good)`);
    } else {
      console.error('[smoke] FAIL — unexpected error shape:', err);
      process.exit(1);
    }
  }

  console.log('[smoke] all checks passed.');
}

main().catch((err) => {
  console.error('[smoke] fatal:', err);
  process.exit(1);
});
