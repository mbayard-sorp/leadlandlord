/**
 * Cuelit homepage voice pass (Nov 2026): new tagline "Your lines, lit" and a
 * looser, funnier rewrite of every homepage section. Copy only; no block is
 * added, removed or reordered, and every other product fact (100 to 200
 * words a minute, portrait only, $59 / $8.99, seven-day trial) is unchanged.
 * It also states the app runs on iPhone and iPad on iOS 27 or later, drops the
 * folding-phone FAQ, and points "Write to us" at support@cuelit.app.
 *
 *   pnpm tsx scripts/patch-cuelit-home-voice.ts --dataset production --dry-run
 *   pnpm tsx scripts/patch-cuelit-home-voice.ts --dataset production
 *
 * Each edit names the value it expects to replace (read from production on
 * 2026-11-10). A field whose live value differs, say from a Studio edit made
 * since, is skipped and reported. Pass --overwrite-changed to write it anyway
 * (development needs this: its home page still carries the pre-#314 copy).
 *
 * Writes are guarded by the revision read at the start of the run
 * (ifRevisionId), so a Studio edit made mid-run rejects the transaction.
 * Drafts are reported, never patched. The dry run writes before/after JSON
 * per document to --out (default: a tmp dir).
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
    'overwrite-changed': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});
const dataset = args.dataset;
if (dataset !== 'development' && dataset !== 'production') {
  console.error(
    'Usage: patch-cuelit-home-voice.ts --dataset development|production [--dry-run] [--overwrite-changed] [--out <dir>]',
  );
  process.exit(1);
}
const dryRun = Boolean(args['dry-run']);
const overwriteChanged = Boolean(args['overwrite-changed']);
const outDir = args.out ?? join(tmpdir(), 'patch-cuelit-home-voice');

const SITE_KEY = 'cuelit';

type Path = Array<string | number>;
/** [path, value expected now ('' = field absent), new value] */
type Edit = [Path, string, string];

/** Edits on csSite. */
const SITE_EDITS: Edit[] = [
  [
    ['tagline'],
    'A teleprompter and recorder for iPhone, with your script right under the camera.',
    'Your lines, lit. A teleprompter and recorder for iPhone and iPad that keeps your script right under the camera.',
  ],
  [['mobileBar', 'text'], 'Look up. Say it once.', 'Your lines, lit.'],
  [['seo', 'metaTitle'], 'Cuelit | Look up. Say it once.', 'Cuelit | Your lines, lit'],
  [
    ['seo', 'metaDescription'],
    'A teleprompter and recorder for iPhone. Your script sits right under the front camera, so your eyes stay on the lens.',
    'A teleprompter and recorder for iPhone and iPad. Your script sits right under the front camera, so you can read every word and still look people in the eye.',
  ],
];

/** Shown wherever the page says what the app runs on. */
const QUALIFIER = 'For iPhone and iPad on iOS 27 or later';

/** Edits on the home csPage outside the page builder. */
const PAGE_EDITS: Edit[] = [
  [
    ['seo', 'metaDescription'],
    'A teleprompter and recorder for iPhone. Your script sits right under the front camera, so you talk to people, not to a reflection of yourself.',
    'A teleprompter and recorder for iPhone and iPad. Your script sits right under the front camera, so you can read every word and still look people in the eye.',
  ],
  [
    ['seo', 'metaTitle'],
    'Cuelit: Teleprompter and recorder for iPhone',
    'Cuelit: Teleprompter and recorder for iPhone and iPad',
  ],
];

