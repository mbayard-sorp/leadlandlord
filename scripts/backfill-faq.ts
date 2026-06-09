#!/usr/bin/env -S tsx
/**
 * LeadLandlord — targeted FAQ-pages backfill for existing sites.
 *
 * Sites built before the standalone `faq` page kind shipped have no FAQ pages.
 * This script generates a small set of locally-specific FAQ pages per site and
 * patches them on IN PLACE. It is strictly additive and patch-only:
 *   - NEVER rebuilds a site; NEVER touches home/services/blog/info pages, mdx,
 *     titles, jsonLd, or any other site-doc field.
 *   - Only writes the faq page docs (page-${siteId}-faq-N) and sets the site
 *     doc's `faqPages` reference array (see persist-sanity::patchFaqPagesInSanity).
 *   - Skips sites that already have FAQ pages unless --overwrite is passed.
 * After a site is patched it emits the same re-crawl event backfill-indexnow /
 * backfill-structured-data use (→ indexnow-submitter) so engines re-crawl.
 *
 * Safe by default: prints which sites are ELIGIBLE and exits WITHOUT calling the
 * LLM or writing anything. Generation costs ~$0.01–0.03 per site; only --execute
 * spends. Set MOCK_AI=true with --execute to exercise the write path for free.
 *
 * Migrations/writes are manual in this repo — invoke by hand and watch the
 * summary. Target the dataset via SANITY_DATASET (defaults to env / production).
 *
 * Usage:
 *   pnpm backfill-faq                                  # dry run — eligibility report
 *   pnpm backfill-faq --execute                        # generate + patch + enqueue re-crawl
 *   pnpm backfill-faq --site-id <uuid> --execute       # one site
 *   pnpm backfill-faq --count 6 --execute              # 6 FAQ pages per site (1–8)
 *   pnpm backfill-faq --overwrite --execute            # regenerate even if FAQ pages exist
 *   pnpm backfill-faq --since 2026-06-08 --execute     # only sites created before this date
 *   SANITY_DATASET=development MOCK_AI=true pnpm backfill-faq --site-id <uuid> --execute
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
import { and, eq, lt, inArray, asc } from 'drizzle-orm';
// eslint-disable-next-line import/order
import { getDb, sites, agentEvents } from '@leadlandlord/db';
// eslint-disable-next-line import/order
import { createWriteClient, siteDocId } from '@leadlandlord/integrations/sanity';
// eslint-disable-next-line import/order
import { generateFaqPages } from '@leadlandlord/agents/content-engine';
// eslint-disable-next-line import/order
import { patchFaqPagesInSanity } from '@leadlandlord/agents/site-builder';
// eslint-disable-next-line import/order
import { log } from '@leadlandlord/shared/log';

// "live-ish" statuses worth FAQ pages + a re-crawl ping. Mirrors the other
// backfills: warming (indexable soon), live, and rented.
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

/** Content context read from the Sanity site doc. */
interface SiteContent {
  businessName?: string | null;
  niche?: string | null;
  city?: string | null;
  state?: string | null;
  theme?: string | null;
  faqCount?: number | null;
  faqTitles?: string[] | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type SkipReason = 'no-sanity-doc' | 'already-has-faq';

interface SiteOutcome {
  siteId: string;
  domain: string | null;
  skipped: SkipReason | null;
  existingFaq: number;
  generated: number;
  wouldGenerate: number;
  costUsd: number;
  patched: boolean;
  eventEmitted: boolean;
  error: string | null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean', default: false },
      overwrite: { type: 'boolean', default: false },
      since: { type: 'string' },
      'site-id': { type: 'string' },
      count: { type: 'string', default: '5' },
      dataset: { type: 'string' },
      'batch-size': { type: 'string', default: '10' },
      'delay-ms': { type: 'string', default: '2000' },
    },
  });

  // The top-of-file loadEnv({ override: true }) clobbers any CLI-provided
  // SANITY_DATASET with the value in .env.local, so a dataset override must be
  // applied AFTER env load. Both the read client (createWriteClient) and the
  // write (patchFaqPagesInSanity) key off SANITY_DATASET / opts.dataset.
  if (values.dataset) {
    process.env.SANITY_DATASET = values.dataset;
    process.env.NEXT_PUBLIC_SANITY_DATASET = values.dataset;
  }
  const datasetOpt = process.env.SANITY_DATASET || undefined;

  const execute = values.execute === true;
  const overwrite = values.overwrite === true;
  const count = Math.min(Math.max(Number.parseInt(values.count ?? '5', 10) || 5, 1), 8);
  const batchSize = Math.max(1, Number.parseInt(values['batch-size'] ?? '10', 10));
  const delayMs = Math.max(0, Number.parseInt(values['delay-ms'] ?? '2000', 10));
  const siteIdFilter = values['site-id'] ?? null;
  const since = values.since ? new Date(values.since) : null;
  if (since && Number.isNaN(since.getTime())) {
    console.error(`Invalid --since date: ${values.since}`);
    process.exit(1);
  }
  const mockAi = process.env.MOCK_AI === 'true';
  const dataset = process.env.SANITY_DATASET ?? '(env default)';
  const dateStamp = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const db = getDb();
  const conds = [inArray(sites.status, TARGET_STATUSES as unknown as string[])];
  if (siteIdFilter) conds.push(eq(sites.id, siteIdFilter));
  if (since) conds.push(lt(sites.createdAt, since));
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
    `\nFAQ backfill — ${rows.length} site(s) in {${TARGET_STATUSES.join(', ')}}` +
      `${siteIdFilter ? ` filtered to ${siteIdFilter}` : ''}` +
      `${since ? ` created before ${since.toISOString().slice(0, 10)}` : ''}`,
  );
  console.log(`Dataset: ${dataset}   FAQ pages/site: ${count}   Overwrite existing: ${overwrite}`);
  console.log(`Mode: ${execute ? 'EXECUTE (generate + patch Sanity + enqueue re-crawl)' : 'DRY RUN (eligibility only — no LLM, no writes)'}`);
  console.log(`Generation: ${mockAi ? 'MOCK_AI — mock FAQ content, $0 spend' : execute ? 'real LLM (~$0.01–0.03/site)' : 'not run (dry run)'}\n`);

  const sanity = createWriteClient(datasetOpt ? { dataset: datasetOpt } : {});
  const outcomes: SiteOutcome[] = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    for (const r of batch) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await processSite(r, { execute, overwrite, count, sanity, db, nowIso, dateStamp, datasetOpt });
      outcomes.push(outcome);
      printSiteLine(outcome, r);
    }
    if (i + batchSize < rows.length && delayMs > 0) {
      log.info({ done: Math.min(i + batchSize, rows.length), total: rows.length }, 'faq backfill batch processed');
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }
  }

  printSummary(outcomes, execute);
  if (!execute) {
    console.log(`\nDry run only — ZERO LLM calls, ZERO writes. Re-run with --execute to generate + patch.\n`);
  }
}

