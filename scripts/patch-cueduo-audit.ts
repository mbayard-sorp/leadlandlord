/**
 * One-off content patch for the CueDuo design audit (22 Oct 2026,
 * "CueDuo Site Audit.dc.html"). Applies the copy and content tickets to the
 * live documents in place. It does NOT re-seed: production has Studio edits
 * the seed does not carry (see seed-cueduo.ts header), so a createOrReplace
 * would clobber them.
 *
 *   pnpm tsx scripts/patch-cueduo-audit.ts --dataset production --dry-run
 *   pnpm tsx scripts/patch-cueduo-audit.ts --dataset production
 *
 * Every patch is guarded by the document revision this script was written
 * against (ifRevisionId). If someone has edited one of these documents in
 * Studio since, the whole transaction is rejected and nothing is written:
 * re-read the doc, update the expected revision and the paths below, re-run.
 * Pass --skip-rev-check only after confirming the newer edits don't touch
 * these fields.
 *
 * Tickets covered:
 *   CD-01/03  one device requirement ("any iPhone, iOS 18 or later"), no "iPhone Duo"
 *   CD-02     internal notes removed; customer copy under the plan cards
 *   CD-04     csSite.storeState = soon (plan buttons render "Coming soon")
 *   CD-07     duplicate "Features" H2 on the features index removed
 *   CD-11     The Prompter FAQ trimmed to 6; 6 of the rest moved to Support
 *   CD-15     "Maya" removed from the prompter script
 *   CD-16     Support form uses the support variant (Name, Email, Which phone?, Message)
 *   CD-20     Support FAQ statement rephrased as a question
 *   CD-27     "Updates" (a 404) removed from the footer
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

// Subpath import only: the package root pulls in Studio-only code.
import { createWriteClient } from '@leadlandlord/sanity-schema/client';

const { values: args } = parseArgs({
  options: {
    dataset: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'skip-rev-check': { type: 'boolean', default: false },
  },
});
const dataset = args.dataset;
if (dataset !== 'development' && dataset !== 'production') {
  console.error('Usage: patch-cueduo-audit.ts --dataset development|production [--dry-run] [--skip-rev-check]');
  process.exit(1);
}
const dryRun = Boolean(args['dry-run']);
const checkRev = !args['skip-rev-check'];

/** Production revisions read on 2026-10-22, before this patch. */
const EXPECTED_REV: Record<string, string> = {
  'cs-site-cueduo': '7mFuWwFAwHekQc41G2rpG1',
  'cs-page-cueduo-home': '46JOCERFR87CjKV7pAtXyz',
  'cs-page-cueduo-features': '46JOCERFR87CjKV7pAtXyz',
  'cs-page-cueduo-pricing': '46JOCERFR87CjKV7pAtXyz',
  'cs-page-cueduo-support': '46JOCERFR87CjKV7pAtXyz',
  'cs-pa-cueduo-prompter': '46JOCERFR87CjKV7pAtXyz',
};

const QUALIFIER = 'Requires an iPhone running iOS 18 or later';
const PLANS_FOOTNOTE = 'Billed through your Apple ID. Cancel any time in Settings.';
const FOLD_ANSWER =
  'No. CueDuo runs on any iPhone with iOS 18 or later, and the script always sits right under the front camera.';

/** The Prompter keeps these six, in this order (CD-11). */
const PROMPTER_KEEP = ['6d9d77fc4cf8', '1cc9b69f5f55', '5b24e4ff644e', '533cab27a0d4', '81c86784ae88', '21c9ecdfb24a'];
/** Moved to Support, in this order. */
const PROMPTER_TO_SUPPORT = ['b458396ffd4f', '171b6749cf55', '200e20aea798', '759b6f5c9446', '1e169ebf676f', '0b82599e40c8'];
/** Dropped outright: "How does it work on iPhone Duo?" (CD-03). */
const PROMPTER_DROP = ['18d17c16d358'];

interface FaqItem {
  _key: string;
  _type: string;
  question: string;
  answer: string;
}

type PatchSpec = {
  id: string;
  set?: Record<string, unknown>;
  unset?: string[];
  insertAfter?: { at: string; items: unknown[] };
};