/** Page-builder edits, by block type and occurrence (0 = first of that type). */
const BLOCK_EDITS: Array<{ type: string; nth: number; edits: Edit[] }> = [
  {
    type: 'csAppHeroBlock',
    nth: 0,
    edits: [
      [['eyebrow'], 'Teleprompter and recorder', 'Teleprompter + recorder for iPhone and iPad'],
      [
        ['qualifier'],
        'Requires iOS 18 or later · Free to try, no account',
        `${QUALIFIER} · Free to try, no account`,
      ],
      [['heading'], 'Look up.\nSay it once.', 'Your lines,\nlit.'],
      // New field: sets "lit" in brand orange, like the wordmark.
      [['headingAccent'], '', 'lit'],
      [
        ['subheading'],
        'A teleprompter and recorder for iPhone. Your script sits right under the front camera, so you talk to people, not to a reflection of yourself.',
        'Your script scrolls right under the front camera, so you can read every word and still look people in the eye. Nobody has to know you didn’t memorize it.',
      ],
      [['foldPreview', 'pastLine'], 'Thanks for joining.', 'Hey, thanks for being here.'],
      [
        ['foldPreview', 'currentLine'],
        'Today I want to show you something we’ve been quietly building for a year.',
        'I wrote every word of this down, and you can’t even tell.',
      ],
      [
        ['foldPreview', 'nextLine'],
        'It starts with a question. Why do we all hate talking to a camera?',
        'Which is sort of the whole point.',
      ],
      [['secondaryLabel'], 'See how a take happens', 'See how it works'],
    ],
  },
  {
    type: 'csIntroBlock',
    nth: 0,
    edits: [
      [['heading'], 'The words sit at the lens, so your eyes do too.', 'Read the script. Keep the eye contact.'],
      [
        ['body', 0, 'children', 0, 'text'],
        'When your script sits in the middle of the screen, your eyes drift down to read it, and everyone watching can tell.',
        'Most prompters park your script in the middle of the screen. Your eyes slide down every few seconds, and everyone watching can see it happen. It’s the video version of reading off your hand.',
      ],
      [
        ['body', 1, 'children', 0, 'text'],
        'Cuelit starts your script right under the front camera, so the line you’re reading is as close to the lens as it gets. You read at the lens, the take lands sooner, and you get your morning back.',
        'Cuelit starts your script right under the front camera, about as close to the lens as words can get. You read, they see you looking at them, the good take shows up sooner, and you get your morning back.',
      ],
    ],
  },
  {
    type: 'csPrompterBandBlock',
    nth: 0,
    edits: [
      [['eyebrow'], 'This is what you read from', 'Here’s what you’ll be reading'],
      [
        ['pastLine'],
        'Hi there. For the last year I’ve been building something for people who hate talking to camera.',
        'Hi. I spent a year building this for people who’d rather do anything than talk to a camera.',
      ],
      [
        ['currentLine'],
        'It lets you read your script while looking straight at the person watching.',
        'You read your script and look straight at whoever’s watching.',
      ],
      [['nextLine'], 'No glance down.', 'They’ll never catch you peeking.'],
      [
        ['imageCaption'],
        'The line you’re reading sits right under the camera, so your eyes stay on the lens.',
        'The line you’re on sits just under the camera. Your eyes barely have to move.',
      ],
      [
        ['notes', 0],
        'White Semibold on near-black. The line you’re on at full strength, the ones around it at 35 per cent.',
        'Big, bold letters on a dark stage. The line you’re on is lit, and the ones around it dim to 35%.',
      ],
      [
        ['notes', 1],
        'You set the speed, and it holds it steady from the first line to the last.',
        'Pick a speed and it holds steady from the first line to the last. It won’t sprint off halfway through.',
      ],
      [
        ['notes', 2],
        'Four sizes, stepping 24 to 44 points. Chosen at the distance you’ll actually stand.',
        'Four text sizes, from 24 to 44 points. Choose yours standing where you’ll actually film.',
      ],
    ],
  },
  {
    type: 'csValuePropsBlock',
    nth: 0,
    edits: [
      // The block has three items; the old eyebrow said four.
      [['eyebrow'], 'Four things it does well', 'Three things it’s great at'],
      [['items', 0, 'heading'], 'Eyes on the lens', 'Eyes up here'],
      [
        ['items', 0, 'body'],
        'The line you’re reading sits right under the camera, so you look at your audience, not below it.',
        'The line you’re reading sits right under the camera, so your audience gets eye contact instead of the top of your head.',
      ],
      [
        ['items', 1, 'body'],
        'Record as many takes as you need, keep the one that worked, and save it to Photos at full quality.',
        'Do as many takes as it takes. Keep the winner and save it to Photos at full quality.',
      ],
      [['items', 2, 'heading'], 'Your pace, not ours', 'Talk at your speed'],
      [
        ['items', 2, 'body'],
        'Set the speed once for each script, from 100 to 200 words a minute. Pause and it waits with you.',
        'Set each script anywhere from 100 to 200 words a minute. Stop for a breath and it waits for you.',
      ],
    ],
  },
  {
    type: 'csDeviceShowcaseBlock',
    nth: 0,
    edits: [
      [['heading'], 'Every take, kept.', 'Every take, kept. Even the weird ones.'],
      [
        ['body'],
        'Scripts keep their takes. Come back a week later, read the same lines again, and compare the two before you send one.',
        'Each script hangs on to its takes. Come back next week, read the same lines again, and compare the two before you pick the one to send.',
      ],
      [['ctaLabel'], 'Look inside the library', 'Peek inside the library'],
    ],
  },
  {
    type: 'csDeviceShowcaseBlock',
    nth: 1,
    edits: [
      [['heading'], 'Play it back before you put the phone down', 'Watch it back before you put the phone down'],
      [
        ['body'],
        'Every take lands in Review the moment you tap Stop. Watch it, keep the good one, or go again with the same settings.',
        'Tap Stop and your take is already waiting in Review. Watch it, keep it, or go again with the same settings, as many times as your pride requires.',
      ],
      [['ctaLabel'], 'See how takes work', 'More on takes'],
    ],
  },
  {
    type: 'csJourneyBlock',
    nth: 0,
    edits: [
      [['heading'], 'Six steps, about four minutes', 'Six steps, about four minutes, start to sent'],
      [
        ['intro'],
        'From a blank script to a file you can send. No export queue, no desktop step, no second person holding anything.',
        'From a blank page to a video you can send. You won’t need a laptop, an export queue, or a friend holding the phone.',
      ],
    ],
  },
  {
    type: 'csContrastBlock',
    nth: 0,
    edits: [
      [['heading'], 'A phone on a stack of books, or this', 'The old way, and the lit way'],
      [['leftLabel'], 'The usual way', 'The old way'],
      [
        ['rows', 0, 'left'],
        'Script taped below the lens, eyeline low',
        'Script taped below the lens, eyes on the floor',
      ],
      [
        ['rows', 0, 'right'],
        'Script beside the lens, eyeline correct',
        'Script right under the camera, eyes on your audience',
      ],
      [['rows', 1, 'left'], 'Eleven takes, each one slightly worse', 'Eleven takes, each a little worse than the last'],
      [['rows', 1, 'right'], 'One or two takes, both kept', 'One or two takes, and you keep both'],
      [['rows', 2, 'left'], 'Back to the top after every slip', 'Back to the top after every flub'],
      [['rows', 3, 'left'], 'Whole thing takes an afternoon', 'Somehow it eats the whole afternoon'],
      [['rows', 3, 'right'], 'Posted before the coffee goes cold', 'Posted before your coffee goes cold'],
    ],
  },
  {
    type: 'csPlansBlock',
    nth: 0,
    edits: [
      [['heading'], 'Try it free, then pick a plan', 'Free for a week. Then pick a plan.'],
      [
        ['intro'],
        'Seven days free. Everything is unlocked during the trial, including export at full quality.',
        'Seven days free with everything unlocked, full-quality export included. Take it for a spin before you spend a cent.',
      ],
      [['plans', 0, 'ctaLabel'], 'Start the free week', 'Start my free week'],
      [['plans', 1, 'ctaLabel'], 'Start the free week', 'Start my free week'],
    ],
  },
  {
    type: 'csRequirementsBlock',
    nth: 0,
    edits: [
      [
        ['items', 0, 'value'],
        'Any iPhone that runs iOS 18 or later.',
        'Any iPhone or iPad that runs iOS 27 or iPadOS 27 or later.',
      ],
      [['items', 1, 'value'], 'iOS 18 or later.', 'iOS 27 or iPadOS 27, or later.'],
      [['items', 2, 'value'], 'About 60 MB, plus room for your takes.', 'About 60 MB, plus room for all your takes.'],
      [['items', 3, 'value'], 'English at launch. More as we go.', 'English for now. More languages on the way.'],
    ],
  },
  {
    type: 'csFaqBlock',
    nth: 0,
    edits: [
      [['heading'], 'Questions people ask first', 'Fair questions'],
      // The app never needed a folding phone, so the page stops raising it.
      [['items', 0, 'question'], 'Do I need a folding phone?', 'What do I need to run it?'],
      [
        ['items', 0, 'answer'],
        'No. Cuelit runs on any iPhone with iOS 18 or later, and the script always sits right under the front camera.',
        'An iPhone or iPad running iOS 27 or iPadOS 27 or later. That’s the whole list.',
      ],
      [
        ['items', 1, 'answer'],
        'Yes, at the speed you set, from 100 to 200 words a minute. Pause, resume or restart whenever you like.',
        'Yep, at whatever speed you set, from 100 to 200 words a minute. Pause, resume or restart whenever you like.',
      ],
      [
        ['items', 2, 'answer'],
        'On your iPhone, in Cuelit, until you delete them. Nothing is ever uploaded. Save a take to Photos when you want it somewhere else.',
        'On your device, inside Cuelit, until you delete them. Nothing gets uploaded, ever. When you want a take somewhere else, save it to Photos.',
      ],
      [
        ['items', 3, 'answer'],
        'Not yet. Recording is portrait only, which keeps the script right under the camera.',
        'Not yet. Recording is portrait only, which keeps your script right under the camera where it belongs.',
      ],
      [['outroTail'], 'and a person answers.', 'and a real human writes back.'],
      [['outroLinkHref'], 'mailto:hello@cuelit.app', 'mailto:support@cuelit.app'],
    ],
  },
  {
    type: 'csAppCtaBlock',
    nth: 0,
    edits: [
      [['heading'], 'Say it once, and get on with your day.', 'Your lines, lit. Your afternoon, free.'],
      [
        ['body'],
        'Read at the lens, keep the good take, send it.',
        'Ready when you are. Hit record, keep the take you like, and send it off.',
      ],
      [['qualifier'], 'Requires an iPhone running iOS 18 or later', QUALIFIER],
    ],
  },
];

