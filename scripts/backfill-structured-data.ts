#!/usr/bin/env -S tsx
/**
 * LeadLandlord — Phase 2b: additive structured-data backfill for existing sites.
 *
 * Sites built before the structured-data fields shipped are missing:
 *   - site geo (`latitude`/`longitude`) → no LocalBusiness GeoCoordinates
 *   - per-article `articleImage` on blog/info pages → no Article rich-result image
 *   - page `dateModified` → no Article dateModified
 *
 * This script ADDS those fields in place. It is strictly additive and
 * patch-only:
 *   - NEVER rebuilds a site, NEVER touches mdx / title / metaDescription / jsonLd.
 *   - NEVER sets `sameAs` (operator-entered real GBP/social URLs only).
 *   - Only sets a field when it is currently absent (idempotent — re-running
 *     sets nothing already set; "already-set" is reported, not overwritten).
 * After a site's patches it emits the same IndexNow re-crawl event
 * `backfill-indexnow` uses (`site.activated` → `indexnow-submitter`) so search
 * engines re-crawl the now-richer pages.
 *
 * Safe by default: prints what it WOULD do and exits WITHOUT writing. Pass
 * --execute to actually patch Sanity + enqueue re-crawl events. Image
 * generation costs ~$0.02-0.04 each; set MOCK_AI=true to skip image gen while
 * still patching geo + dateModified (images are then only reported).
 *
 * Migrations/writes are manual in this repo — there is no auto-runner; invoke
 * this by hand and watch the summary.
 *
 * Usage:
 *   pnpm backfill-structured-data                       # dry run — report only
 *   pnpm backfill-structured-data --execute             # patch + enqueue re-crawl
 *   pnpm backfill-structured-data --site-id <uuid>      # one site
 *   pnpm backfill-structured-data --since 2026-05-20    # only sites created before this date
 *   pnpm backfill-structured-data --execute --batch-size 20 --delay-ms 2000
 *   MOCK_AI=true pnpm backfill-structured-data --execute   # skip image gen
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
import { uploadHeroImage } from '@leadlandlord/integrations/sanity';
// eslint-disable-next-line import/order
import { generateHeroImageBuffer } from '@leadlandlord/integrations/imagen';
// eslint-disable-next-line import/order
import { geocode } from '@leadlandlord/integrations';
// eslint-disable-next-line import/order
import { log } from '@leadlandlord/shared/log';

// Statuses that are public-facing enough to deserve structured data + a
// re-crawl ping. Mirrors the "live-ish" set: warming (indexable soon), live,
// and rented.
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

/** A blog/info page doc that may be missing structured-data fields. */
interface PageDoc {
  _id: string;
  kind: string;
  title?: string;
  hasArticleImage: boolean;
  hasDateModified: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface SiteOutcome {
  siteId: string;
  domain: string | null;
  geoSet: boolean;
  geoSkipped: 'already-set' | 'no-centroid' | null;
  imagesGenerated: number;
  imagesWouldGenerate: number;
  imagesFailed: number;
  datesStamped: number;
  pagesAlreadyComplete: number;
  patched: boolean;
  eventEmitted: boolean;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean', default: false },
      since: { type: 'string' },
      'site-id': { type: 'string' },
      'batch-size': { type: 'string', default: '20' },
      'delay-ms': { type: 'string', default: '2000' },
    },
  });

  const execute = values.execute === true;
  const batchSize = Math.max(1, Number.parseInt(values['batch-size'] ?? '20', 10));
  const delayMs = Math.max(0, Number.parseInt(values['delay-ms'] ?? '2000', 10));
  const siteIdFilter = values['site-id'] ?? null;
  const since = values.since ? new Date(values.since) : null;
  if (since && Number.isNaN(since.getTime())) {
    console.error(`Invalid --since date: ${values.since}`);
    process.exit(1);
  }
  const mockAi = process.env.MOCK_AI === 'true';
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
    `\nStructured-data backfill — ${rows.length} site(s) in {${TARGET_STATUSES.join(', ')}}` +
      `${siteIdFilter ? ` filtered to ${siteIdFilter}` : ''}` +
      `${since ? ` created before ${since.toISOString().slice(0, 10)}` : ''}`,
  );
  console.log(`Mode: ${execute ? 'EXECUTE (patching Sanity + enqueueing re-crawl)' : 'DRY RUN (no writes)'}`);
  console.log(`Image gen: ${mockAi ? 'MOCK_AI — images reported only, not generated' : execute ? 'enabled' : 'reported only (dry run)'}\n`);

  const sanity = createWriteClient();
  const outcomes: SiteOutcome[] = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    for (const r of batch) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await processSite(r, { execute, mockAi, sanity, db, dateStamp, nowIso });
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
    console.log(`\nDry run only — ZERO writes made. Re-run with --execute to patch + enqueue re-crawl events.\n`);
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
    nowIso: string;
  },
): Promise<SiteOutcome> {
  const { execute, mockAi, sanity, db, dateStamp, nowIso } = ctx;
  const out: SiteOutcome = {
    siteId: r.id,
    domain: r.domain,
    geoSet: false,
    geoSkipped: null,
    imagesGenerated: 0,
    imagesWouldGenerate: 0,
    imagesFailed: 0,
    datesStamped: 0,
    pagesAlreadyComplete: 0,
    patched: false,
    eventEmitted: false,
  };

  const docId = siteDocId(r.id);

  // --- Read current state (read-only; safe in dry run) ---
  const siteDoc = (await sanity.getDocument(docId)) as
    | { latitude?: number; longitude?: number }
    | undefined;
  if (!siteDoc) {
    // No Sanity site doc — nothing to patch. (Postgres row without a built
    // Sanity site; skip rather than create one.)
    out.geoSkipped = 'no-centroid';
    return out;
  }

  const geoMissing = siteDoc.latitude == null || siteDoc.longitude == null;
  const geo = geoMissing ? await geocode.geocodeCityState(r.city, r.state) : null;
  if (!geoMissing) {
    out.geoSkipped = 'already-set';
  } else if (!geo) {
    out.geoSkipped = 'no-centroid';
  }

  // Blog + info pages for this site — the Article-eligible kinds.
  const pageDocs = (await sanity.fetch(
    `*[_type == "page" && site._ref == $ref && kind in ["blog","info"]]{
       _id, kind, title,
       "hasArticleImage": defined(articleImage.asset),
       "hasDateModified": defined(dateModified)
     }`,
    { ref: docId },
  )) as PageDoc[];

  // --- Plan page-level work ---
  const pagesNeedingImage = pageDocs.filter((p) => !p.hasArticleImage);
  const pagesNeedingDate = pageDocs.filter((p) => !p.hasDateModified);
  out.pagesAlreadyComplete = pageDocs.filter((p) => p.hasArticleImage && p.hasDateModified).length;

  if (!execute) {
    // Dry run: report only. ZERO writes.
    if (geo) out.geoSet = true; // would-set
    out.imagesWouldGenerate = pagesNeedingImage.length;
    out.datesStamped = pagesNeedingDate.length; // would-stamp
    return out;
  }

  // ---------- EXECUTE: patch-only, additive ----------

  // 1) Site geo — single patch, only the two coordinate fields, only if absent.
  if (geo) {
    await sanity.patch(docId).set({ latitude: geo.latitude, longitude: geo.longitude }).commit({ visibility: 'async' });
    out.geoSet = true;
    out.patched = true;
  }

  // 2) Per-page articleImage (best-effort) — generate + upload + patch each.
  for (const p of pagesNeedingImage) {
    if (mockAi) {
      out.imagesWouldGenerate += 1;
      continue;
    }
    try {
      const prompt = articleImagePrompt(r, p);
      // eslint-disable-next-line no-await-in-loop
      const img = await generateHeroImageBuffer(prompt, { aspectRatio: '16:9' });
      if (!img) {
        // No provider key / generation skipped — treat as a soft skip.
        out.imagesWouldGenerate += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const uploaded = await uploadHeroImage(
        r.id,
        img.buffer,
        `article-${p._id}.jpg`,
        img.contentType,
      );
      // eslint-disable-next-line no-await-in-loop
      await sanity
        .patch(p._id)
        .setIfMissing({ articleImage: { _type: 'image' } })
        .set({ articleImage: { _type: 'image', asset: { _type: 'reference', _ref: uploaded.assetId } } })
        .commit({ visibility: 'async' });
      out.imagesGenerated += 1;
      out.patched = true;
    } catch (err) {
      out.imagesFailed += 1;
      log.warn(
        { siteId: r.id, pageId: p._id, err: err instanceof Error ? err.message : String(err) },
        'articleImage backfill failed — skipping page',
      );
    }
  }

  // 3) dateModified — stamp ONLY pages that have none. Never overwrite an
  //    existing date (don't fabricate a fresh edit time).
  for (const p of pagesNeedingDate) {
    // eslint-disable-next-line no-await-in-loop
    await sanity.patch(p._id).setIfMissing({ dateModified: nowIso }).commit({ visibility: 'async' });
    out.datesStamped += 1;
    out.patched = true;
  }

  // 4) Re-crawl ping — same shape as backfill-indexnow so operator-tick routes
  //    it to indexnow-submitter. Only emit when we actually changed something.
  if (out.patched) {
    await db.insert(agentEvents).values({
      agent: 'backfill-structured-data',
      type: 'site.content.updated',
      targetAgent: 'indexnow-submitter',
      payload: { site_id: r.id, dedupeKey: `indexnow:structured-data:${r.id}:${dateStamp}` },
    });
    out.eventEmitted = true;
  }

  return out;
}

function articleImagePrompt(r: SiteRow, p: PageDoc): string {
  const subject = p.title ? p.title : `${r.niche} services`;
  return `Editorial photograph illustrating "${subject}" for a ${r.niche} business in ${r.city}, ${r.state}. Real-world on-location scene, no people's faces, no text.`;
}

function printSiteLine(o: SiteOutcome, r: SiteRow): void {
  const parts: string[] = [];
  if (o.geoSet) parts.push('geo:set');
  else if (o.geoSkipped === 'already-set') parts.push('geo:already-set');
  else if (o.geoSkipped === 'no-centroid') parts.push('geo:no-centroid');
  if (o.imagesGenerated) parts.push(`img:+${o.imagesGenerated}`);
  if (o.imagesWouldGenerate) parts.push(`img:would+${o.imagesWouldGenerate}`);
  if (o.imagesFailed) parts.push(`img:fail${o.imagesFailed}`);
  if (o.datesStamped) parts.push(`dateModified:+${o.datesStamped}`);
  if (o.pagesAlreadyComplete) parts.push(`pages-complete:${o.pagesAlreadyComplete}`);
  if (o.eventEmitted) parts.push('recrawl:enqueued');
  console.log(
    `  ${r.id}  ${o.domain ?? '(no domain)'}  · ${r.niche} ${r.city}, ${r.state}  [${parts.join(' ') || 'nothing to do'}]`,
  );
}

function printSummary(outcomes: SiteOutcome[], execute: boolean): void {
  const sitesScanned = outcomes.length;
  const geoSet = outcomes.filter((o) => o.geoSet).length;
  const geoAlready = outcomes.filter((o) => o.geoSkipped === 'already-set').length;
  const geoNoCentroid = outcomes.filter((o) => o.geoSkipped === 'no-centroid').length;
  const imagesGenerated = outcomes.reduce((n, o) => n + o.imagesGenerated, 0);
  const imagesWould = outcomes.reduce((n, o) => n + o.imagesWouldGenerate, 0);
  const imagesFailed = outcomes.reduce((n, o) => n + o.imagesFailed, 0);
  const datesStamped = outcomes.reduce((n, o) => n + o.datesStamped, 0);
  const pagesComplete = outcomes.reduce((n, o) => n + o.pagesAlreadyComplete, 0);
  const eventsEmitted = outcomes.filter((o) => o.eventEmitted).length;

  const line = '─'.repeat(72);
  console.log(`\n${line}\n  Summary (${execute ? 'EXECUTE' : 'DRY RUN'})\n${line}`);
  console.log(`  sites scanned          : ${sitesScanned}`);
  console.log(`  geo ${execute ? 'set' : 'would set'}            : ${geoSet}`);
  console.log(`  geo skipped (already)  : ${geoAlready}`);
  console.log(`  geo skipped (no centroid / no Sanity doc) : ${geoNoCentroid}`);
  console.log(`  article images ${execute ? 'generated' : 'would gen'} : ${execute ? imagesGenerated : imagesWould}`);
  if (execute && imagesWould) console.log(`  article images skipped (MOCK_AI / no key) : ${imagesWould}`);
  if (imagesFailed) console.log(`  article images FAILED  : ${imagesFailed}`);
  console.log(`  dateModified ${execute ? 'stamped' : 'would stamp'} : ${datesStamped}`);
  console.log(`  pages already complete : ${pagesComplete}`);
  console.log(`  re-crawl events emitted: ${execute ? eventsEmitted : 0}`);
  console.log(line);
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? err.message : err, stack: err instanceof Error ? err.stack : undefined },
    'backfill-structured-data failed',
  );
  process.exit(1);
});