async function main() {
  const client = createWriteClient({ dataset });

  const ids = Object.keys(EXPECTED_REV);
  const docs = await client.fetch<Array<{ _id: string; _rev: string; faqs?: FaqItem[] }>>(
    `*[_id in $ids]{ _id, _rev, faqs }`,
    { ids },
  );
  const byId = new Map(docs.map((d) => [d._id, d]));
  for (const id of ids) {
    const doc = byId.get(id);
    if (!doc) throw new Error(`Missing document ${id} in "${dataset}".`);
    if (checkRev && dataset === 'production' && doc._rev !== EXPECTED_REV[id]) {
      throw new Error(
        `${id} changed since this patch was written (rev ${doc._rev}, expected ${EXPECTED_REV[id]}). ` +
          'Nothing written. Re-check the doc, then update EXPECTED_REV or pass --skip-rev-check.',
      );
    }
  }

  const prompterFaqs = byId.get('cs-pa-cueduo-prompter')?.faqs ?? [];
  const faqByKey = new Map(prompterFaqs.map((f) => [f._key, f]));
  const moved = PROMPTER_TO_SUPPORT.map((key) => faqByKey.get(key)).filter((f): f is FaqItem => Boolean(f));
  if (moved.length !== PROMPTER_TO_SUPPORT.length) {
    throw new Error(`Expected ${PROMPTER_TO_SUPPORT.length} prompter FAQs to move, found ${moved.length}. Nothing written.`);
  }

  const patches: PatchSpec[] = [
    {
      id: 'cs-site-cueduo',
      set: { storeState: 'soon' },
      unset: ['footerColumns[_key=="footer-product"].links[_key=="fp-updates"]', 'footerNav[_key=="nav-35"]'],
    },
    {
      id: 'cs-page-cueduo-home',
      set: {
        'pageBuilder[_key=="blk-45"].pastLine':
          'Hi there. For the last year I’ve been building something for people who hate talking to camera.',
        'pageBuilder[_key=="blk-45"].imageCaption':
          'The line you’re reading sits right under the camera, so your eyes stay on the lens.',
        'pageBuilder[_key=="blk-45"].image.alt': 'Presenter holding a phone, reading the script just under the camera',
        'pageBuilder[_key=="blk-59"].footnote': PLANS_FOOTNOTE,
        'pageBuilder[_key=="blk-63"].items[_key=="req-64"].value': 'Any iPhone that runs iOS 18 or later.',
        'pageBuilder[_key=="blk-68"].items[_key=="faq-69"].answer': FOLD_ANSWER,
        'pageBuilder[_key=="blk-73"].qualifier': QUALIFIER,
      },
      unset: ['pageBuilder[_key=="blk-54"].footnote'],
    },
    {
      id: 'cs-page-cueduo-features',
      set: { 'pageBuilder[_key=="blk-78"].qualifier': QUALIFIER },
      unset: ['pageBuilder[_key=="blk-77"].heading'],
    },
    {
      id: 'cs-page-cueduo-pricing',
      set: {
        'pageBuilder[_key=="blk-79"].footnote': PLANS_FOOTNOTE,
        'pageBuilder[_key=="blk-86"].qualifier': QUALIFIER,
      },
    },
    {
      id: 'cs-page-cueduo-support',
      set: {
        'pageBuilder[_key=="blk-87"].items[_key=="faq-88"].answer': FOLD_ANSWER,
        'pageBuilder[_key=="blk-87"].items[_key=="faq-89"].question': 'What if the prompter is too fast or too slow?',
        'pageBuilder[_key=="blk-91"].formVariant': 'support',
      },
      insertAfter: { at: 'pageBuilder[_key=="blk-87"].items[-1]', items: moved },
    },
    {
      id: 'cs-pa-cueduo-prompter',
      unset: [...PROMPTER_TO_SUPPORT, ...PROMPTER_DROP].map((key) => `faqs[_key=="${key}"]`),
    },
  ];

  const keptCount = prompterFaqs.filter((f) => PROMPTER_KEEP.includes(f._key)).length;
  console.log(`Dataset: ${dataset}${dryRun ? ' (dry run)' : ''}`);
  console.log(`Prompter FAQ: ${prompterFaqs.length} -> ${keptCount}; ${moved.length} moved to Support.`);
  for (const p of patches) {
    console.log(`\n${p.id}`);
    for (const [path, value] of Object.entries(p.set ?? {})) console.log(`  set   ${path} = ${JSON.stringify(value)}`);
    for (const path of p.unset ?? []) console.log(`  unset ${path}`);
    if (p.insertAfter) console.log(`  insert ${p.insertAfter.items.length} item(s) after ${p.insertAfter.at}`);
  }
  if (dryRun) return;

  const tx = client.transaction();
  for (const p of patches) {
    let patch = client.patch(p.id);
    if (checkRev && dataset === 'production') patch = patch.ifRevisionId(EXPECTED_REV[p.id]!);
    if (p.set) patch = patch.set(p.set);
    if (p.unset) patch = patch.unset(p.unset);
    if (p.insertAfter) patch = patch.insert('after', p.insertAfter.at, p.insertAfter.items);
    tx.patch(patch);
  }
  const res = await tx.commit();
  console.log(`\nCommitted transaction ${res.transactionId}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
