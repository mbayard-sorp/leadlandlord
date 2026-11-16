/**
 * Cuelit site pages for the resubmitted 1.0 (Nov 2026): the privacy policy
 * and support page from the app repo's docs/privacy-policy.md and
 * docs/support-page.md, plus the site-wide facts those docs settle.
 *
 *   pnpm tsx scripts/patch-cuelit-site-pages.ts --dataset production --dry-run
 *   pnpm tsx scripts/patch-cuelit-site-pages.ts --dataset production
 *
 * What it changes:
 *  - /privacy-policy: body replaced from scripts/assets/cuelit/pages/privacy-policy.md.
 *    The effective date is the day the script runs (the doc says: the publish
 *    day). Pass --effective "November 10, 2026" to pin it.
 *  - /support: rebuilt from scripts/assets/cuelit/pages/support.md as an intro,
 *    one FAQ block per section, a Privacy + Contact block and the existing
 *    support form.
 *  - /terms: unpublished (moved back to a draft, like Studio's Unpublish). The
 *    License Agreement is Apple's standard EULA, so the footer's Terms link
 *    points there. The draft keeps the old text if it is ever wanted.
 *  - Mailbox: csSite.email and leadRecipients become support@cuelit.app.
 *  - Device and OS: iPhone and iPad on iOS 27 or later, on the Features and
 *    Pricing CTAs and in the feature pages' "on your iPhone" lines.
 * The homepage voice pass is patched separately by patch-cuelit-home-voice.ts.
 *
 * Re-run on 2026-11-15 for the resubmission (see APP_SYNC_EDITS below): both
 * pages are rebuilt from the refreshed source docs, and the home, pricing and
 * feature pages drop Keep, "no watermark" and the old prices. Everything the
 * 2026-11-10 run already applied is a no-op.
 *
 * Field edits name the value they expect to replace (read from production on
 * 2026-11-10) and are skipped and reported when the live value differs. The
 * privacy and support pages are replaced whole, guarded by ifRevisionId only.
 * Drafts are reported, never patched.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
    effective: { type: 'string' },
    out: { type: 'string' },
  },
});
const dataset = args.dataset;
if (dataset !== 'development' && dataset !== 'production') {
  console.error(
    'Usage: patch-cuelit-site-pages.ts --dataset development|production [--dry-run] [--effective "Month D, YYYY"] [--out <dir>]',
  );
  process.exit(1);
}
const dryRun = Boolean(args['dry-run']);
const outDir = args.out ?? join(tmpdir(), 'patch-cuelit-site-pages');
const effectiveDate =
  args.effective ??
  new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' });

const SITE_KEY = 'cuelit';
const MAILBOX = 'support@cuelit.app';
const APPLE_EULA = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const QUALIFIER = 'For iPhone and iPad on iOS 27 or later';
const PAGES_DIR = resolve(__dirname, 'assets', 'cuelit', 'pages');

// ---------------------------------------------------------------------------
// Markdown -> Portable Text. Covers what the two source docs use: ## headings,
// "- " bullets, **bold**, [links](url). Every other non-blank line is its own
// paragraph (the docs keep each paragraph on one line).
// ---------------------------------------------------------------------------

/** Deterministic keys, so a re-run produces the same document. */
function key(...parts: string[]): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

/** Straight quotes to the curly ones the rest of the site uses. */
function typeset(text: string): string {
  return text
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/"([^"]*)"/g, '“$1”');
}

interface Span { _type: 'span'; _key: string; text: string; marks: string[] }
interface LinkDef { _type: 'link'; _key: string; href: string }
interface PTBlock {
  _type: 'block';
  _key: string;
  style: string;
  listItem?: 'bullet';
  level?: number;
  markDefs: LinkDef[];
  children: Span[];
}

function inline(text: string, blockKey: string): { children: Span[]; markDefs: LinkDef[] } {
  const children: Span[] = [];
  const markDefs: LinkDef[] = [];
  // Tokens: **bold**, [text](href), or plain runs.
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (t: string, marks: string[]) => {
    if (!t) return;
    children.push({ _type: 'span', _key: key(blockKey, String(children.length)), text: typeset(t), marks });
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index), []);
    if (m[1] !== undefined) {
      push(m[1], ['strong']);
    } else {
      const def: LinkDef = { _type: 'link', _key: key(blockKey, 'link', String(markDefs.length)), href: m[3]! };
      markDefs.push(def);
      push(m[2]!, [def._key]);
    }
    last = m.index + m[0].length;
  }
  push(text.slice(last), []);
  return { children, markDefs };
}

