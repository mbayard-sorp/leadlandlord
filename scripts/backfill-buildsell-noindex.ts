#!/usr/bin/env -S tsx
/**
 * LeadLandlord — one-time fix: un-noindex SOLD BuildSell sites.
 *
 * Why this exists: the customer-portal Publish flow was broken (publishSite
 * patched the draft without ensuring it existed), so the only levers that clear
 * `robotsDisallow` on a published BuildSell doc — customer Publish and operator
 * markPaid — never completed for many sites. The result: every sold site was
 * stuck `robotsDisallow:true` (noindex) and invisible to Google. The code bug is
 * fixed separately; this script repairs the already-damaged published docs.
 *
 * Scope: ONLY sites with Postgres status `paid` or `live` (i.e. sold). Warming /
 * unsold / draft sites are intentionally left noindexed. For each, if the
 * published Sanity doc still has `robotsDisallow:true` or `draftMode:true`, this
 * clears both (mirroring markPaid). Strictly a flag flip — no content is touched.
 *
 * Idempotent: a site already indexable is reported and skipped, never re-written.
 *
 * Safe by default: prints what it WOULD do and exits WITHOUT writing. Pass
 * --execute to actually patch Sanity.
 *
 * Usage:
 *   pnpm backfill-buildsell-noindex                  # dry run — report only
 *   pnpm backfill-buildsell-noindex --execute        # clear robotsDisallow/draftMode
 *   pnpm backfill-buildsell-noindex --site-id <uuid> # restrict to one site
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

// eslint-disable-next-line import/order
import { and, eq, inArray, asc } from 'drizzle-orm';
// eslint-disable-next-line import/order
import { getDb, buildsellSites } from '@leadlandlord/db';
// eslint-disable-next-line import/order
import { createWriteClient } from '@leadlandlord/sanity-schema/client';
// eslint-disable-next-line import/order
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';

// Sold sites only. Warming/unsold/draft stay noindexed on purpose.
const TARGET_STATUSES = ['paid', 'live'] as const;

interface Row {
  id: string;
  businessName: string | null;
  slug: string | null;
  status: string;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean', default: false },
      'site-id': { type: 'string' },
    },
  });
  const execute = values.execute === true;
  const siteIdFilter = values['site-id'] ?? null;

  const db = getDb();
  const conds = [inArray(buildsellSites.status, TARGET_STATUSES as unknown as string[])];
  if (siteIdFilter) conds.push(eq(buildsellSites.id, siteIdFilter));
  const rows = (await db
    .select({
      id: buildsellSites.id,
      businessName: buildsellSites.businessName,
      slug: buildsellSites.slug,
      status: buildsellSites.status,
    })
    .from(buildsellSites)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .orderBy(asc(buildsellSites.createdAt))) as Row[];

  console.log(
    `\nBuildSell noindex backfill — ${rows.length} sold site(s) in {${TARGET_STATUSES.join(', ')}}` +
      `${siteIdFilter ? ` filtered to ${siteIdFilter}` : ''}`,
  );
  console.log(`Mode: ${execute ? 'EXECUTE (patching Sanity)' : 'DRY RUN (no writes)'}\n`);

  const sanity = createWriteClient();
  let cleared = 0;
  let alreadyOk = 0;
  let missingDoc = 0;

  for (const r of rows) {
    const docId = buildsellSiteDocId(r.id);
    // eslint-disable-next-line no-await-in-loop
    const doc = (await sanity.getDocument(docId)) as
      | { robotsDisallow?: boolean; draftMode?: boolean }
      | undefined;
    const label = `  ${r.id}  ${r.businessName ?? '(no name)'}  ${r.slug ? `/buildsell/${r.slug}` : ''} [${r.status}]`;

    if (!doc) {
      missingDoc += 1;
      console.log(`${label}  · no published Sanity doc — skipped`);
      continue;
    }

    const needs = doc.robotsDisallow === true || doc.draftMode === true;
    if (!needs) {
      alreadyOk += 1;
      console.log(`${label}  · already indexable`);
      continue;
    }

    if (execute) {
      // eslint-disable-next-line no-await-in-loop
      await sanity
        .patch(docId)
        .set({ robotsDisallow: false, draftMode: false })
        .commit({ visibility: 'sync' });
      cleared += 1;
      console.log(`${label}  · CLEARED (robotsDisallow→false, draftMode→false)`);
    } else {
      cleared += 1;
      console.log(`${label}  · WOULD CLEAR (robotsDisallow:${doc.robotsDisallow} draftMode:${doc.draftMode})`);
    }
  }

  const line = '─'.repeat(72);
  console.log(`\n${line}\n  Summary (${execute ? 'EXECUTE' : 'DRY RUN'})\n${line}`);
  console.log(`  sold sites scanned        : ${rows.length}`);
  console.log(`  ${execute ? 'cleared' : 'would clear'}               : ${cleared}`);
  console.log(`  already indexable         : ${alreadyOk}`);
  console.log(`  no published Sanity doc   : ${missingDoc}`);
  console.log(line);

  if (!execute) {
    console.log(`\nDry run only — ZERO writes made. Re-run with --execute to patch Sanity.\n`);
  }
}

main().catch((err) => {
  console.error('backfill-buildsell-noindex failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