async function processSite(
  r: SiteRow,
  ctx: {
    execute: boolean;
    overwrite: boolean;
    count: number;
    sanity: ReturnType<typeof createWriteClient>;
    db: ReturnType<typeof getDb>;
    nowIso: string;
    dateStamp: string;
    datasetOpt: string | undefined;
  },
): Promise<SiteOutcome> {
  const { execute, overwrite, count, sanity, db, nowIso, dateStamp, datasetOpt } = ctx;
  const out: SiteOutcome = {
    siteId: r.id,
    domain: r.domain,
    skipped: null,
    existingFaq: 0,
    generated: 0,
    wouldGenerate: 0,
    costUsd: 0,
    patched: false,
    eventEmitted: false,
    error: null,
  };

  const docId = siteDocId(r.id);
  const content = (await sanity.fetch(
    `*[_id == $id][0]{
       businessName, niche, city, state,
       "theme": theme->name,
       "faqCount": count(faqPages),
       "faqTitles": faqPages[]->title
     }`,
    { id: docId },
  )) as SiteContent | null;

  if (!content) {
    // Postgres row without a built Sanity site doc — skip rather than create one.
    out.skipped = 'no-sanity-doc';
    return out;
  }

  out.existingFaq = content.faqCount ?? 0;
  if (out.existingFaq >= 1 && !overwrite) {
    out.skipped = 'already-has-faq';
    return out;
  }

  if (!execute) {
    out.wouldGenerate = count;
    return out;
  }

  // ---------- EXECUTE: generate + patch ----------
  try {
    const result = await generateFaqPages({
      niche: content.niche ?? r.niche,
      city: content.city ?? r.city,
      state: content.state ?? r.state,
      business_name: content.businessName ?? undefined,
      theme: content.theme ?? undefined,
      count,
      // On overwrite, steer the model away from the existing questions.
      existing_questions: overwrite ? (content.faqTitles ?? []).filter(Boolean) : [],
    });
    out.costUsd = result.cost_usd;

    await patchFaqPagesInSanity(r.id, result.faq_pages, { dataset: datasetOpt, dateModified: nowIso });
    out.generated = result.faq_pages.length;
    out.patched = true;

    // Re-crawl ping — same shape as backfill-structured-data so operator-tick
    // routes it to indexnow-submitter.
    await db.insert(agentEvents).values({
      agent: 'backfill-faq',
      type: 'site.content.updated',
      targetAgent: 'indexnow-submitter',
      payload: { site_id: r.id, dedupeKey: `indexnow:faq:${r.id}:${dateStamp}` },
    });
    out.eventEmitted = true;
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    log.warn({ siteId: r.id, err: out.error }, 'faq backfill failed — skipping site');
  }

  return out;
}

