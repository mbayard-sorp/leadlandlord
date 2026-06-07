#!/usr/bin/env -S tsx
/**
 * LeadLandlord — Logo backfill for existing sites.
 *
 * Generates a flat-icon logo mark via Imagen for every live site that does not
 * yet have a Sanity logo asset, then patches the Sanity site doc and emits a
 * re-crawl event. All writes are additive and idempotent:
 *
 *   - Checks logo.asset._ref directly on the Sanity site doc (source of
 *     truth — not bundle.logo_url which can lag a recent patch).
 *   - Skips with status 'logo:already-set' when the asset ref is present.
 *   - Skips with status 'no-doc' when no Sanity site doc exists.
 *
 * Safe by default: prints what it WOULD do and exits WITHOUT writing. Pass
 * --execute to actually generate + patch + enqueue re-crawl events. Image
 * generation costs ~$0.02-0.04 each; set MOCK_AI=true to skip generation
 * while still seeing the dry-run report.
 *
 * Usage:
 *   pnpm backfill-logos                              # dry run — report only
 *   pnpm backfill-logos --execute                    # generate + patch + enqueue
 *   pnpm backfill-logos --site-id <uuid>             # one site
 *   pnpm backfill-logos --execute --batch-size 10 --delay-ms 3000
 *   MOCK_AI=true pnpm backfill-logos --execute       # skip image gen
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
import { getDb, sites, agentEvents } from '@leadlandlord/db';
// eslint-disable-next-line import/order
import { createWriteClient, siteDocId } from '@leadlandlord/integrations/sanity';
// eslint-disable-next-line import/order
import { uploadHeroImage } from '@leadlandlord/integrations/sanity';
// eslint-disable-next-line import/order
import { generateHeroImageBuffer } from '@leadlandlord/integrations/imagen';
// eslint-disable-next-line import/order
import { log } from '@leadlandlord/shared/log';
// eslint-disable-next-line import/order
import { logoPrompt } from '../packages/agents/src/site-builder/logo-prompt';

const TARGET_STATUSES = ['warming', 'live', 'rented'] as const;

interface SiteRow {
  id: string;
  domain: string | null;
  niche: string;
  city: string;
  state: string;
  status: string;
  createdAt: Date;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type LogoOutcomeStatus =
  | 'logo:already-set'
  | 'no-doc'
  | 'logo:would-gen'
  | 'logo:generated'
  | 'logo:mock-skipped'
  | 'logo:no-buffer'
  | 'logo:failed';

interface SiteOutcome {
  siteId: string;
  domain: string | null;
  status: LogoOutcomeStatus;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean', default: false },
      'site-id': { type: 'string' },
      'batch-size': { type: 'string', default: '20' },
      'delay-ms': { type: 'string', default: '2000' },
    },
  });

  const execute = values.execute === true;
  const batchSize = Math.max(1, Number.parseInt(values['batch-size'] ?? '20', 10));
  const delayMs = Math.max(0, Number.parseInt(values['delay-ms'] ?? '2000', 10));
  const siteIdFilter = values['site-id'] ?? null;
  const mockAi = process.env.MOCK_AI === 'true';
  const dateStamp = new Date().toISOString().slice(0, 10);

  const db = getDb();
  const conds = [inArray(sites.status, TARGET_STATUSES as unknown as string[])];
  if (siteIdFilter) conds.push(eq(sites.id, siteIdFilter));
  const rows = (await db
    .select({
      id: sites.id,
      domain: sites.domain,
      niche: sites.niche,
      city: sites.city,
      state: sites.state,
      status: sites.status,
      createdAt: sites.createdAt,
    })
    .from(sites)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .orderBy(asc(sites.createdAt))) as SiteRow[];

  console.log(
    `\nLogo backfill — ${rows.length} site(s) in {${TARGET_STATUSES.join(', ')}}` +
      `${siteIdFilter ? ` filtered to ${siteIdFilter}` : ''}`,
  );
  console.log(`Mode: ${execute ? 'EXECUTE (patching Sanity + enqueueing re-crawl)' : 'DRY RUN (no writes)'}`);
  console.log(`Image gen: ${mockAi ? 'MOCK_AI — images skipped' : execute ? 'enabled' : 'reported only (dry run)'}\n`);

  const sanity = createWriteClient();
  const outcomes: SiteOutcome[] = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    for (const r of batch) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await processSite(r, { execute, mockAi, sanity, db, dateStamp });
      outcomes.push(outcome);
      printSiteLine(outcome, r);
    }
    if (i + batchSize < rows.length && delayMs > 0) {
      log.info({ done: Math.min(i + batchSize, rows.length), total: rows.length }, 'backfill batch processed');
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }
  }

  printSummary(outcomes, execute);

  if (!execute) {
    console.log(`\nDry run only — ZERO writes made. Re-run with --execute to generate + patch + enqueue re-crawl events.\n`);
  }
}

async function processSite(
  r: SiteRow,
  ctx: {
    execute: boolean;
    mockAi: boolean;
    sanity: ReturnType<typeof createWriteClient>;
    db: ReturnType<typeof getDb>;
    dateStamp: string;
  },
): Promise<SiteOutcome> {
  const { execute, mockAi, sanity, db, dateStamp } = ctx;

  const docId = siteDocId(r.id);

  // --- Read current state from Sanity (source of truth; safe in dry run) ---
  const siteDoc = (await sanity.getDocument(docId)) as
    | { logo?: { asset?: { _ref?: string } } }
    | undefined;

  if (!siteDoc) {
    return { siteId: r.id, domain: r.domain, status: 'no-doc' };
  }

  // Check logo.asset._ref directly — do NOT rely on bundle.logo_url which can
  // lag a recent patch.
  if (siteDoc.logo?.asset?._ref) {
    return { siteId: r.id, domain: r.domain, status: 'logo:already-set' };
  }

  // Dry run — report only, no writes.
  if (!execute) {
    return { siteId: r.id, domain: r.domain, status: 'logo:would-gen' };
  }

  // MOCK_AI — skip generation entirely, no-op.
  if (mockAi) {
    return { siteId: r.id, domain: r.domain, status: 'logo:mock-skipped' };
  }

  // --- EXECUTE: generate + upload + patch ---
  try {
    const { prompt, negativePrompt } = logoPrompt({
      niche: r.niche,
      businessName: r.domain ?? r.niche,
      city: r.city,
    });

    const img = await generateHeroImageBuffer(prompt, {
      aspectRatio: '1:1',
      negativePrompt,
      // Logos are flat symbolic marks — skip the hero-photo enrichment, which
      // would force "Photorealistic… no text or logos in image".
      enrich: false,
    });

    if (!img) {
      // No provider key or generation returned nothing — soft skip.
      return { siteId: r.id, domain: r.domain, status: 'logo:no-buffer' };
    }

    const filename = `logo-${r.id}.jpg`;
    const uploaded = await uploadHeroImage(r.id, img.buffer, filename, img.contentType);

    await sanity
      .patch(docId)
      .set({
        logo: {
          _type: 'image',
          asset: { _type: 'reference', _ref: uploaded.assetId },
        },
      })
      .commit({ visibility: 'async' });

    log.info(
      { siteId: r.id, assetId: uploaded.assetId, size: uploaded.size, model: img.model, provider: img.provider },
      'logo uploaded and patched',
    );

    // Re-crawl ping — same shape as backfill-structured-data.
    await db.insert(agentEvents).values({
      agent: 'backfill-logos',
      type: 'site.content.updated',
      targetAgent: 'indexnow-submitter',
      payload: { site_id: r.id, dedupeKey: `indexnow:logo:${r.id}:${dateStamp}` },
    });

    return { siteId: r.id, domain: r.domain, status: 'logo:generated' };
  } catch (err) {
    log.warn(
      { siteId: r.id, err: err instanceof Error ? err.message : String(err) },
      'logo backfill failed — skipping site',
    );
    return { siteId: r.id, domain: r.domain, status: 'logo:failed' };
  }
}

function printSiteLine(o: SiteOutcome, r: SiteRow): void {
  console.log(
    `  ${r.id}  ${o.domain ?? '(no domain)'}  · ${r.niche} ${r.city}, ${r.state}  [${o.status}]`,
  );
}

function printSummary(outcomes: SiteOutcome[], execute: boolean): void {
  const total = outcomes.length;
  const alreadySet = outcomes.filter((o) => o.status === 'logo:already-set').length;
  const noDocs = outcomes.filter((o) => o.status === 'no-doc').length;
  const wouldGen = outcomes.filter((o) => o.status === 'logo:would-gen').length;
  const generated = outcomes.filter((o) => o.status === 'logo:generated').length;
  const mockSkipped = outcomes.filter((o) => o.status === 'logo:mock-skipped').length;
  const noBuffer = outcomes.filter((o) => o.status === 'logo:no-buffer').length;
  const failed = outcomes.filter((o) => o.status === 'logo:failed').length;

  const line = '─'.repeat(72);
  console.log(`\n${line}\n  Summary (${execute ? 'EXECUTE' : 'DRY RUN'})\n${line}`);
  console.log(`  sites scanned               : ${total}`);
  console.log(`  logo already set (skipped)  : ${alreadySet}`);
  console.log(`  no Sanity doc (skipped)     : ${noDocs}`);
  if (!execute) {
    console.log(`  logo would generate         : ${wouldGen}`);
  } else {
    console.log(`  logos generated + patched   : ${generated}`);
    if (mockSkipped) console.log(`  skipped (MOCK_AI)           : ${mockSkipped}`);
    if (noBuffer) console.log(`  skipped (no buffer/key)     : ${noBuffer}`);
    if (failed) console.log(`  FAILED                      : ${failed}`);
  }
  console.log(line);
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? err.message : err, stack: err instanceof Error ? err.stack : undefined },
    'backfill-logos failed',
  );
  process.exit(1);
});
