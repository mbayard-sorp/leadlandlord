#!/usr/bin/env -S tsx
/**
 * Phase G cutover: attach tree-removal-tucson.vercel.app to leadlandlord-sites
 * + record the domain in the Sanity site doc.
 *
 * Effectively the same code path as the operator dashboard's DomainAttachForm,
 * just driven from CLI. Idempotent — safe to re-run.
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

import { attachDomain, getDomainConfig } from '@leadlandlord/integrations/vercel';
import { createWriteClient, siteDocId } from '@leadlandlord/integrations/sanity';

const SITE_ID = '18201bed-d6d8-4fd3-a22a-85dfc0ea86fa';
const HOST = 'tree-removal-tucson.vercel.app';

function hostKey(host: string): string {
  return host.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().slice(0, 63);
}

async function main() {
  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  if (!projectId) throw new Error('VERCEL_SITES_PROJECT_ID not set');

  console.log(`[cutover] step 1: attach ${HOST} to project ${projectId}`);
  const attached = await attachDomain(projectId, HOST);
  console.log(`[cutover] OK — verified=${attached.verified}`);

  console.log(`[cutover] step 2: fetch DNS config (just for visibility)`);
  try {
    const cfg = await getDomainConfig(projectId, HOST);
    console.log(`[cutover] config — misconfigured=${cfg.misconfigured} aValues=${JSON.stringify(cfg.aValues)} cnames=${JSON.stringify(cfg.cnames)}`);
  } catch (err) {
    console.log(`[cutover] config fetch skipped (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  console.log(`[cutover] step 3: record the domain in the Sanity site doc as primary`);
  const sanity = createWriteClient();
  const current = await sanity.fetch<Array<{ host: string; isPrimary?: boolean; verified?: boolean; attachedAt?: string }> | null>(
    `*[_id==$id][0].domains`,
    { id: siteDocId(SITE_ID) },
  );
  const filtered = (current ?? []).filter((d) => d.host !== HOST);
  const newEntry = {
    _key: hostKey(HOST),
    _type: 'siteDomain' as const,
    host: HOST,
    isPrimary: true,
    verified: attached.verified,
    attachedAt: new Date().toISOString(),
  };
  const next = [
    newEntry,
    ...filtered.map((d) => ({ ...d, _key: hostKey(d.host), _type: 'siteDomain' as const, isPrimary: false })),
  ];
  await sanity.patch(siteDocId(SITE_ID)).set({ domains: next }).commit({ visibility: 'sync' });
  console.log(`[cutover] OK — site doc now has ${next.length} domain(s), primary=${HOST}`);

  console.log('');
  console.log(`[cutover] DONE. Try: https://${HOST}`);
}

main().catch((err) => {
  console.error('[cutover] failed:', err);
  process.exit(1);
});