/** Journey stage summaries (csJourneyStage docs, referenced by the journey block). */
const STAGE_EDITS: Record<string, Edit[]> = {
  write: [
    [
      ['summary'],
      'Type it, paste it, or bring in the notes you already had.',
      'Type it, paste it, or rescue it from your Notes app.',
    ],
  ],
  unfold: [
    [
      ['summary'],
      'Prop the phone at eye level. Your script starts right under the camera.',
      'Prop the phone up at eye level. Your script lines up right under the camera.',
    ],
  ],
  preflight: [
    [
      ['summary'],
      'Framing, speed, text size. See your first line where it’ll sit, then tap Record.',
      'Check framing, speed and text size. See your first line where it’ll sit, then tap Record.',
    ],
  ],
  record: [
    [
      ['summary'],
      'Three, two, one. The screen holds your words, the clock and Stop.',
      'Three, two, one, you’re on. The screen shows your words, the clock and Stop.',
    ],
  ],
  cut: [
    [
      ['summary'],
      'Play it back. Keep the good one, or go again with the same settings.',
      'Watch it back. Keep it, or go again with the same settings.',
    ],
  ],
  share: [
    [
      ['summary'],
      'Save it to Photos at full quality, then post it wherever you like.',
      'Save it to Photos at full quality and post it wherever your people are.',
    ],
  ],
};