function ptBlock(line: string, scope: string, index: number): PTBlock {
  const k = key(scope, String(index));
  if (line.startsWith('## ')) return { _type: 'block', _key: k, style: 'h2', ...inline(line.slice(3), k) };
  if (line.startsWith('- ')) {
    return { _type: 'block', _key: k, style: 'normal', listItem: 'bullet', level: 1, ...inline(line.slice(2), k) };
  }
  // The doc's own "# Title" stays a plain first line, as on the live page.
  if (line.startsWith('# ')) return { _type: 'block', _key: k, style: 'normal', ...inline(line.slice(2), k) };
  return { _type: 'block', _key: k, style: 'normal', ...inline(line, k) };
}

function markdownToPT(md: string, scope: string): PTBlock[] {
  return md
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => ptBlock(line, scope, i));
}

/** Link text only: FAQ answers are plain strings. */
function plain(text: string): string {
  return typeset(text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
}

// ---------------------------------------------------------------------------
// Page bodies
// ---------------------------------------------------------------------------

function privacyBody(): PTBlock[] {
  const md = readFileSync(join(PAGES_DIR, 'privacy-policy.md'), 'utf8').replace('{{EFFECTIVE_DATE}}', effectiveDate);
  return markdownToPT(md, 'privacy');
}

interface SupportSection { title: string; lines: string[] }

function supportSections(): { intro: string[]; sections: SupportSection[] } {
  const md = readFileSync(join(PAGES_DIR, 'support.md'), 'utf8');
  const intro: string[] = [];
  const sections: SupportSection[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('# ')) continue;
    if (line.startsWith('## ')) sections.push({ title: line.slice(3), lines: [] });
    else if (sections.length) sections[sections.length - 1]!.lines.push(line);
    else intro.push(line);
  }
  return { intro, sections };
}

/** A section whose lines alternate **Question** / answer becomes an FAQ block. */
function faqItems(section: SupportSection): Array<{ question: string; answer: string }> | null {
  const items: Array<{ question: string; answer: string }> = [];
  for (let i = 0; i < section.lines.length; i += 2) {
    const q = /^\*\*(.+)\*\*$/.exec(section.lines[i]!);
    const a = section.lines[i + 1];
    if (!q || !a) return null;
    items.push({ question: typeset(q[1]!), answer: plain(a) });
  }
  return items.length ? items : null;
}

function supportPageBuilder(existingContactBlock: Record<string, unknown> | undefined) {
  const { intro, sections } = supportSections();
  const blocks: Array<Record<string, unknown>> = [
    { _type: 'csRichTextBlock', _key: key('support', 'intro'), content: markdownToPT(intro.join('\n'), 'support-intro') },
  ];
  const tail: string[] = [];
  for (const section of sections) {
    const items = faqItems(section);
    if (items) {
      blocks.push({
        _type: 'csFaqBlock',
        _key: key('support', 'faq', section.title),
        heading: section.title,
        items: items.map((item, i) => ({
          _type: 'csFaqItem',
          _key: key('support', section.title, String(i)),
          ...item,
        })),
      });
    } else {
      tail.push(`## ${section.title}`, ...section.lines);
    }
  }
  if (tail.length) {
    blocks.push({ _type: 'csRichTextBlock', _key: key('support', 'tail'), content: markdownToPT(tail.join('\n'), 'support-tail') });
  }
  // Keep the existing support form; only its words change.
  blocks.push({
    ...(existingContactBlock ?? { _type: 'csContactCtaBlock', _key: key('support', 'contact'), showForm: true, formVariant: 'support' }),
    heading: 'Write to us',
    body: 'Tell us which iPhone or iPad you use and your iOS version, and what you were doing when the problem happened.',
  });
  return blocks;
}

// ---------------------------------------------------------------------------
// Field edits on other documents: [path, value expected now, new value]
// ---------------------------------------------------------------------------

type Path = Array<string | number>;
type Edit = [Path, unknown, unknown];

