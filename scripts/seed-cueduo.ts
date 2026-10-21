#!/usr/bin/env -S tsx
/**
 * Seed CueDuo (Custom Sites site #3, siteKey `cueduo`) into Sanity.
 *
 * Every string here comes from the approved design in Claude Design
 * (`CueDuo Web - Home v3.dc.html`) and the CueDuo brand guide v1.1. Nothing is
 * paraphrased and nothing is invented: the brand's register has no hype
 * setting, and the guide already supplies the positioning paragraph, the four
 * feature titles and bodies, and the App Store headlines.
 *
 * Mirrors scripts/seed-aligned-advisors.ts's conventions: env-file walk
 * (worktree-safe), --dataset required (never from env), --dry-run writes JSON
 * instead of touching the network, subpath-only imports from
 * @leadlandlord/sanity-schema, deterministic doc ids, and dependency-ordered
 * createOrReplace transaction chunks (idempotent re-runs).
 *
 * Content decisions:
 *  - Images come from scripts/assets/cueduo/ and are uploaded through the
 *    Sanity assets API (content-hash deduped, so re-runs reuse the same asset).
 *    --dry-run skips the upload and writes placeholder asset refs so the JSON
 *    shows the field shapes. The real half-open device render and the app
 *    screens do not exist yet; the viewfinder photo stands in for the Take 3
 *    thumbnail and the editor frame.
 *  - Prices are the design's placeholders and are marked as such in the
 *    block's own footnote, on the page, where a reader sees it.
 *  - No testimonials, badges, stat rail or publications: there are no real
 *    attributed reviews, no press coverage and no releases yet, and this line
 *    does not ship placeholder social proof.
 *  - storeState is 'soon' everywhere. The App Store URL does not exist, so the
 *    CTA is a statement, not a dead link.
 *  - robotsDisallow stays true (ADR 0033 D6) — noindexed until DNS cutover.
 *
 * Usage:
 *   pnpm seed-cueduo --dataset development [--dry-run] [--out <dir>]
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';

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
const envFile = findEnvFile(__dirname, '.env');
if (envFile) loadEnv({ path: envFile, override: true });

// Subpath imports only — the package root pulls in Studio-only code that
// can't load under plain tsx.
import { createWriteClient } from '@leadlandlord/sanity-schema/client';
import {
  csSiteDocId,
  csPageDocId,
  csPracticeAreaDocId,
  csJourneyStageDocId,
} from '@leadlandlord/sanity-schema/ids';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    dataset: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

const dataset = args.dataset;
if (dataset !== 'development' && dataset !== 'production') {
  console.error('Usage: seed-cueduo.ts --dataset development|production [--dry-run] [--out <dir>]');
  process.exit(1);
}
const dryRun = Boolean(args['dry-run']);
const outDir = (args.out as string | undefined) ?? join(tmpdir(), 'seed-cueduo-dry-run');

// ---------------------------------------------------------------------------
// Site constants
// ---------------------------------------------------------------------------

const SITE_KEY = 'cueduo';
const SITE_NAME = 'CueDuo';
const SITE_ID = csSiteDocId(SITE_KEY);
const siteRef = { _type: 'reference' as const, _ref: SITE_ID };

const QUALIFIER = 'Requires a folding phone running iOS 18 or later';

/** Shown as "Last updated" on /privacy and /terms. Bump it whenever either
 *  body changes — compliance reviewers look for this line. */
const LEGAL_LAST_UPDATED = '2026-09-21T00:00:00Z';

