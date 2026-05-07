#!/usr/bin/env -S tsx
/**
 * One-shot: attach leadslandlord.com (apex + www) to the leadlandlord-sites
 * Vercel project, then print the DNS records you need to add at the registrar.
 *
 * Idempotent — re-running on an already-attached host is a no-op (Vercel
 * returns 409 which we surface as a warning, not a failure).
 *
 * Usage:
 *   pnpm tsx scripts/attach-leadslandlord-domain.ts
 *   pnpm tsx scripts/attach-leadslandlord-domain.ts --host leadslandlord.com  # apex only
 *   pnpm tsx scripts/attach-leadslandlord-domain.ts --status                  # just print current status
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

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
const envFile = findEnvFile(__dirname, '.env');
if (envFile) loadEnv({ path: envFile, override: true });

import {
  attachDomain,
  getDomainConfig,
  getDomainStatus,
} from '@leadlandlord/integrations/vercel/domains';

const DEFAULT_HOSTS = ['leadslandlord.com', 'www.leadslandlord.com'];

async function processHost(projectId: string, host: string, statusOnly: boolean) {
  console.log(`\n=== ${host} ===`);
  if (!statusOnly) {
    try {
      const attached = await attachDomain(projectId, host);
      console.log(
        `[attach] ok — verified=${attached.verified} verification=${JSON.stringify(attached.verification)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('domain_already_in_use') || msg.includes('409')) {
        console.warn(`[attach] already attached — continuing with status check`);
      } else {
        throw err;
      }
    }
  }
  const status = await getDomainStatus(projectId, host);
  console.log(`[status] verified=${status.verified}`);
  if (!status.verified && status.verification.length > 0) {
    console.log(`[status] verification challenges:`);
    for (const v of status.verification) {
      console.log(`  - type=${v.type} domain=${v.domain} value=${v.value}${v.reason ? ` reason=${v.reason}` : ''}`);
    }
  }
  const config = await getDomainConfig(projectId, host);
  console.log(`[dns] misconfigured=${config.misconfigured} configuredBy=${config.configuredBy ?? 'unset'}`);
  if (config.cnames?.length) console.log(`[dns] CNAME → ${config.cnames.join(', ')}`);
  if (config.aValues?.length) console.log(`[dns] A → ${config.aValues.join(', ')}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      host: { type: 'string' },
      status: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  if (!projectId) {
    throw new Error('VERCEL_SITES_PROJECT_ID is not set');
  }
  const hosts = values.host ? [values.host] : DEFAULT_HOSTS;
  for (const host of hosts) {
    await processHost(projectId, host, values.status === true);
  }
  console.log(`\n[done] add the records above at the registrar — domain-verifier cron picks up the verification automatically.`);
}

main().catch((err) => {
  console.error('[attach] error:', err);
  process.exit(1);
});
