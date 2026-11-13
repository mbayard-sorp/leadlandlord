/**
 * One-off content patch that brings the App Store listing artwork (Nov 2026)
 * onto the Cuelit site. It patches the live documents in place; it does NOT
 * re-seed, because production has Studio edits the seed does not carry.
 *
 *   pnpm tsx scripts/patch-cuelit-store-artwork.ts --dataset development --dry-run
 *   pnpm tsx scripts/patch-cuelit-store-artwork.ts --dataset development
 *
 * The files live in scripts/assets/cuelit/. The screens are renders of the
 * App Store artboards ("Cuelit App Store Graphics"), cropped to the screen
 * with no bezel and no headline; the photographs are the listing's lifestyle
 * shots, resized.
 *
 * What it sets:
 *   - csSite.ogImage -> the "Your lines, lit." header art, 1200 x 630
 *   - home hero: `device` -> iPad pre-flight behind an iPhone prompter. The
 *     fold preview strings stay on the block as the fallback.
 *   - home intro: `media` -> the ring-light photograph, at full resolution
 *   - home prompter band: `image` -> the eye-level photograph, which replaces
 *     the folding-phone shot
 *   - home showcases: both switch to `visual: 'screen'`. The first gets the
 *     iPhone library screen, the second the iPhone review screen. Their
 *     `takes` and `editor` values stay in place, unused.
 *   - the five feature pages: `heroImage` and `cardImage` -> an iPad screen
 *
 * Copy is not touched. Every write is guarded by the revision read at the
 * start of the run (ifRevisionId), so a Studio edit made mid-run rejects the
 * transaction and nothing is written. The run stops before writing if the
 * home page is not shaped as expected (one hero, one media intro, one
 * prompter band, two showcases) or if a draft of a target document exists:
 * publish or discard it in Studio first.
 *
 * Re-running is safe: Sanity dedupes uploads by content hash and a document
 * that already carries these values is skipped.
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
  console.error('Usage: patch-cuelit-store-artwork.ts --dataset development|production [--dry-run] [--out <dir>]');
  process.exit(1);
}
const dryRun = Boolean(args['dry-run']);
const outDir = args.out ?? join(tmpdir(), 'patch-cuelit-store-artwork');

const SITE_KEY = 'cuelit';
const ASSET_DIR = resolve(__dirname, 'assets', 'cuelit');

const FILES = {
  og: 'og-your-lines-lit.jpg',
  hero: 'hero-devices.png',
  ringlight: 'presenter-ringlight.jpg',
  eyelevel: 'presenter-eyelevel.jpg',
  iphoneLibrary: 'screen-iphone-library.png',
  iphoneReview: 'screen-iphone-review.jpg',
  ipadPrompter: 'screen-ipad-prompter.png',
  ipadPreflight: 'screen-ipad-preflight.jpg',
  ipadEdit: 'screen-ipad-edit.jpg',
  ipadLibrary: 'screen-ipad-library.png',
  ipadReview: 'screen-ipad-review.jpg',
} as const;
type FileKey = keyof typeof FILES;

/** Feature page slug -> the iPad screen it shows, and what that screen is. */
const FEATURE_SCREENS: Record<string, { file: FileKey; alt: string }> = {
  prompter: {
    file: 'ipadPrompter',
    alt: 'The Cuelit prompter on iPad while recording, with the current line lit at the top of the screen',
  },
  recording: {
    file: 'ipadPreflight',
    alt: 'The Cuelit pre-flight screen on iPad, with the presenter framed and the scroll speed set to 150 words a minute',
  },
  editing: {
    file: 'ipadEdit',
    alt: 'The Cuelit editor on iPad, with three takes on a timeline under the preview',
  },
  library: {
    file: 'ipadLibrary',
    alt: 'The Cuelit script library on iPad, with six scripts listed beside the one that is open',
  },
  export: {
    file: 'ipadReview',
    alt: 'The Cuelit review screen on iPad, with three takes and a Save to Photos button',
  },
};

