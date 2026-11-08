/**
 * One-off content patch for the CueDuo -> Cuelit rename (Nov 2026). Rewrites
 * the live documents in place; it does NOT re-seed, because production has
 * Studio edits the seed does not carry (see seed-cuelit.ts header).
 *
 *   pnpm tsx scripts/patch-cuelit-rebrand.ts --dataset production --dry-run
 *   pnpm tsx scripts/patch-cuelit-rebrand.ts --dataset production
 *
 * What it changes, on the csSite (siteKey `cueduo`) and every document that
 * references it:
 *   - csSite.siteKey `cueduo` -> `cuelit`, csSite.customDomain -> `cuelit.app`
 *     (the code registry already keys on `cuelit`, so the site 404s on the
 *     new code until this runs; run it right after the deploy)
 *   - every string: "CueDuo" -> "Cuelit", "cueduo.com" -> "cuelit.app"
 *   - csValuePropsBlock icon keys `cueduo/*` -> `cuelit/*`; items using the
 *     dropped `cueduo/fold` icon are removed
 *   - csSite.logo -> the Cuelit wordmark, csSite.favicon -> the app icon
 *     (both from scripts/assets/cuelit/, copied from the brand guide); the
 *     upload is skipped on a dry run
 * Document _ids (cs-site-cueduo, cs-page-cueduo-*) stay as they are: pages
 * find the site by reference, so renaming ids buys nothing and breaks refs.
 *
 * Every write is guarded by the revision read at the start of the run
 * (ifRevisionId), so a Studio edit made mid-run rejects the transaction and
 * nothing is written. Drafts are reported, never patched: publish or discard
 * them in Studio first.
 *
 * The dry run writes before/after JSON per document to --out (default: a tmp
 * dir) and lists every remaining "duo" mention for a manual pass (legal text
 * about iPhone Duo is flagged, never edited here).
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// Subpath import only: the package root pulls in Studio-only code.
import { createWriteClient } from '@leadlandlord/sanity-schema/client';

const { values: args } = parseArgs({
  options: {
    dataset: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});
const dataset = args.dataset;
if (dataset !== 'development' && dataset !== 'production') {
  console.error('Usage: patch-cuelit-rebrand.ts --dataset development|production [--dry-run] [--out <dir>]');
  process.exit(1);
}
const dryRun = Boolean(args['dry-run']);
const outDir = args.out ?? join(tmpdir(), 'patch-cuelit-rebrand');

const OLD_KEY = 'cueduo';
const NEW_KEY = 'cuelit';
const NEW_DOMAIN = 'cuelit.app';
const DROPPED_ICON = 'cueduo/fold';
const ASSET_DIR = resolve(__dirname, 'assets', 'cuelit');
const LOGO_FILE = 'cuelit-wordmark-on-light.png';
const FAVICON_FILE = 'cuelit-icon-light.svg';

/** Keys that hold identifiers or references, never copy. */
const SKIP_KEYS = new Set(['_id', '_rev', '_type', '_ref', '_key', '_createdAt', '_updatedAt', 'asset']);

type Doc = Record<string, unknown> & { _id: string; _rev: string; _type: string };

function rewriteString(value: string): string {
  return value
    .replace(/cueduo\.com/gi, NEW_DOMAIN)
    .replace(/CueDuo/g, 'Cuelit')
    .replace(/^cueduo\//, 'cuelit/');
}

function isFoldItem(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)._type === 'csValuePropItem' &&
    (value as Record<string, unknown>).icon === DROPPED_ICON
  );
}

function rewrite(value: unknown, key?: string): unknown {
  if (key && SKIP_KEYS.has(key)) return value;
  if (typeof value === 'string') return rewriteString(value);
  if (Array.isArray(value)) return value.filter((item) => !isFoldItem(item)).map((item) => rewrite(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, k);
    return out;
  }
  return value;
}