const DOC_EDITS: Record<string, Edit[]> = {
  'cs-site-cueduo': [
    [['email'], 'hello@cuelit.app', MAILBOX],
    [['leadRecipients'], ['hello@cuelit.app'], [MAILBOX]],
  ],
  'cs-page-cueduo-features': [
    [['pageBuilder', 2, 'qualifier'], 'Requires an iPhone running iOS 18 or later', QUALIFIER],
    [
      ['seo', 'metaDescription'],
      'The prompter, recording, takes, the library and export. What Cuelit does on your iPhone.',
      'The prompter, recording, takes, the library and export. What Cuelit does on your iPhone or iPad.',
    ],
  ],
  'cs-page-cueduo-pricing': [
    [['pageBuilder', 2, 'qualifier'], 'Requires an iPhone running iOS 18 or later', QUALIFIER],
    [
      ['pageBuilder', 1, 'items', 0, 'answer'],
      'In Settings, on your phone. The plan runs to the end of the period you paid for.',
      'In the Settings app on your iPhone or iPad. The plan runs to the end of the period you paid for.',
    ],
  ],
  'cs-pa-cueduo-library': [
    [
      ['body', 3, 'children', 0, 'text'],
      'There’s no account and nothing to sign in to. Scripts and takes live in Cuelit on your iPhone and are never uploaded. When you want a take somewhere else, you save it to Photos.',
      'There’s no account and nothing to sign in to. Scripts and takes live in Cuelit on your device and are never uploaded. When you want a take somewhere else, you save it to Photos.',
    ],
    [
      ['faqs', 1, 'answer'],
      'No. Scripts and takes stay on the iPhone you made them on.',
      'No. Scripts and takes stay on the device you made them on.',
    ],
    [
      ['faqs', 6, 'answer'],
      'Your scripts and takes go with it, because they live only in Cuelit on this iPhone. Save the takes you want to Photos first.',
      'Your scripts and takes go with it, because they live only in Cuelit on this device. Save the takes you want to Photos first.',
    ],
    [
      ['seo', 'metaDescription'],
      'Plain-text scripts that keep their own takes and prompter settings. No account and no upload: everything stays on your iPhone.',
      'Plain-text scripts that keep their own takes and prompter settings. No account and no upload: everything stays on your device.',
    ],
  ],
  'cs-pa-cueduo-takes': [
    [
      ['body', 2, 'children', 0, 'text'],
      'Cuelit writes the take to your iPhone as it records. If a call comes in, the phone gets too warm, or you leave the app, everything up to that moment is kept, and Review tells you what happened.',
      'Cuelit writes the take to your device as it records. If a call comes in, the device gets too warm, or you leave the app, everything up to that moment is kept, and Review tells you what happened.',
    ],
    [['deliverables', 3], 'Written to your iPhone as you record', 'Written to your device as you record'],
  ],
  'cs-pa-cueduo-recording': [
    [
      ['faqs', 1, 'answer'],
      '4K at 30 frames per second, in HEVC. On an iPhone whose front camera can’t do 4K, it records 1080p at 30.',
      '4K at 30 frames per second, in HEVC. On a device whose front camera can’t do 4K, it records 1080p at 30.',
    ],
  ],
};

// ---------------------------------------------------------------------------
// App sync, 2026-11-15: the site said things the resubmitted app no longer
// does. Keep is gone from Review (2026-11-14), saves carry a small Cuelit mark
// in free mode and during the trial, there is a free mode, the real prices are
// $59.99 a year and $8.99 a month, the editor trims, Cuelit Pro can share, and
// iPad records in landscape. Expected values were read from production on
// 2026-11-15. New wording uses only facts from the two source docs.
// Left alone on purpose, for the owner: the home heading "Every take, kept.
// Even the weird ones." and the Takes page title "Keep every take, lose none".
// ---------------------------------------------------------------------------

const MARK_NOTE = 'Saves carry a small Cuelit mark in free mode and during the trial. A paid plan can turn it off.';
const MARK_ANSWER =
  'Saved videos carry a small Cuelit mark in free mode and during the trial. Once your plan is paid, you can turn it off in the Save menu.';