/** JSON with sorted keys: Sanity returns object keys in its own order, so a
 *  plain stringify would call an unchanged value changed. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

type Hotspot = { x: number; y: number; width: number; height: number };
type Block = Record<string, unknown> & { _type: string; _key: string };
type Doc = Record<string, unknown> & { _id: string; _rev: string; _type: string };

async function main() {
  const client = createWriteClient({ dataset });

  for (const filename of Object.values(FILES)) {
    if (!existsSync(join(ASSET_DIR, filename))) throw new Error(`Missing asset ${join(ASSET_DIR, filename)}`);
  }

  const site = await client.fetch<Doc | null>(
    `*[_type=="csSite" && siteKey==$key && !(_id in path("drafts.**"))][0]`,
    { key: SITE_KEY },
  );
  if (!site) throw new Error(`No csSite with siteKey "${SITE_KEY}" in "${dataset}".`);
  const home = await client.fetch<Doc | null>(
    `*[_type=="csPage" && site._ref==$id && slug.current=="home" && !(_id in path("drafts.**"))][0]`,
    { id: site._id },
  );
  if (!home) throw new Error('No published home page for the site.');
  const features = await client.fetch<Array<Doc & { slug?: { current?: string } }>>(
    `*[_type=="csPracticeArea" && site._ref==$id && slug.current in $slugs && !(_id in path("drafts.**"))]`,
    { id: site._id, slugs: Object.keys(FEATURE_SCREENS) },
  );
  const missing = Object.keys(FEATURE_SCREENS).filter((slug) => !features.some((f) => f.slug?.current === slug));
  if (missing.length) throw new Error(`Feature pages not found: ${missing.join(', ')}`);

  const targets: Doc[] = [site, home, ...features];
  const drafts = await client.fetch<string[]>(`*[_id in $ids]._id`, { ids: targets.map((d) => `drafts.${d._id}`) });
  if (drafts.length) {
    throw new Error(`Drafts exist; publish or discard them in Studio, then re-run:\n  ${drafts.join('\n  ')}`);
  }

  const blocks = (home.pageBuilder as Block[] | undefined) ?? [];
  const only = (type: string, test: (b: Block) => boolean = () => true): Block => {
    const found = blocks.filter((b) => b._type === type && test(b));
    if (found.length !== 1) throw new Error(`Expected one ${type} on the home page, found ${found.length}.`);
    return found[0]!;
  };
  const hero = only('csAppHeroBlock');
  const intro = only('csIntroBlock', (b) => b.layout === 'media');
  const band = only('csPrompterBandBlock');
  const showcases = blocks.filter((b) => b._type === 'csDeviceShowcaseBlock');
  if (showcases.length !== 2) throw new Error(`Expected two csDeviceShowcaseBlock on the home page, found ${showcases.length}.`);

  // Uploads once per file; a dry run uses a placeholder ref so the output
  // still shows the shape.
  const refs = new Map<FileKey, string>();
  async function image(key: FileKey, alt?: string, hotspot?: Hotspot) {
    let ref = refs.get(key);
    if (!ref) {
      const filename = FILES[key];
      ref = dryRun
        ? `dry-run:${filename}`
        : (await client.assets.upload('image', createReadStream(join(ASSET_DIR, filename)), { filename }))._id;
      refs.set(key, ref);
    }
    return {
      _type: 'image',
      asset: { _type: 'reference', _ref: ref },
      ...(alt ? { alt } : {}),
      ...(hotspot ? { hotspot: { _type: 'sanity.imageHotspot', ...hotspot } } : {}),
    };
  }

  const nextBlocks: Block[] = [];
  for (const block of blocks) {
    if (block === hero) {
      nextBlocks.push({
        ...block,
        device: await image(
          'hero',
          'Cuelit on an iPad and an iPhone: the pre-flight screen framing the presenter, and the prompter mid-recording with the current line lit',
        ),
      });
    } else if (block === intro) {
      nextBlocks.push({
        ...block,
        media: await image(
          'ringlight',
          'Presenter talking to a phone on a tripod with a ring light, eyes on the lens',
          { x: 0.45, y: 0.32, width: 0.7, height: 0.5 },
        ),
      });
    } else if (block === band) {
      nextBlocks.push({
        ...block,
        image: await image(
          'eyelevel',
          'Presenter holding a phone at eye level in a bright room, reading to it with her eyes on the lens',
          { x: 0.5, y: 0.35, width: 0.9, height: 0.6 },
        ),
      });
    } else if (block === showcases[0]) {
      nextBlocks.push({
        ...block,
        visual: 'screen',
        screen: await image('iphoneLibrary', 'The Cuelit script library on iPhone, listing seven scripts and how many takes each has'),
      });
    } else if (block === showcases[1]) {
      nextBlocks.push({
        ...block,
        visual: 'screen',
        screen: await image(
          'iphoneReview',
          'The Cuelit review screen on iPhone: a kept take ready to play, three takes below it and a Save to Photos button',
        ),
      });
    } else {
      nextBlocks.push(block);
    }
  }

  const patches: Array<{ doc: Doc; set: Record<string, unknown> }> = [];
  const queue = (doc: Doc, set: Record<string, unknown>) => {
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(set)) if (stable(doc[k]) !== stable(v)) changed[k] = v;
    if (Object.keys(changed).length) patches.push({ doc, set: changed });
  };

  queue(site, { ogImage: await image('og') });
  queue(home, { pageBuilder: nextBlocks });
  for (const feature of features) {
    const screen = FEATURE_SCREENS[feature.slug!.current!]!;
    queue(feature, {
      heroImage: await image(screen.file, screen.alt),
      cardImage: await image(screen.file, screen.alt),
    });
  }

  mkdirSync(outDir, { recursive: true });
  console.log(`Dataset: ${dataset}${dryRun ? ' (dry run)' : ''}`);
  console.log(`Site: ${site._id}; ${patches.length} of ${targets.length} documents to patch.`);
  for (const p of patches) {
    console.log(`  - ${p.doc._id}: ${Object.keys(p.set).join(', ')}`);
    writeFileSync(join(outDir, `${p.doc._id}.before.json`), JSON.stringify(p.doc, null, 2));
    writeFileSync(join(outDir, `${p.doc._id}.after.json`), JSON.stringify({ ...p.doc, ...p.set }, null, 2));
  }
  console.log(`Before/after JSON: ${outDir}`);

  if (dryRun || patches.length === 0) return;
  const tx = client.transaction();
  for (const p of patches) tx.patch(p.doc._id, (patch) => patch.ifRevisionId(p.doc._rev).set(p.set));
  const result = await tx.commit();
  console.log(`Committed transaction ${result.transactionId}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