/** Every remaining "duo" mention, with its JSON path, for the manual pass. */
function findDuo(value: unknown, path: string, hits: string[]): void {
  if (typeof value === 'string') {
    if (/duo/i.test(value)) hits.push(`${path}: ${value.length > 140 ? `${value.slice(0, 140)}...` : value}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findDuo(v, `${path}[${i}]`, hits));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (!SKIP_KEYS.has(k)) findDuo(v, path ? `${path}.${k}` : k, hits);
  }
}

/** Top-level fields that differ, so the patch sets only what changed. */
function changedFields(before: Doc, after: Doc): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    if (SKIP_KEYS.has(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(v)) set[k] = v;
  }
  return set;
}

async function main() {
  const client = createWriteClient({ dataset });

  // Matches either key so a re-run (e.g. after publishing a draft) is safe:
  // every rewrite here is idempotent.
  const site = await client.fetch<Doc | null>(
    `*[_type=="csSite" && siteKey in [$old, $new] && !(_id in path("drafts.**"))][0]`,
    { old: OLD_KEY, new: NEW_KEY },
  );
  if (!site) {
    console.log(`No csSite with siteKey "${OLD_KEY}" or "${NEW_KEY}" in "${dataset}".`);
    return;
  }
  const baseId = site._id;
  const related = await client.fetch<Doc[]>(`*[references($id) && !(_id in path("drafts.**"))]`, { id: baseId });
  const drafts = await client.fetch<string[]>(`*[_id in path("drafts.**") && (_id == $draft || references($id))]._id`, {
    id: baseId,
    draft: `drafts.${baseId}`,
  });

  /** Uploads one brand file (Sanity dedupes by hash) and returns an image field. */
  async function imageField(filename: string, alt?: string) {
    const ref = dryRun
      ? `dry-run:${filename}`
      : (await client.assets.upload('image', createReadStream(join(ASSET_DIR, filename)), { filename }))._id;
    return { _type: 'image', asset: { _type: 'reference', _ref: ref }, ...(alt ? { alt } : {}) };
  }

  const docs = [site, ...related];
  const patches: Array<{ id: string; rev: string; set: Record<string, unknown> }> = [];
  const duoHits: string[] = [];
  mkdirSync(outDir, { recursive: true });

  for (const doc of docs) {
    const after = rewrite(doc) as Doc;
    if (doc._id === baseId) {
      after.siteKey = NEW_KEY;
      after.customDomain = NEW_DOMAIN;
      after.logo = await imageField(LOGO_FILE, 'Cuelit');
      after.favicon = await imageField(FAVICON_FILE);
    }
    findDuo(after, doc._id, duoHits);
    const set = changedFields(doc, after);
    if (Object.keys(set).length === 0) continue;
    patches.push({ id: doc._id, rev: doc._rev, set });
    writeFileSync(join(outDir, `${doc._id}.before.json`), JSON.stringify(doc, null, 2));
    writeFileSync(join(outDir, `${doc._id}.after.json`), JSON.stringify(after, null, 2));
  }

  console.log(`Dataset: ${dataset}${dryRun ? ' (dry run)' : ''}`);
  console.log(`Site: ${baseId}; ${related.length} referencing docs; ${patches.length} to patch.`);
  for (const p of patches) console.log(`  - ${p.id}: ${Object.keys(p.set).join(', ')}`);
  if (drafts.length) {
    console.log(`\nDrafts NOT patched (publish or discard in Studio, then re-run):`);
    for (const d of drafts) console.log(`  - ${d}`);
  }
  if (duoHits.length) {
    console.log(`\nRemaining "duo" mentions after the rewrite (review by hand):`);
    for (const h of duoHits) console.log(`  - ${h}`);
  }
  console.log(`\nBefore/after JSON: ${outDir}`);

  if (dryRun) return;
  const tx = client.transaction();
  for (const p of patches) tx.patch(p.id, (patch) => patch.ifRevisionId(p.rev).set(p.set));
  const result = await tx.commit();
  console.log(`Committed transaction ${result.transactionId}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