function printSiteLine(o: SiteOutcome, r: SiteRow): void {
  const parts: string[] = [];
  if (o.skipped === 'no-sanity-doc') parts.push('skip:no-sanity-doc');
  else if (o.skipped === 'already-has-faq') parts.push(`skip:has-faq(${o.existingFaq})`);
  if (o.wouldGenerate) parts.push(`would-gen:${o.wouldGenerate}`);
  if (o.generated) parts.push(`faq:+${o.generated}`);
  if (o.costUsd) parts.push(`$${o.costUsd.toFixed(4)}`);
  if (o.eventEmitted) parts.push('recrawl:enqueued');
  if (o.error) parts.push(`ERROR:${o.error.slice(0, 60)}`);
  console.log(
    `  ${r.id}  ${o.domain ?? '(no domain)'}  · ${r.niche} ${r.city}, ${r.state}  [${parts.join(' ') || 'nothing to do'}]`,
  );
}

function printSummary(outcomes: SiteOutcome[], execute: boolean): void {
  const scanned = outcomes.length;
  const noDoc = outcomes.filter((o) => o.skipped === 'no-sanity-doc').length;
  const hasFaq = outcomes.filter((o) => o.skipped === 'already-has-faq').length;
  const eligible = outcomes.filter((o) => o.skipped === null).length;
  const generated = outcomes.reduce((n, o) => n + o.generated, 0);
  const would = outcomes.reduce((n, o) => n + o.wouldGenerate, 0);
  const cost = outcomes.reduce((n, o) => n + o.costUsd, 0);
  const events = outcomes.filter((o) => o.eventEmitted).length;
  const errors = outcomes.filter((o) => o.error).length;

  const line = '─'.repeat(72);
  console.log(`\n${line}\n  Summary (${execute ? 'EXECUTE' : 'DRY RUN'})\n${line}`);
  console.log(`  sites scanned          : ${scanned}`);
  console.log(`  eligible               : ${eligible}`);
  console.log(`  skipped (already FAQ)  : ${hasFaq}`);
  console.log(`  skipped (no Sanity doc): ${noDoc}`);
  console.log(`  FAQ pages ${execute ? 'generated' : 'would gen'} : ${execute ? generated : would}`);
  console.log(`  re-crawl events emitted: ${execute ? events : 0}`);
  if (errors) console.log(`  sites FAILED           : ${errors}`);
  if (execute) console.log(`  est. spend             : $${cost.toFixed(4)}`);
  console.log(line);
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? err.message : err, stack: err instanceof Error ? err.stack : undefined },
    'backfill-faq failed',
  );
  process.exit(1);
});
