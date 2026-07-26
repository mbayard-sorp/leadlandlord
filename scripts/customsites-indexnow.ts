#!/usr/bin/env -S tsx
/**
 * LeadLandlord — IndexNow submission for Custom Sites (ADR 0033 Amendment 1 D7).
 *
 * Custom Sites carry no Postgres row (D4), so the DB-keyed `indexnow-submitter`
 * agent (packages/agents/src/indexnow-submitter) cannot be reused — it selects
 * from `sites`, writes `geoSeoAudits`/`agent_events` FK rows, everything this
 * line must not touch. This script does the Sanity-only equivalent: query
 * `csSite` docs directly, lazily generate + patch `indexnowKey` on first run
 * (same `randomBytes(16).toString('hex')` convention the agent uses), derive
 * the URL set from the site's live `/sitemap.xml`, and submit via the existing
 * generic `submitUrls()` — unmodified, since it was already generic over
 * `{host, key, urls}` with zero Postgres dependency.
 *
 * Gate: skips (logs, does not submit) any csSite where `robotsDisallow !== false`
 * — submitting a noindexed site's URLs burns crawl signal on pages that 404/
 * noindex at fetch time (ADR 0033 D6's launch-noindexed invariant, enforced
 * here at the submission layer, not just the metadata layer).
 *
 * Trigger model: manual, operator-run — once at DNS cutover (when
 * robotsDisallow flips false) and again after any content edit worth a
 * recrawl ping. No Vercel Cron; a handful of sites doesn't justify a new
 * scheduled-function surface (revisit at 3+ live custom sites per D7).
 *
 * Safe by default: prints targets + would-submit URL counts and exits WITHOUT
 * submitting or writing to Sanity. Pass --execute to actually generate/patch
 * keys and submit.
 *
 * Usage:
 *   pnpm customsites-indexnow                    # dry run — report only
 *   pnpm customsites-indexnow --execute          # generate keys + submit
 *   pnpm customsites-indexnow --execute --site-key constructionadr
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
import { createWriteClient } from '@leadlandlord/sanity-schema/client';
// eslint-disable-next-line import/order
import { csSiteDocId } from '@leadlandlord/sanity-schema/ids';
// eslint-disable-next-line import/order
import { submitUrls } from '@leadlandlord/integrations/indexnow';
// eslint-disable-next-line import/order
import { log } from '@leadlandlord/shared/log';

interface CsSiteRow {
  _id: string;
  siteKey: string;
  name: string;
  customDomain: string | null;
  robotsDisallow: boolean | null;
  indexnowKey: string | null;
}

const LOC_RE = /<loc>([^<]+)<\/loc>/g;

/** Fetch + parse the live sitemap into an absolute-URL list. Same technique as
 * the tenant agent's fetchSitemapUrls. Empty on any failure. */
async function fetchSitemapUrls(host: string): Promise<string[]> {
  try {
    const res = await fetch(`https://${host}/sitemap.xml`, {
      headers: { Accept: 'application/xml,text/xml' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(LOC_RE)].map((m) => m[1]!.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean', default: false },
      'site-key': { type: 'string' },
    },
  });
  const execute = values.execute === true;
  const siteKeyFilter = values['site-key'] ?? null;

  const sanity = createWriteClient();
  const query = siteKeyFilter
    ? `*[_type=="csSite" && siteKey==$siteKey]{ _id, siteKey, name, customDomain, robotsDisallow, indexnowKey }`
    : `*[_type=="csSite"]{ _id, siteKey, name, customDomain, robotsDisallow, indexnowKey }`;
  const rows = await sanity.fetch<CsSiteRow[]>(query, siteKeyFilter ? { siteKey: siteKeyFilter } : {});

  console.log(`\nCustom Sites IndexNow submission — ${rows.length} csSite doc(s)${siteKeyFilter ? ` (filtered to ${siteKeyFilter})` : ''}`);
  console.log(`Mode: ${execute ? 'EXECUTE (generating keys + submitting)' : 'DRY RUN (no writes, no submissions)'}\n`);

  let submitted = 0;
  let skippedNoindex = 0;
  let skippedNoDomain = 0;

  for (const row of rows) {
    const label = `  ${row.siteKey}  ${row.name}  (${row.customDomain ?? 'no customDomain'})`;

    if (!row.customDomain) {
      skippedNoDomain += 1;
      console.log(`${label}  · SKIPPED — no customDomain attached`);
      continue;
    }

    // D6/D7 gate: never submit a launch-noindexed site's URLs. `robotsDisallow`
    // defaults true, so this also skips a doc that hasn't been touched yet.
    if (row.robotsDisallow !== false) {
      skippedNoindex += 1;
      console.log(`${label}  · SKIPPED — robotsDisallow is not explicitly false (noindexed)`);
      continue;
    }

    const host = row.customDomain;
    const docId = row._id || csSiteDocId(row.siteKey);

    let key = row.indexnowKey;
    if (!key) {
      if (!execute) {
        console.log(`${label}  · would generate + patch a new indexnowKey`);
      } else {
        key = randomBytes(16).toString('hex'); // 32 hex chars; matches proxy.ts's /{key}.txt route
        // eslint-disable-next-line no-await-in-loop
        await sanity.patch(docId).set({ indexnowKey: key }).commit();
        console.log(`${label}  · generated + patched new indexnowKey`);
      }
    }

    // eslint-disable-next-line no-await-in-loop
    let urls = await fetchSitemapUrls(host);
    if (urls.length === 0) urls = [`https://${host}/`];

    if (!execute) {
      console.log(`${label}  · WOULD SUBMIT ${urls.length} URL(s)`);
      submitted += 1;
      continue;
    }

    if (!key) {
      console.log(`${label}  · SKIPPED — no indexnowKey (dry-run above would have generated one)`);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const result = await submitUrls({ host, key, urls });
    log.info(
      { siteKey: row.siteKey, host, submitted: result.submitted, statusCode: result.statusCode, ok: result.ok },
      'customsites-indexnow submission',
    );
    console.log(`${label}  · ${result.ok ? 'SUBMITTED' : 'REJECTED'} ${result.submitted} URL(s) (status ${result.statusCode})`);
    submitted += 1;
  }

  const line = '─'.repeat(72);
  console.log(`\n${line}\n  Summary (${execute ? 'EXECUTE' : 'DRY RUN'})\n${line}`);
  console.log(`  sites scanned       : ${rows.length}`);
  console.log(`  submitted           : ${submitted}`);
  console.log(`  skipped (noindexed) : ${skippedNoindex}`);
  console.log(`  skipped (no domain) : ${skippedNoDomain}`);
  if (!execute) {
    console.log(`\nDry run only. Re-run with --execute to generate keys (if needed) and submit.\n`);
  }
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? err.message : err, stack: err instanceof Error ? err.stack : undefined },
    'customsites-indexnow failed',
  );
  process.exit(1);
});