type Doc = Record<string, unknown> & { _id: string; _rev: string; _type: string };

function getAt(root: unknown, path: Path): unknown {
  let cur = root;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

function setAt(root: unknown, path: Path, value: string): void {
  let cur = root as Record<string | number, unknown>;
  for (const seg of path.slice(0, -1)) cur = cur[seg] as Record<string | number, unknown>;
  cur[path[path.length - 1]!] = value;
}

const skipped: string[] = [];
const overwritten: string[] = [];

/** Applies edits to `target` in place. Returns how many fields changed. */
function applyEdits(target: unknown, edits: Edit[], label: string): number {
  let changed = 0;
  for (const [path, from, to] of edits) {
    const where = `${label}.${path.join('.')}`;
    const raw = getAt(target, path);
    // An expected value of '' means the field is new and should be absent.
    const live = from === '' && (raw === undefined || raw === null) ? '' : raw;
    if (live === to) continue; // already applied
    if (typeof live !== 'string') {
      skipped.push(`${where}: field missing`);
      continue;
    }
    if (live !== from) {
      if (!overwriteChanged) {
        skipped.push(`${where}: live value differs\n      live: ${live}`);
        continue;
      }
      overwritten.push(`${where}\n      was: ${live}`);
    }
    setAt(target, path, to);
    changed += 1;
  }
  return changed;
}

async function main() {
  const client = createWriteClient({ dataset });

  const site = await client.fetch<Doc | null>(
    `*[_type=="csSite" && siteKey==$key && !(_id in path("drafts.**"))][0]`,
    { key: SITE_KEY },
  );
  if (!site) {
    console.log(`No csSite with siteKey "${SITE_KEY}" in "${dataset}".`);
    return;
  }
  const home = await client.fetch<Doc | null>(
    `*[_type=="csPage" && slug.current=="home" && site._ref==$id && !(_id in path("drafts.**"))][0]`,
    { id: site._id },
  );
  if (!home) {
    console.log(`No home csPage for ${site._id} in "${dataset}".`);
    return;
  }
  const stages = await client.fetch<Doc[]>(
    `*[_type=="csJourneyStage" && site._ref==$id && !(_id in path("drafts.**"))]`,
    { id: site._id },
  );
  const drafts = await client.fetch<string[]>(
    `*[_id in path("drafts.**") && (_id in $ids || references($id))]._id`,
    { id: site._id, ids: [`drafts.${site._id}`] },
  );

  const patches: Array<{ id: string; rev: string; set: Record<string, unknown> }> = [];
  mkdirSync(outDir, { recursive: true });

  function stage(before: Doc, after: Doc, fields: string[]) {
    const set: Record<string, unknown> = {};
    for (const f of fields) if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) set[f] = after[f];
    if (Object.keys(set).length === 0) return;
    patches.push({ id: before._id, rev: before._rev, set });
    writeFileSync(join(outDir, `${before._id}.before.json`), JSON.stringify(before, null, 2));
    writeFileSync(join(outDir, `${before._id}.after.json`), JSON.stringify(after, null, 2));
  }

  // csSite
  const siteAfter = structuredClone(site);
  applyEdits(siteAfter, SITE_EDITS, 'site');
  stage(site, siteAfter, ['tagline', 'mobileBar', 'seo']);

  // home csPage
  const homeAfter = structuredClone(home);
  applyEdits(homeAfter, PAGE_EDITS, 'home');
  const blocks = (homeAfter.pageBuilder ?? []) as Array<Record<string, unknown>>;
  for (const { type, nth, edits } of BLOCK_EDITS) {
    const block = blocks.filter((b) => b._type === type)[nth];
    const label = `home.${type}[${nth}]`;
    if (!block) {
      skipped.push(`${label}: block not on the page`);
      continue;
    }
    applyEdits(block, edits, label);
  }
  stage(home, homeAfter, ['seo', 'pageBuilder']);

  // journey stages
  for (const [slug, edits] of Object.entries(STAGE_EDITS)) {
    const doc = stages.find((s) => s._id.endsWith(`-${slug}`));
    if (!doc) {
      skipped.push(`stage ${slug}: document missing`);
      continue;
    }
    const after = structuredClone(doc);
    applyEdits(after, edits, doc._id);
    stage(doc, after, ['summary']);
  }

  console.log(`Dataset: ${dataset}${dryRun ? ' (dry run)' : ''}${overwriteChanged ? ' (overwrite-changed)' : ''}`);
  console.log(`${patches.length} documents to patch:`);
  for (const p of patches) console.log(`  - ${p.id}: ${Object.keys(p.set).join(', ')}`);
  if (overwritten.length) {
    console.log(`\nOverwritten although the live value differed:`);
    for (const o of overwritten) console.log(`  - ${o}`);
  }
  if (skipped.length) {
    console.log(`\nSkipped (review by hand, or re-run with --overwrite-changed):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (drafts.length) {
    console.log(`\nDrafts NOT patched (publish or discard in Studio, then re-run):`);
    for (const d of drafts) console.log(`  - ${d}`);
  }
  console.log(`\nBefore/after JSON: ${outDir}`);

  if (dryRun || patches.length === 0) return;
  const tx = client.transaction();
  for (const p of patches) tx.patch(p.id, (patch) => patch.ifRevisionId(p.rev).set(p.set));
  const result = await tx.commit();
  console.log(`Committed transaction ${result.transactionId}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