let keyCounter = 0;
function k(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${keyCounter}`;
}

interface PTBlock {
  _type: 'block';
  _key: string;
  style: string;
  markDefs: unknown[];
  children: Array<{ _type: 'span'; _key: string; text: string; marks: string[] }>;
}

function ptBlock(text: string, style = 'normal'): PTBlock {
  return {
    _type: 'block',
    _key: k('b'),
    style,
    markDefs: [],
    children: [{ _type: 'span', _key: k('s'), text, marks: [] }],
  };
}

// ---------------------------------------------------------------------------
// Images. Uploaded once per run (Sanity dedupes by content hash); dry runs
// skip the network and use placeholder refs so the output shows the shape.
// ---------------------------------------------------------------------------

const ASSET_DIR = resolve(__dirname, 'assets', 'cueduo');

const IMAGE_FILES = {
  viewfinder: 'presenter-viewfinder.jpg',
  tripod: 'presenter-tripod.jpg',
  duo: 'presenter-duo-halfopen.jpg',
  mark: 'cueduo-mark.svg',
} as const;
type ImageKey = keyof typeof IMAGE_FILES;
type AssetIds = Record<ImageKey, string>;

type WriteClient = ReturnType<typeof createWriteClient>;

async function uploadImages(client: WriteClient | null): Promise<AssetIds> {
  const ids = {} as AssetIds;
  for (const key of Object.keys(IMAGE_FILES) as ImageKey[]) {
    const filename = IMAGE_FILES[key];
    const path = join(ASSET_DIR, filename);
    if (!existsSync(path)) throw new Error(`Missing asset ${path}`);
    if (!client) {
      ids[key] = `image-dry-run-${key}`;
      continue;
    }
    const asset = await client.assets.upload('image', createReadStream(path), { filename });
    ids[key] = asset._id;
  }
  return ids;
}

/** Hotspot centred on the upper third, where the presenter's face sits. */
const FACE_HOTSPOT = { _type: 'sanity.imageHotspot', x: 0.5, y: 0.3, width: 0.8, height: 0.5 };

function imageValue(assetId: string, alt?: string, hotspot?: typeof FACE_HOTSPOT) {
  return {
    _type: 'image' as const,
    asset: { _type: 'reference' as const, _ref: assetId },
    ...(alt ? { alt } : {}),
    ...(hotspot ? { hotspot } : {}),
  };
}

// ---------------------------------------------------------------------------
// Journey stages — "How a take happens". Section-only: the registry has
// journeyPages: false for this site, so JourneyBlock renders them unlinked.
// ---------------------------------------------------------------------------

const STAGES = [
  { slug: 'write', title: 'Write', summary: 'Type it, paste it, or bring in the notes you already had.' },
  { slug: 'unfold', title: 'Unfold', summary: 'Open the phone. The script moves to the screen beside the lens.' },
  { slug: 'preflight', title: 'Preflight', summary: 'Framing, sound, text size. Fix it now, not in the edit.' },
  { slug: 'record', title: 'Record', summary: 'Three, two, one. The outer screen holds the words and the clock.' },
  { slug: 'cut', title: 'Cut', summary: 'Trim, title, photo. Keep the take you like and the one you’re unsure about.' },
  { slug: 'share', title: 'Share', summary: 'Post it, save the full-quality file, or send a link.' },
];

// ---------------------------------------------------------------------------
// Feature pages (csPracticeArea) — the /features index and its detail pages.
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    slug: 'prompter',
    title: 'The prompter',
    excerpt:
      'White Semibold on near-black, on the screen beside the lens. The line you’re on at full strength, the ones around it at 35 per cent.',
    body: [
      'The prompter lives on the outer display, next to the camera. That is the whole idea: you read at the lens instead of below it, and nobody watching can tell you are reading at all.',
      'Scrolling follows your voice. Stop to think and it stops with you. You can also set a fixed speed if you would rather drive it yourself.',
      'Four text sizes, stepping 24 to 44 points, chosen at the distance you will actually stand.',
    ],
  },
  {
    slug: 'recording',
    title: 'Recording',
    excerpt: 'Preflight first, then three, two, one. During a take the outer screen holds the words, the clock and nothing else.',
    body: [
      'Preflight checks the three things that ruin a take: framing, sound and text size. Fixing them takes a few seconds and saves the edit.',
      'Once the count finishes, the outer screen shows your script, the elapsed time and the record state. Everything else gets out of the way.',
    ],
  },
  {
    slug: 'editing',
    title: 'Editing',
    excerpt: 'Trim the top and tail, drop a title card in front, add a photo of the thing you’re talking about.',
    body: [
      'Editing happens on the inner display, in the same session as the take. There is no export queue and no desktop step.',
      'Takes, photos and titles are all clips you can reorder. Transitions belong to the clip they lead out of, so moving something never breaks the one after it.',
    ],
  },
  {
    slug: 'library',
    title: 'The library',
    excerpt: 'Scripts keep their takes. Come back a week later, read the same lines again, and compare the two before you send one.',
    body: [
      'Every script holds every take you have recorded from it, until you delete them.',
      'Nothing is uploaded. Takes live on your phone, in the app, and leave it only when you share one.',
    ],
  },
  {
    slug: 'export',
    title: 'Export and share',
    excerpt: 'Post it, save the full-quality file, or send a link. Export is the part a plan unlocks.',
    body: [
      'Share straight to the app you were going to post in, or save the full-quality file and do it later.',
      'Export at full quality with no watermark is what a plan pays for. Everything up to that point is free.',
    ],
  },
];

// ---------------------------------------------------------------------------
// The home page, block by block, in page-builder order. Reorder in Studio and
// the page reorders: nothing here depends on its neighbours.
// ---------------------------------------------------------------------------

/** The library mock. The design's photo card shows only its flag and duration;
 *  Studio requires a label, so it is "Take 3" to match the thumbnail alt. */
const LIBRARY_TAKES = [
  { label: 'Take 01', duration: '01:14' },
  { label: 'Take 02', duration: '00:58' },
  { label: 'Take 3', duration: '01:08', flag: 'Latest', photo: true },
  { label: 'Intro', duration: '00:21' },
  { label: 'Pitch', duration: '02:40' },
  { label: 'Thanks', duration: '00:36' },
  { label: 'Q&A', duration: '04:12' },
  { label: 'Welcome', duration: '00:48' },
] as const;

function homePageBuilder(stageRefs: Array<{ _type: 'reference'; _ref: string; _key: string }>, assets: AssetIds) {
  return [
    {
      _type: 'csAppHeroBlock',
      _key: k('blk'),
      eyebrow: 'Teleprompter and recorder',
      heading: 'Look up.\nSay it once.',
      subheading:
        'A teleprompter and recorder built for folding phones. Your script on one screen, the lens on the other, so you talk to people, not to a reflection of yourself.',
      foldPreview: {
        _type: 'csFoldPreview',
        recordLabel: 'REC',
        timecode: '00:12',
        // Camera variant: the viewfinder photo makes the preview ignore the
        // inner-pane (preflight) fields, so none are seeded.
        viewfinder: imageValue(
          assets.viewfinder,
          'Presenter in the viewfinder, looking into the lens',
          FACE_HOTSPOT,
        ),
        pastLine: 'Thanks for joining.',
        currentLine: 'Today I want to show you something we’ve been quietly building for a year.',
        nextLine: 'It starts with a question. Why do we all hate talking to a camera?',
      },
      storeState: 'soon',
      storeLabel: 'Coming to the App Store',
      qualifier: `${QUALIFIER} · Free to try, no account`,
      secondaryLabel: 'See how a take happens',
      secondaryHref: '#how-it-works',
    },
    {
      _type: 'csIntroBlock',
      _key: k('blk'),
      layout: 'media',
      topRule: true,
      media: imageValue(
        assets.tripod,
        'Presenter talking to a phone on a tripod with a ring light, eyes on the lens',
      ),
      mediaBadge: 'Eyes on the lens',
      heading: 'The words go beside the lens, not under it.',
      body: [
        ptBlock(
          'Every other prompter puts your script on the same screen you’re filming with. You read, your eyes drift down, and everyone watching can tell.',
        ),
        ptBlock(
          'A folding phone has a second screen next to the camera. CueDuo uses it. You read at the lens, the take lands on the first try, and you get your morning back.',
        ),
      ],
    },
    {
      _type: 'csPrompterBandBlock',
      _key: k('blk'),
      eyebrow: 'This is what you read from',
      pastLine: 'Hi, I’m Maya. For the last year I’ve been building something for people who hate talking to camera.',
      currentLine: 'It lets you read your script while looking straight at the person watching.',
      nextLine: 'No glance down.',
      image: imageValue(
        assets.duo,
        'Presenter holding a half-open folding phone, reading the outer screen beside the lens',
      ),
      imageCaption: 'Half-open, outer screen toward you. The camera sits right beside the words.',
      lensLabel: 'Lens',
      notes: [
        'White Semibold on near-black. The line you’re on at full strength, the ones around it at 35 per cent.',
        'Scrolling follows your voice, so a pause is just a pause.',
        'Four sizes, stepping 24 to 44 points. Chosen at the distance you’ll actually stand.',
      ],
    },
    {
      _type: 'csValuePropsBlock',
      _key: k('blk'),
      eyebrow: 'Four things it does well',
      items: [
        {
          _type: 'csValuePropItem',
          _key: k('vp'),
          icon: 'cueduo/fold',
          heading: 'Two screens, one take',
          body: 'Script on the outer display, controls on the inner. Nothing to hold, nothing to hide.',
        },
        {
          _type: 'csValuePropItem',
          _key: k('vp'),
          icon: 'cueduo/eyeline',
          heading: 'Eyes on the lens',
          body: 'The prompter sits beside the camera, so you look at your audience, not below it.',
        },
        {
          _type: 'csValuePropItem',
          _key: k('vp'),
          icon: 'cueduo/cut',
          heading: 'Cut where you stand',
          body: 'Trim takes, add a title, drop in a photo. Export without leaving the app.',
        },
        {
          _type: 'csValuePropItem',
          _key: k('vp'),
          icon: 'cueduo/pace',
          heading: 'Your pace, not ours',
          body: 'Scrolling follows your voice. Pause and it waits with you.',
        },
      ],
    },
    {
      _type: 'csDeviceShowcaseBlock',
      _key: k('blk'),
      eyebrow: 'Library',
      heading: 'Every take, kept.',
      body: 'Scripts keep their takes. Come back a week later, read the same lines again, and compare the two side by side before you send one.',
      side: 'right',
      band: 'porcelain',
      visual: 'takes',
      takes: LIBRARY_TAKES.map((take, i) => ({
        _type: 'csShowcaseTake',
        _key: `take-${i + 1}`,
        label: take.label,
        duration: take.duration,
        ...('flag' in take ? { flag: take.flag } : {}),
        ...('photo' in take ? { image: imageValue(assets.viewfinder, 'Take 3 thumbnail', FACE_HOTSPOT) } : {}),
      })),
      ctaLabel: 'Look inside the library',
      ctaHref: '/features/library',
    },
    {
      _type: 'csDeviceShowcaseBlock',
      _key: k('blk'),
      eyebrow: 'Editing',
      heading: 'Cut it before you put the phone down',
      body: 'Trim the top and tail, drop a title card in front, add a photo of the thing you’re talking about. Transitions belong to the clip they lead out of, so reordering never breaks them.',
      side: 'right',
      band: 'graphite',
      visual: 'editor',
      editor: {
        _type: 'csShowcaseEditor',
        title: 'Edit take',
        timecode: '00:42',
        image: imageValue(assets.viewfinder, 'Take 3 preview', FACE_HOTSPOT),
        range: '00:14 → 00:52',
        clipLabel: 'Take 3',
        tracks: ['Title', 'Photo'],
        tools: ['Trim', 'Title', 'Photo', 'Transition'],
        doneLabel: 'Done',
      },
      ctaLabel: 'See what the editor can do',
      ctaHref: '/features/editing',
    },
    {
      _type: 'csJourneyBlock',
      _key: k('blk'),
      eyebrow: 'How a take happens',
      heading: 'Six steps, about four minutes',
      intro:
        'From a blank script to a file you can send. No export queue, no desktop step, no second person holding anything.',
      stages: stageRefs,
    },
    {
      _type: 'csContrastBlock',
      _key: k('blk'),
      eyebrow: 'Before and after',
      heading: 'A phone on a stack of books, or this',
      leftLabel: 'The usual way',
      rightLabel: 'With CueDuo',
      rows: [
        { _type: 'csContrastRow', _key: k('row'), left: 'Script taped below the lens, eyeline low', right: 'Script beside the lens, eyeline correct' },
        { _type: 'csContrastRow', _key: k('row'), left: 'Eleven takes, each one slightly worse', right: 'One or two takes, both kept' },
        { _type: 'csContrastRow', _key: k('row'), left: 'Files airdropped to a laptop to trim', right: 'Trim and title on the phone' },
        { _type: 'csContrastRow', _key: k('row'), left: 'Whole thing takes an afternoon', right: 'Posted before the coffee goes cold' },
      ],
      footnote: 'Describes the workflow, not measured results. No timing claim is made.',
    },
    {
      _type: 'csPlansBlock',
      _key: k('blk'),
      eyebrow: 'Pricing',
      heading: 'Try it free, then pick a plan',
      intro: 'Seven days free. Everything is unlocked during the trial, including export at full quality.',
      plans: [
        {
          _type: 'csPlan',
          _key: k('plan'),
          name: 'Yearly',
          price: '$59',
          period: '/ year',
          recommended: true,
          features: ['Unlimited scripts and takes', 'Full-quality export, no watermark', 'Titles, photos, transitions'],
          ctaLabel: 'Start the free week',
          ctaHref: '#get',
        },
        {
          _type: 'csPlan',
          _key: k('plan'),
          name: 'Monthly',
          price: '$8.99',
          period: '/ month',
          recommended: false,
          features: ['Everything in Yearly', 'Cancel any month, in Settings'],
          ctaLabel: 'Start the free week',
          ctaHref: '#get',
        },
        {
          _type: 'csPlan',
          _key: k('plan'),
          name: 'Free, always',
          price: '$0',
          recommended: false,
          features: ['Write and run the prompter', 'Record and keep three takes', 'Trim on the phone'],
          note: 'Export is the part a plan unlocks. Already paid? Restore your purchase in Settings.',
        },
      ],
      footnote:
        'Prices are placeholders pending client sign-off. Billing happens in the App Store; the site never takes payment.',
    },
    {
      _type: 'csRequirementsBlock',
      _key: k('blk'),
      items: [
        { _type: 'csRequirement', _key: k('req'), label: 'Device', value: 'A folding phone with an outer display. Models TBC.' },
        { _type: 'csRequirement', _key: k('req'), label: 'System', value: 'iOS 18 or later.' },
        { _type: 'csRequirement', _key: k('req'), label: 'Storage', value: 'About 60 MB, plus room for your takes.' },
        { _type: 'csRequirement', _key: k('req'), label: 'Languages', value: 'English at launch. More as we go.' },
      ],
    },
    {
      _type: 'csFaqBlock',
      _key: k('blk'),
      heading: 'Questions people ask first',
      layout: 'split',
      outroLead: 'Still stuck?',
      outroLinkLabel: 'Write to us',
      outroLinkHref: 'mailto:hello@cueduo.com',
      outroTail: 'and a person answers.',
      items: [
        {
          _type: 'csFaqItem',
          _key: k('faq'),
          question: 'Do I need a folding phone?',
          answer:
            'Yes. The whole idea is a second screen beside the lens. On a regular phone there’s nowhere honest to put the script.',
        },
        {
          _type: 'csFaqItem',
          _key: k('faq'),
          question: 'Does the prompter scroll on its own?',
          answer: 'It follows your voice. If you stop to think, it stops with you. You can also set a fixed speed.',
        },
        {
          _type: 'csFaqItem',
          _key: k('faq'),
          question: 'Where do my takes live?',
          answer:
            'On your phone, in the app’s library, until you delete them. Nothing is uploaded unless you share it.',
        },
        {
          _type: 'csFaqItem',
          _key: k('faq'),
          question: 'Can I use it in landscape?',
          answer:
            'Yes. The inner display rotates and the rails stay on the short edges, so the controls stay where your thumbs are.',
        },
      ],
    },
    {
      _type: 'csAppCtaBlock',
      _key: k('blk'),
      heading: 'Say it once, and get on with your day.',
      body: 'Unfold the phone, read at the lens, trim it, send it.',
      showMark: true,
      countdown: { _type: 'csCountdown', eyebrow: 'Take 03', digit: '1', recLabel: 'REC', timecode: '00:00' },
      storeState: 'soon',
      storeLabel: 'Coming to the App Store',
      qualifier: QUALIFIER,
      band: 'prompter',
    },
  ];
}

// ---------------------------------------------------------------------------

async function main() {
  const client = dryRun ? null : createWriteClient({ dataset });

  const stages = STAGES.map((stage, i) => ({
    _id: csJourneyStageDocId(SITE_KEY, stage.slug),
    _type: 'csJourneyStage',
    site: siteRef,
    order: i + 1,
    title: stage.title,
    slug: { _type: 'slug', current: stage.slug },
    shortLabel: stage.title,
    summary: stage.summary,
  }));

  const stageRefs = stages.map((stage) => ({
    _type: 'reference' as const,
    _ref: stage._id,
    _key: k('stage'),
  }));

  const features = FEATURES.map((feature, i) => ({
    _id: csPracticeAreaDocId(SITE_KEY, feature.slug),
    _type: 'csPracticeArea',
    site: siteRef,
    title: feature.title,
    slug: { _type: 'slug', current: feature.slug },
    excerpt: feature.excerpt,
    order: i + 1,
    body: feature.body.map((p) => ptBlock(p)),
  }));

  const assets = await uploadImages(client);

  const site = {
    _id: SITE_ID,
    _type: 'csSite',
    siteKey: SITE_KEY,
    name: SITE_NAME,
    customDomain: 'cueduo.com',
    tagline: 'A teleprompter and recorder built for folding phones.',
    // No phone: this is a product, not a phone-first service business. The
    // header phone slot and the sticky call bar stay unmounted.
    email: 'hello@cueduo.com',
    logo: imageValue(assets.mark),
    favicon: imageValue(assets.mark),
    navigation: [
      { _type: 'csNavLink', _key: k('nav'), label: 'Features', href: '/features' },
      { _type: 'csNavLink', _key: k('nav'), label: 'How it works', href: '/#how-it-works' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Pricing', href: '/pricing' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Support', href: '/support' },
    ],
    footerNav: [
      { _type: 'csNavLink', _key: k('nav'), label: 'Features', href: '/features' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Pricing', href: '/pricing' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Updates', href: '/updates' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Support', href: '/support' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Privacy', href: '/privacy' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Terms', href: '/terms' },
    ],
    // Chrome for the v3 design. footerColumns supersede the flat footerNav
    // above, which stays seeded as the fallback.
    headerCta: { _type: 'headerCta', label: 'Get CueDuo', href: '/#get' },
    footerColumns: [
      {
        _type: 'csFooterColumn',
        _key: 'footer-product',
        title: 'Product',
        links: [
          { _type: 'csNavLink', _key: 'fp-features', label: 'Features', href: '/features' },
          { _type: 'csNavLink', _key: 'fp-pricing', label: 'Pricing', href: '/pricing' },
          { _type: 'csNavLink', _key: 'fp-updates', label: 'Updates', href: '/updates' },
        ],
      },
      {
        _type: 'csFooterColumn',
        _key: 'footer-help',
        title: 'Help',
        links: [
          { _type: 'csNavLink', _key: 'fh-support', label: 'Support', href: '/support' },
          { _type: 'csNavLink', _key: 'fh-privacy', label: 'Privacy', href: '/privacy' },
          { _type: 'csNavLink', _key: 'fh-terms', label: 'Terms', href: '/terms' },
        ],
      },
    ],
    footerAppLabel: 'Get the app',
    footerLegal: 'Apple and the App Store are trademarks of Apple Inc. Device renders are illustrative.',
    mobileBar: { _type: 'mobileBar', text: 'Look up. Say it once.', ctaLabel: 'Get CueDuo', ctaHref: '/#get' },
    // ⚠ Confirm with the client before go-live.
    leadRecipients: ['hello@cueduo.com'],
    // Not LegalService/FinancialService: this site describes an app. The
    // shared JSON-LD components branch on this value and need a third branch.
    organizationType: 'SoftwareApplication',
    titleTemplate: '%s | CueDuo',
    robotsDisallow: true,
    seo: {
      _type: 'csSeo',
      metaTitle: 'CueDuo | Look up. Say it once.',
      metaDescription:
        'A teleprompter and recorder built for folding phones. Your script on one screen, the lens on the other.',
    },
  };

  const pages = [
    {
      _id: csPageDocId(SITE_KEY, 'home'),
      _type: 'csPage',
      site: siteRef,
      title: 'Home',
      slug: { _type: 'slug', current: 'home' },
      pageBuilder: homePageBuilder(stageRefs, assets),
      seo: {
        _type: 'csSeo',
        metaTitle: 'CueDuo | Look up. Say it once.',
        metaDescription:
          'A teleprompter and recorder built for folding phones. Your script on one screen, the lens on the other, so you talk to people.',
      },
      publishedAt: '2026-09-21T00:00:00Z',
    },
    {
      _id: csPageDocId(SITE_KEY, 'features'),
      _type: 'csPage',
      site: siteRef,
      title: 'Features',
      slug: { _type: 'slug', current: 'features' },
      pageBuilder: [
        {
          _type: 'csIntroBlock',
          _key: k('blk'),
          layout: 'stacked',
          heading: 'What it does',
          body: [
            ptBlock(
              'Five things, and they all happen on the phone in your hand. Write the script, read it beside the lens, cut the take, keep every one, send the file.',
            ),
          ],
        },
        { _type: 'csPracticeGridBlock', _key: k('blk'), mode: 'all', heading: 'Features' },
        {
          _type: 'csAppCtaBlock',
          _key: k('blk'),
          heading: 'Say it once, and get on with your day.',
          showMark: true,
          storeState: 'soon',
          storeLabel: 'Coming to the App Store',
          qualifier: QUALIFIER,
          band: 'graphite',
        },
      ],
      seo: {
        _type: 'csSeo',
        metaTitle: 'Features',
        metaDescription:
          'The prompter, recording, editing, the library and export. What CueDuo does on a folding phone.',
      },
      publishedAt: '2026-09-21T00:00:00Z',
    },
    {
      _id: csPageDocId(SITE_KEY, 'pricing'),
      _type: 'csPage',
      site: siteRef,
      title: 'Pricing',
      slug: { _type: 'slug', current: 'pricing' },
      pageBuilder: [
        {
          _type: 'csPlansBlock',
          _key: k('blk'),
          heading: 'Try it free, then pick a plan',
          intro: 'Seven days free. Everything is unlocked during the trial, including export at full quality.',
          plans: [
            {
              _type: 'csPlan',
              _key: k('plan'),
              name: 'Yearly',
              price: '$59',
              period: '/ year',
              recommended: true,
              features: ['Unlimited scripts and takes', 'Full-quality export, no watermark', 'Titles, photos, transitions'],
              ctaLabel: 'Start the free week',
              ctaHref: '#get',
            },
            {
              _type: 'csPlan',
              _key: k('plan'),
              name: 'Monthly',
              price: '$8.99',
              period: '/ month',
              recommended: false,
              features: ['Everything in Yearly', 'Cancel any month, in Settings'],
              ctaLabel: 'Start the free week',
              ctaHref: '#get',
            },
            {
              _type: 'csPlan',
              _key: k('plan'),
              name: 'Free, always',
              price: '$0',
              recommended: false,
              features: ['Write and run the prompter', 'Record and keep three takes', 'Trim on the phone'],
              note: 'Export is the part a plan unlocks. Already paid? Restore your purchase in Settings.',
            },
          ],
          footnote:
            'Prices are placeholders pending client sign-off. Billing happens in the App Store; the site never takes payment.',
        },
        {
          _type: 'csFaqBlock',
          _key: k('blk'),
          heading: 'Billing questions',
          items: [
            {
              _type: 'csFaqItem',
              _key: k('faq'),
              question: 'How do I cancel?',
              answer: 'In Settings, on your phone. The plan runs to the end of the period you paid for.',
            },
            {
              _type: 'csFaqItem',
              _key: k('faq'),
              question: 'I already paid. How do I get it back on a new phone?',
              answer: 'Restore your purchase in Settings. It uses the Apple ID that bought it.',
            },
          ],
        },
        {
          _type: 'csAppCtaBlock',
          _key: k('blk'),
          heading: 'Say it once, and get on with your day.',
          showMark: true,
          storeState: 'soon',
          storeLabel: 'Coming to the App Store',
          qualifier: QUALIFIER,
          band: 'graphite',
        },
      ],
      seo: {
        _type: 'csSeo',
        metaTitle: 'Pricing',
        metaDescription: 'Seven days free, then a yearly or monthly plan. A free tier keeps the prompter and three takes.',
      },
      publishedAt: '2026-09-21T00:00:00Z',
    },
    {
      _id: csPageDocId(SITE_KEY, 'support'),
      _type: 'csPage',
      site: siteRef,
      title: 'Support',
      slug: { _type: 'slug', current: 'support' },
      pageBuilder: [
        {
          _type: 'csFaqBlock',
          _key: k('blk'),
          heading: 'Questions people ask first',
          items: [
            {
              _type: 'csFaqItem',
              _key: k('faq'),
              question: 'Do I need a folding phone?',
              answer:
                'Yes. The whole idea is a second screen beside the lens. On a regular phone there’s nowhere honest to put the script.',
            },
            {
              _type: 'csFaqItem',
              _key: k('faq'),
              question: 'The prompter isn’t following my voice.',
              answer:
                'Check that the microphone permission is on in Settings. If it is, switch to a fixed speed and let us know — that one is on us to fix.',
            },
            {
              _type: 'csFaqItem',
              _key: k('faq'),
              question: 'Where do my takes live?',
              answer:
                'On your phone, in the app’s library, until you delete them. Nothing is uploaded unless you share it.',
            },
          ],
        },
        {
          _type: 'csContactCtaBlock',
          _key: k('blk'),
          heading: 'Write to us',
          body: 'Tell us what happened and which phone you’re on. A person answers, usually the same day.',
          showForm: true,
          formFootnote: 'We only use your address to answer you.',
        },
      ],
      seo: {
        _type: 'csSeo',
        metaTitle: 'Support',
        metaDescription: 'Help with CueDuo, and a way to reach a person.',
      },
      publishedAt: '2026-09-21T00:00:00Z',
    },
    {
      _id: csPageDocId(SITE_KEY, 'privacy'),
      _type: 'csPage',
      site: siteRef,
      title: 'Privacy',
      slug: { _type: 'slug', current: 'privacy' },
      pageBuilder: [
        {
          _type: 'csDisclosureBlock',
          _key: k('blk'),
          // No heading: PageHeader already renders "Privacy" as the page h1, and
          // repeating it as an h2 directly underneath reads as a mistake.
          lastUpdated: LEGAL_LAST_UPDATED,
          content: [
            ptBlock(
              'Your scripts and your takes stay on your phone. We don’t have a copy, and there’s no account to make.',
            ),
            ptBlock('What the app asks for', 'h3'),
            ptBlock(
              'CueDuo asks for the camera and the microphone. The camera records your take. The microphone records your audio and paces the prompter to what you’ve already said. You can refuse either one in Settings, and the parts that need them stop working rather than working differently.',
            ),
            ptBlock('What leaves the device', 'h3'),
            ptBlock(
              'Only what you choose to share, and only to the place you send it. If you write to us through the support form, we keep that message and your email address until your question is answered.',
            ),
            ptBlock('Analytics', 'h3'),
            ptBlock(
              'This website counts page views through our tag manager. The app itself reports crashes and nothing else.',
            ),
            ptBlock('Payment', 'h3'),
            ptBlock(
              'Billing is handled by the App Store. We never see your card, and this site never takes a payment.',
            ),
          ],
          note: 'Placeholder wording, carried over from the approved design. The binding text comes from the client’s counsel and must be in place before submission to App Store Connect. Where the app processes voice pacing, and how long support email is retained, both need confirming before this is final.',
        },
      ],
      seo: {
        _type: 'csSeo',
        metaTitle: 'Privacy',
        metaDescription: 'What CueDuo does and does not do with your scripts, your takes and your data.',
      },
      publishedAt: '2026-09-21T00:00:00Z',
    },
    {
      _id: csPageDocId(SITE_KEY, 'terms'),
      _type: 'csPage',
      site: siteRef,
      title: 'Terms',
      slug: { _type: 'slug', current: 'terms' },
      pageBuilder: [
        {
          _type: 'csDisclosureBlock',
          _key: k('blk'),
          // No heading: PageHeader already renders "Terms" as the page h1, and
          // repeating it as an h2 directly underneath reads as a mistake.
          lastUpdated: LEGAL_LAST_UPDATED,
          content: [
            // Deliberately NOT a terms of service. No licence grant, no
            // liability limit, no termination or governing-law clause: those
            // are binding commitments and they are counsel's to write, not
            // ours to invent. What follows is only the operational detail
            // already stated on /pricing and in the app.
            ptBlock(
              'The full terms of service are being prepared. What follows is a plain summary of how buying and using CueDuo works. It is not the agreement itself.',
            ),
            ptBlock('Paying for it', 'h3'),
            ptBlock(
              'Billing is handled by the App Store, on the Apple ID signed in on your phone. A plan starts after the free week unless you cancel inside it.',
            ),
            ptBlock('Stopping', 'h3'),
            ptBlock(
              'Cancel any time in Settings. The plan runs to the end of the period you have already paid for. If you stop paying, your takes stay on your phone — you lose full-quality export, not your work.',
            ),
            ptBlock('Moving to a new phone', 'h3'),
            ptBlock('Open Settings and choose Restore purchase. It checks with the App Store using the Apple ID on the device.'),
            ptBlock('Your content', 'h3'),
            ptBlock('Your scripts and your takes are yours. We do not hold a copy of them.'),
          ],
          note: 'This page is a summary, not a contract. The binding terms of service are with the client’s counsel and must replace this before launch — nothing here grants a licence, limits liability, or sets a governing law, because none of that is ours to write.',
        },
      ],
      seo: {
        _type: 'csSeo',
        metaTitle: 'Terms',
        metaDescription: 'How paying for CueDuo works, and what happens to your takes if you stop.',
      },
      publishedAt: '2026-09-21T00:00:00Z',
    },
  ];

  // -------------------------------------------------------------------------
  // Write — dependency-ordered chunks so references resolve as they land.
  // -------------------------------------------------------------------------
  const chunks: Array<Array<Record<string, unknown>>> = [[site], features, stages, pages];

  if (dryRun || !client) {
    mkdirSync(outDir, { recursive: true });
    const all = chunks.flat();
    writeFileSync(join(outDir, 'documents.json'), JSON.stringify(all, null, 2));
    console.log(`[dry-run] ${all.length} documents written to ${join(outDir, 'documents.json')}`);
    return;
  }

  for (const chunk of chunks) {
    const tx = client.transaction();
    for (const doc of chunk) tx.createOrReplace(doc as { _id: string; _type: string });
    await tx.commit();
    console.log(`✓ committed ${chunk.length} doc(s): ${chunk.map((d) => d._id).join(', ')}`);
  }

  console.log(`\nDone. ${chunks.flat().length} documents seeded to "${dataset}".`);
  console.log('Reminders:');
  console.log('  - Presenter photos and the logo mark were uploaded from scripts/assets/cueduo/. The Take 3 thumbnail and');
  console.log('    editor frame reuse the viewfinder photo until real app frames are exported.');
  console.log('  - Prices are the design placeholders; the block footnote says so on the page.');
  console.log('  - storeState is "soon" everywhere. Flip to "live" once the App Store URL exists,');
  console.log('    and drop Apple’s badge at apps/site-host/public/cueduo/app-store-badge.svg first.');
  console.log('  - leadRecipients seeded as hello@cueduo.com — confirm with the client.');
  console.log('  - robotsDisallow is TRUE (noindexed) until DNS cutover per the go-live runbook.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