const PAID_MARK = 'A paid Cuelit Pro plan can save without the Cuelit mark.';
const TRIAL = '7-day free trial for new subscribers';
const OLD_YEARLY = ['Unlimited scripts and takes', 'Full-quality export, no watermark', 'Save to Photos at full quality'];
const NEW_YEARLY = [TRIAL, 'Unlimited scripts and takes', PAID_MARK, 'Save to Photos at full quality'];
const OLD_MONTHLY = ['Everything in Yearly', 'Cancel any month, in Settings'];
const NEW_MONTHLY = [TRIAL, 'Everything in Yearly', 'Cancel any month, in Settings'];

/** The plans block is the same shape on the home page and on /pricing. */
function planEdits(block: number): Edit[] {
  return [
    [['pageBuilder', block, 'plans', 0, 'price'], '$59', '$59.99'],
    [['pageBuilder', block, 'plans', 0, 'features'], OLD_YEARLY, NEW_YEARLY],
    [['pageBuilder', block, 'plans', 1, 'features'], OLD_MONTHLY, NEW_MONTHLY],
  ];
}

const APP_SYNC_EDITS: Record<string, Edit[]> = {
  'cs-page-cueduo-home': [
    [['pageBuilder', 3, 'items', 1, 'heading'], 'Keep the good one', 'Pick the good one'],
    [
      ['pageBuilder', 3, 'items', 1, 'body'],
      'Do as many takes as it takes. Keep the winner and save it to Photos at full quality.',
      'Do as many takes as it takes. Review each one, delete the rest, and save the good one to Photos.',
    ],
    [
      ['pageBuilder', 5, 'body'],
      'Tap Stop and your take is already waiting in Review. Watch it, keep it, or go again with the same settings, as many times as your pride requires.',
      'Tap Stop and your take is already waiting in Review. Watch it, delete it, or go again with the same settings, as many times as your pride requires.',
    ],
    [['pageBuilder', 5, 'editor', 'tools'], ['Keep', 'Delete', 'Another take'], ['Delete', 'Another take']],
    [
      ['pageBuilder', 5, 'screen', 'alt'],
      'The Cuelit review screen on iPhone: a kept take ready to play, three takes below it and a Save to Photos button',
      'The Cuelit review screen on iPhone: a take ready to play, three takes below it and a Save to Photos button',
    ],
    [['pageBuilder', 7, 'rows', 1, 'right'], 'One or two takes, and you keep both', 'One or two takes, and you like both'],
    [
      ['pageBuilder', 8, 'intro'],
      'Seven days free with everything unlocked, full-quality export included. Take it for a spin before you spend a cent.',
      `Seven days free on either plan. Take it for a spin before you spend a cent. ${MARK_NOTE}`,
    ],
    ...planEdits(8),
    [
      ['pageBuilder', 10, 'items', 3, 'answer'],
      'Not yet. Recording is portrait only, which keeps your script right under the camera where it belongs.',
      'On iPad, yes. Record in landscape and the script sits at the top of the screen, under the front camera.',
    ],
    [
      ['pageBuilder', 11, 'body'],
      'Ready when you are. Hit record, keep the take you like, and send it off.',
      'Ready when you are. Hit record, pick the take you like, and send it off.',
    ],
  ],
  'cs-stage-cueduo-cut': [
    [
      ['summary'],
      'Watch it back. Keep it, or go again with the same settings.',
      'Watch it back. Go again with the same settings if you want another.',
    ],
  ],
  'cs-page-cueduo-pricing': [
    [
      ['pageBuilder', 0, 'intro'],
      'Seven days free. Everything is unlocked during the trial, including export at full quality.',
      `Free mode records and edits the eight sample scripts, with Follow my voice. Cuelit Pro adds your own scripts (write, import, the Share sheet), Freestyle, Share and editing any take. Both plans start with seven days free. ${MARK_NOTE}`,
    ],
    ...planEdits(0),
    [
      ['pageBuilder', 1, 'items', 1, 'answer'],
      'Restore your purchase in Settings. It uses the Apple ID that bought it.',
      'Tap Restore purchase at the bottom of the subscription screen, signed in with the same Apple Account you used to subscribe.',
    ],
    [
      ['seo', 'metaDescription'],
      'Seven days free with everything unlocked, then a yearly or monthly plan. Cancel any time in Settings.',
      'Free with eight sample scripts. Cuelit Pro is $59.99 a year or $8.99 a month, each with a 7-day free trial. Cancel any time in Settings.',
    ],
  ],
  'cs-page-cueduo-features': [
    [
      ['pageBuilder', 0, 'body', 0, 'children', 0, 'text'],
      'Five things, and they all happen on the phone in your hand. Read your script at the lens, record the take, keep the good one, find it again next week, and save it at full quality.',
      'Five things, and they all happen on the phone in your hand. Read your script at the lens, record the take, pick the good one, find it again next week, and save it at full quality.',
    ],
  ],
  'cs-pa-cueduo-takes': [
    [
      ['excerpt'],
      'Record as many takes as you need, play them back one after another, and keep the one that worked. If something stops a take, what you recorded is kept.',
      'Record as many takes as you need, play them back one after another, then review each one and delete the rest. If something stops a take, what you recorded is kept.',
    ],
    [
      ['body', 0, 'children', 0, 'text'],
      'Every take lands in Review the moment you tap Stop, numbered and timed. Play it back, scrub through it, then tap Keep on the good one and delete the rest. Another take sends you straight back to the camera with the same settings.',
      'Every take lands in Review the moment you tap Stop, numbered and timed. Play it back, scrub through it, then review each one and delete the rest. Another take sends you straight back to the camera with the same settings.',
    ],
    [
      ['body', 1, 'children', 0, 'text'],
      'Your takes sit in a row under the player, each with its length and size, so going from Take 2 to Take 5 is one tap. Kept takes carry a check, so you can see at a glance which one you meant to use.',
      'Your takes sit in a row under the player, each with its length and size, so going from Take 2 to Take 5 is one tap.',
    ],
    [['deliverables', 1], 'Keep, delete, or record another', 'Delete, or record another'],
    [['faqs', 2, 'question'], 'What does Keep do?', 'How do I keep a take safe?'],
    [
      ['faqs', 2, 'answer'],
      'It marks the take you mean to use, with a check in the list. It doesn’t move or export anything, and another tap lets go of it.',
      'Tap Save to Photos in Review or in the editor. Once it’s in Photos, it’s backed up the way your other photos are.',
    ],
    [['faqs', 3, 'answer'], 'No. A take stays until you delete it, kept or not.', 'No. A take stays until you delete it.'],
    [
      ['faqs', 7, 'answer'],
      'Not in Cuelit. Save it to Photos and trim it there.',
      'Yes. Open the take in the editor and trim it there. Your original take is never changed.',
    ],
    [
      ['seo', 'metaDescription'],
      'Record as many takes as you like, compare them in one row, and keep the good one. If something stops a take, what you recorded is still there.',
      'Record as many takes as you like, compare them in one row, then review each one and delete the rest. If something stops a take, what you recorded is still there.',
    ],
  ],
  'cs-pa-cueduo-library': [
    [
      ['faqs', 7, 'answer'],
      'Yes. Each script’s Review screen shows how many takes it has, how many you’ve kept, and the space they use.',
      'Yes. Each script’s Review screen shows how many takes it has and the space they use.',
    ],
  ],
  'cs-pa-cueduo-export': [
    [
      ['excerpt'],
      'Save any take to Photos at the quality you shot it. No watermark, no re-encoding, and nothing uploaded on the way.',
      `Save any take to Photos at the resolution you shot it, with nothing uploaded on the way. ${PAID_MARK}`,
    ],
    [
      ['body', 0, 'children', 0, 'text'],
      'Pick a take in Review and tap Save to Photos. It lands in your library as the same file the camera wrote, at the resolution you recorded and with nothing added. What you saw in Review is what you get.',
      'Pick a take in Review and tap Save to Photos. It lands in your library at the resolution you recorded. In free mode and during the trial, saved videos carry a small Cuelit mark.',
    ],
    [
      ['body', 2, 'children', 0, 'text'],
      'Cuelit asks for add-only access the first time you save, so it can put takes into Photos without ever seeing the rest of your library. If you said no, Review shows you the way back to Settings.',
      'Cuelit asks for add-only access the first time you save. That permission only lets Cuelit add the video you save, and it does not let Cuelit read your library. Reading your photos is a separate, optional permission that Cuelit asks for only in the editor’s media drawer. If you said no, Review shows you the way back to Settings.',
    ],
    [
      ['body', 3, 'children', 0, 'text'],
      'A subscription unlocks the whole of Cuelit after a 7-day free trial, and export is part of it. Every take you save is the full-quality file, with no watermark and no smaller free version.',
      `You can try Cuelit free with its eight sample scripts and save those takes to Photos. ${MARK_ANSWER}`,
    ],
    [
      ['deliverables'],
      ['Save to Photos, one tap per take', 'Same file the camera wrote, no re-encode', 'Full resolution, HEVC', 'No watermark', 'Add-only Photos access', 'Nothing uploaded'],
      ['Save to Photos, one tap per take', 'Full resolution, HEVC', 'Cuelit mark off on a paid plan', 'Add-only access to save', 'Nothing uploaded'],
    ],
    [['faqs', 0, 'answer'], 'No. Every take you save is the clean file.', MARK_ANSWER],
    [
      ['faqs', 2, 'answer'],
      'Not from Cuelit itself. Save the take to Photos, then share it from there to any app you use.',
      'With Cuelit Pro, yes. Share an edited video from the editor through Apple’s share sheet. In free mode, save the take to Photos and share it from there.',
    ],
    [
      ['faqs', 5, 'answer'],
      'To add your take. It asks for add-only access the first time you save, and never sees the rest of your library.',
      'To add your take. It asks for add-only access the first time you save, and that permission does not let Cuelit read your library. The editor’s media drawer asks separately, and only if you open its Images or Video tab.',
    ],
    [
      ['faqs', 7, 'answer'],
      'You need one to use Cuelit, and it starts with a 7-day free trial. Every plan includes everything, export too.',
      'No. In free mode you can record the eight sample scripts and save those takes to Photos. Cuelit Pro adds your own scripts, and both plans start with a 7-day free trial for new subscribers.',
    ],
    [
      ['seo', 'metaDescription'],
      'Save any take to Photos as the same file the camera wrote. No watermark, no re-encoding, and nothing uploaded along the way.',
      `Save any take to Photos at the resolution you shot it, with nothing uploaded along the way. ${PAID_MARK}`,
    ],
  ],
};

/** Both tables, one list per document, older edits first. */
const ALL_EDITS: Record<string, Edit[]> = {};
for (const table of [DOC_EDITS, APP_SYNC_EDITS]) {
  for (const [id, edits] of Object.entries(table)) (ALL_EDITS[id] ??= []).push(...edits);
}

/** Footer Terms links move to Apple's standard EULA, matched by href. */
function retargetTerms(links: unknown): unknown {
  if (!Array.isArray(links)) return links;
  return links.map((l) => (l && typeof l === 'object' && (l as { href?: string }).href === '/terms' ? { ...l, href: APPLE_EULA } : l));
}

// ---------------------------------------------------------------------------

type Doc = Record<string, unknown> & { _id: string; _rev: string; _type: string };

function getAt(root: unknown, path: Path): unknown {
  let cur = root;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}
function setAt(root: unknown, path: Path, value: unknown): void {
  let cur = root as Record<string | number, unknown>;
  for (const seg of path.slice(0, -1)) cur = cur[seg] as Record<string | number, unknown>;
  cur[path[path.length - 1]!] = value;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
  const docs = await client.fetch<Doc[]>(`*[(_id==$id || references($id)) && !(_id in path("drafts.**"))]`, { id: site._id });
  const drafts = await client.fetch<string[]>(`*[_id in path("drafts.**") && (_id == $draft || references($id))]._id`, {
    id: site._id,
    draft: `drafts.${site._id}`,
  });
  const bySlug = (slug: string) =>
    docs.find((d) => d._type === 'csPage' && (d.slug as { current?: string } | undefined)?.current === slug);

  const patches: Array<{ id: string; rev: string; set: Record<string, unknown> }> = [];
  const skipped: string[] = [];
  let unpublish: Doc | undefined;
  mkdirSync(outDir, { recursive: true });

  function stage(before: Doc, after: Doc) {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(after)) {
      if (k.startsWith('_')) continue;
      if (!same(before[k], v)) set[k] = v;
    }
    if (!Object.keys(set).length) return;
    patches.push({ id: before._id, rev: before._rev, set });
    writeFileSync(join(outDir, `${before._id}.before.json`), JSON.stringify(before, null, 2));
    writeFileSync(join(outDir, `${before._id}.after.json`), JSON.stringify(after, null, 2));
  }
  const now = new Date().toISOString();

  // Privacy policy
  const privacy = bySlug('privacy-policy');
  if (!privacy) skipped.push('/privacy-policy: page missing');
  else {
    const after = structuredClone(privacy);
    const blocks = (after.pageBuilder ?? []) as Array<Record<string, unknown>>;
    const rich = blocks.find((b) => b._type === 'csRichTextBlock');
    if (!rich || blocks.length !== 1) skipped.push('/privacy-policy: expected exactly one rich text block');
    else {
      rich.content = privacyBody();
      after.seo = {
        ...(after.seo as object),
        metaDescription:
          'How Cuelit handles your data. There’s no account and no upload: your videos, scripts and voice stay on your device.',
      };
      after.modifiedAt = now;
      stage(privacy, after);
    }
  }

  // Support
  const support = bySlug('support');
  if (!support) skipped.push('/support: page missing');
  else {
    const after = structuredClone(support);
    const contact = ((after.pageBuilder ?? []) as Array<Record<string, unknown>>).find((b) => b._type === 'csContactCtaBlock');
    after.pageBuilder = supportPageBuilder(contact);
    after.seo = {
      ...(after.seo as object),
      metaDescription:
        'Answers to common questions about Cuelit, the teleprompter and recorder for iPhone and iPad, and how to reach us. We usually reply within two business days.',
    };
    after.modifiedAt = now;
    stage(support, after);
  }

  // Terms -> unpublished; footer links -> Apple's EULA
  unpublish = bySlug('terms');
  const siteAfter = structuredClone(site);
  siteAfter.footerColumns = Array.isArray(site.footerColumns)
    ? (site.footerColumns as Array<Record<string, unknown>>).map((c) => ({ ...c, links: retargetTerms(c.links) }))
    : site.footerColumns;
  siteAfter.footerNav = retargetTerms(site.footerNav);

  // Field edits
  for (const [id, edits] of Object.entries(ALL_EDITS)) {
    const doc = id === site._id ? undefined : docs.find((d) => d._id === id);
    if (id !== site._id && !doc) {
      skipped.push(`${id}: document missing`);
      continue;
    }
    const target = id === site._id ? siteAfter : structuredClone(doc!);
    for (const [path, from, to] of edits) {
      const live = getAt(target, path);
      if (same(live, to)) continue;
      if (!same(live, from)) {
        skipped.push(`${id}.${path.join('.')}: live value differs\n      live: ${JSON.stringify(live)}`);
        continue;
      }
      setAt(target, path, to);
    }
    if (doc) stage(doc, target);
  }
  stage(site, siteAfter);

  console.log(`Dataset: ${dataset}${dryRun ? ' (dry run)' : ''}. Privacy effective date: ${effectiveDate}`);
  console.log(`${patches.length} documents to patch:`);
  for (const p of patches) console.log(`  - ${p.id}: ${Object.keys(p.set).join(', ')}`);
  console.log(unpublish ? `Unpublish: ${unpublish._id} (/terms), kept as a draft` : 'Unpublish: /terms already unpublished');
  if (skipped.length) {
    console.log(`\nSkipped (review by hand):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (drafts.length) {
    console.log(`\nDrafts NOT patched (publish or discard in Studio, then re-run):`);
    for (const d of drafts) console.log(`  - ${d}`);
  }
  console.log(`\nBefore/after JSON: ${outDir}`);

  if (dryRun) return;
  const tx = client.transaction();
  for (const p of patches) tx.patch(p.id, (patch) => patch.ifRevisionId(p.rev).set(p.set));
  if (unpublish) {
    const { _rev, _createdAt, _updatedAt, _system, ...content } = unpublish;
    void _rev;
    void _createdAt;
    void _updatedAt;
    void _system;
    tx.createIfNotExists({ ...content, _id: `drafts.${unpublish._id}` });
    // A no-op set guarded by the revision read above, so a Studio edit made
    // mid-run rejects the whole transaction before the delete.
    tx.patch(unpublish._id, (patch) => patch.ifRevisionId(unpublish!._rev).set({ title: unpublish!.title }));
    tx.delete(unpublish._id);
  }
  const result = await tx.commit();
  console.log(`Committed transaction ${result.transactionId}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
