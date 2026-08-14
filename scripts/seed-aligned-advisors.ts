#!/usr/bin/env -S tsx
/**
 * Seed Aligned Advisors (Custom Sites site #2, siteKey `alignedadvisors`)
 * into Sanity — a full port of the client's Replit prototype
 * (https://dental-wealth-navigator.replit.app) onto the Custom Sites schema.
 *
 * Mirrors scripts/migrate-construction-adr.ts's conventions: env-file walk
 * (worktree-safe), --dataset required (never from env), --dry-run writes JSON
 * instead of touching the network, subpath-only imports from
 * @leadlandlord/sanity-schema, deterministic doc ids, and dependency-ordered
 * createOrReplace transaction chunks (idempotent re-runs).
 *
 * Content decisions (per the 2026-08-05 plan approval):
 *  - Case studies seed approvedForUse: true — the figures are already public
 *    on the client's own prototype (approvalNote records this).
 *  - The assessment is seeded with the prototype's 14 questions. The
 *    prototype scores by per-stage vote weights; csAssessment scores a
 *    LINEAR total (A=0 B=1 C=2 D=3 → 0-42) mapped to contiguous bands.
 *    That's an approximation the client can retune per-option in Studio.
 *  - Badge/logo wall and lead-magnet PDFs are NOT seeded — those assets are
 *    client-supplied (no invented logos, no placeholder gated reports).
 *  - robotsDisallow stays true (ADR 0033 D6) — noindexed until DNS cutover.
 *
 * Usage:
 *   pnpm seed-aligned-advisors --dataset development [--dry-run] [--out <dir>]
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
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
// can't load under plain tsx (same constraint as migrate-construction-adr.ts).
import { createWriteClient } from '@leadlandlord/sanity-schema/client';
import {
  csSiteDocId,
  csPageDocId,
  csPracticeAreaDocId,
  csAttorneyDocId,
  csJourneyStageDocId,
  csCaseStudyDocId,
  csAssessmentDocId,
  csPublicationDocId,
} from '@leadlandlord/sanity-schema/ids';
import type { SanityClient } from '@sanity/client';

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
  console.error('Usage: seed-aligned-advisors.ts --dataset development|production [--dry-run] [--out <dir>]');
  process.exit(1);
}
const dryRun = Boolean(args['dry-run']);
const outDir = (args.out as string | undefined) ?? join(tmpdir(), 'seed-aligned-advisors-dry-run');

// ---------------------------------------------------------------------------
// Site constants
// ---------------------------------------------------------------------------

const SITE_KEY = 'alignedadvisors';
const SITE_NAME = 'Aligned Advisors';
const SITE_ID = csSiteDocId(SITE_KEY);
const siteRef = { _type: 'reference' as const, _ref: SITE_ID };

/** Prototype origin — the source of copy AND the client-owned images. */
const PROTO = 'https://dental-wealth-navigator.replit.app';

const IMAGES = {
  logo: `${PROTO}/assets/aligned-advisors-logo-Cw3cYXcL.png`,
  banner: `${PROTO}/assets/beach-oceanside-CZEQUgbw.jpg`,
  servicesHero: `${PROTO}/assets/services-hero-bg-COaLh9as.jpg`,
  team: {
    'jonathan-moffat': `${PROTO}/assets/team-jonathan-DUsnJS-T.jpg`,
    'austin-moffat': `${PROTO}/assets/team-austin-D_zO2IkP.jpg`,
    'allison-mcmullan': `${PROTO}/assets/team-allison-BSpeR3Yu.jpg`,
    'mike-belgard': `${PROTO}/assets/team-mike-ugHtE-gs.jpg`,
    'miranda-fischer': `${PROTO}/assets/team-miranda-IhcrjOmV.jpg`,
    'joseph-miranda': `${PROTO}/assets/team-joseph-ComkB0fo.jpg`,
    'alex-borrero': `${PROTO}/assets/team-alex-Cd7bDvmu.jpg`,
    leroy: `${PROTO}/assets/team-leroy-6LtD6fvA.jpg`,
  } as Record<string, string>,
};

// ---------------------------------------------------------------------------
// Portable Text helpers
// ---------------------------------------------------------------------------

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

function pt(...paragraphs: string[]): PTBlock[] {
  return paragraphs.map((p) => ptBlock(p));
}

// ---------------------------------------------------------------------------
// Focus areas (7) — titles, taglines, and deliverables lifted verbatim from
// the prototype's services page data.
// ---------------------------------------------------------------------------

interface FocusAreaSeed {
  slug: string;
  title: string;
  shortLabel: string;
  excerpt: string;
  deliverables: string[];
}

const FOCUS_AREAS: FocusAreaSeed[] = [
  {
    slug: 'complete-dental-family-office',
    title: 'Complete Dental Family Office',
    shortLabel: 'Family Office',
    excerpt:
      'The umbrella that separates us from everyone else. Most firms solve one piece of your financial life — we coordinate the entire picture.',
    deliverables: [
      'Wealth Journey Blueprint',
      'Virtual Family Office for Dentists',
      'Full Financial Life Organization',
      'Ongoing Wealth Strategy Meetings',
      'Financial Independence Planning',
      'Personal Cash Flow & Net Worth Planning',
      'Investment Strategy & Portfolio Oversight',
      'Risk Management & Insurance Review',
      'Estate, Legacy & Asset Protection Coordination',
      'Spouse & Family Financial Continuity Planning',
      'Dental Wealth Mastermind',
      'Financial Education for Dentists',
      'Quarterly Strategy Calls',
      'Profit & Tax Workshops',
      'Practice Owner Scorecards',
      'Implementation Accountability',
    ],
  },
  {
    slug: 'dental-cfo-bookkeeping',
    title: 'Dental CFO & Bookkeeping',
    shortLabel: 'CFO & Books',
    excerpt: 'The clarity and profit engine. We do not just tell you what happened — we show you what to change.',
    deliverables: [
      'Dental Bookkeeping',
      'Chart of Accounts Setup & Cleanup',
      'Monthly Financial Statements',
      'P&L Review & Interpretation',
      'NumbersIQ Profit Analysis',
      'Profit Leak Detection',
      'Dental KPI Dashboard',
      'Cash Flow Forecasting',
      'Budgeting & Expense Controls',
      'Break-Even Analysis',
      'Provider & Associate Profitability Analysis',
      'Staff Cost & Labor Efficiency Review',
      'Collections & AR Review',
      'Multi-Location Financial Reporting',
      'DSO & Group Practice CFO Services',
      'Startup & Acquisition Projections',
      'Bank & Lender-Ready Reporting',
      'Quarterly CFO Strategy Meetings',
    ],
  },
  {
    slug: 'tax-strategy-accounting',
    title: 'Tax Strategy & Accounting',
    shortLabel: 'Tax',
    excerpt:
      'Proactive tax planning, not tax preparation. We plan before the tax bill arrives — not after the year is over.',
    deliverables: [
      'Proactive Tax Planning',
      'Business Tax Preparation',
      'Personal Tax Preparation',
      'Entity Structure Review',
      'S-Corp & Reasonable Compensation Planning',
      'Quarterly Tax Projections',
      'Quarterly Estimated Tax Planning',
      'Year-End Tax Strategy',
      'Practice Purchase & Sale Tax Planning',
      'Management Company Strategy',
      'Real Estate & Cost Segregation Coordination',
      'Retirement Plan Tax Strategy',
      'Tax Strategy for Multi-Entity Owners',
      'IRS & State Notice Support',
      'Accounting System Review',
    ],
  },
  {
    slug: 'practice-profitability',
    title: 'Practice Profitability & Financial Clarity',
    shortLabel: 'Profitability',
    excerpt: 'For the dentist who says, "I make good money, but I do not know where it goes."',
    deliverables: [
      'Profitability Analysis',
      'Overhead Benchmarking',
      'Owner Profit Review',
      'Cash Flow Clarity',
      'Production vs. Profit Analysis',
      'Top 3 Profit Drains Report',
      'Action Plan to Increase Profit',
    ],
  },
  {
    slug: 'income-beyond-the-chair',
    title: 'Income Beyond the Chair',
    shortLabel: 'Passive Income',
    excerpt:
      'One of our most important differentiators. We help dentists build income and freedom while they are still in practice — not "someday."',
    deliverables: [
      'Passive Income Strategy',
      'Investment Income Planning',
      'Real Estate Strategy Coordination',
      'Business & Alternative Investment Strategy',
      'Management Company & Entity Strategy',
      'Freedom Number Planning',
    ],
  },
  {
    slug: 'growth-acquisition-exit',
    title: 'Practice Growth, Acquisition & Exit Strategy',
    shortLabel: 'Growth & Exit',
    excerpt:
      'For startups, acquisitions, multi-location owners, and dentists considering a sale. Understand the deal before you buy, sell, borrow, or expand.',
    deliverables: [
      'Startup Financial Readiness Review',
      'Acquisition Financial Review',
      'Practice Valuation Support',
      'Deal Structure Review',
      'Debt & Loan Strategy',
      'Expansion Planning',
      'Multi-Practice Growth Strategy',
      'Exit Readiness Planning',
      'Post-Sale Wealth Planning',
    ],
  },
  {
    slug: 'dso-multi-practice-advisory',
    title: 'DSO & Multi-Practice Advisory',
    shortLabel: 'DSO Advisory',
    excerpt:
      'Built to help owners manage profitability and scalability across multiple locations — not just a single practice.',
    deliverables: [
      'Consolidated Financial Reporting',
      'Location Profitability Analysis',
      'EBITDA Improvement Strategy',
      'Associate Productivity Review',
      'Staffing Efficiency Analysis',
      'Collections & Revenue Cycle Review',
      'Growth & Scalability KPIs',
      'Lender & Investor Reporting',
      'Acquisition Integration Support',
    ],
  },
];

const paRef = (slug: string) => ({ _type: 'reference' as const, _ref: csPracticeAreaDocId(SITE_KEY, slug), _key: k('pa') });

// ---------------------------------------------------------------------------
// Team (8) — prototype roster, oldest-first order matters: Jonathan is the
// primary member whose #attorney JSON-LD id other nodes reference.
// ---------------------------------------------------------------------------

const TEAM: Array<{ slug: string; name: string; jobTitle: string }> = [
  { slug: 'jonathan-moffat', name: 'Jonathan Moffat', jobTitle: 'Founder' },
  { slug: 'austin-moffat', name: 'Austin Moffat', jobTitle: 'President of DSOCFO' },
  { slug: 'allison-mcmullan', name: 'Allison McMullan', jobTitle: 'Admin Manager' },
  { slug: 'mike-belgard', name: 'Mike Belgard', jobTitle: 'Trusted Advisor' },
  { slug: 'miranda-fischer', name: 'Miranda Fischer', jobTitle: 'Client Success Manager' },
  { slug: 'joseph-miranda', name: 'Joseph Miranda', jobTitle: 'Financial Planning SME' },
  { slug: 'alex-borrero', name: 'Alex Borrero', jobTitle: 'SME Team Lead' },
  { slug: 'leroy', name: 'Leroy', jobTitle: 'Office Dog' },
];

// ---------------------------------------------------------------------------
// Wealth Journey stages (5) — summaries from the prototype's assessment
// result copy; nextStageTeaser from the home rail's per-stage action blurb.
// ---------------------------------------------------------------------------

interface StageSeed {
  slug: string;
  order: number;
  title: string;
  shortLabel: string;
  summary: string;
  nextStageTeaser: string;
  focusAreas: string[];
}

const STAGES: StageSeed[] = [
  {
    slug: 'profitable-practice',
    order: 1,
    title: 'Profitable Practice',
    shortLabel: 'Profit',
    summary:
      'Your focus is building a consistently profitable practice: reliable cash flow, real profitability, tight overhead control, and a simple scorecard that shows you exactly where your money is going.',
    nextStageTeaser:
      'Get your Practice Profitability Snapshot and see exactly where your practice is leaking money — in under 2 minutes.',
    focusAreas: ['practice-profitability', 'dental-cfo-bookkeeping'],
  },
  {
    slug: 'excess-money-to-invest',
    order: 2,
    title: 'Excess Money to Invest',
    shortLabel: 'Invest',
    summary:
      'Your practice is generating real cash — now the question is what to do with it. You need a financial operating system that puts every dollar to work: tax efficiency, smart allocation, and building your first investment foundation.',
    nextStageTeaser:
      'See the tax-efficient cash flow system we use to turn surplus profit into invested capital.',
    focusAreas: ['tax-strategy-accounting', 'complete-dental-family-office'],
  },
  {
    slug: 'passive-income',
    order: 3,
    title: 'Passive Income',
    shortLabel: 'Passive',
    summary:
      "You've built a profitable practice and you're ready to stop trading time for money. It's time to evaluate income streams that work even when you're not in the chair.",
    nextStageTeaser:
      'Read how we helped a specialist generate $61,000/month in passive income outside the chair.',
    focusAreas: ['income-beyond-the-chair'],
  },
  {
    slug: 'wealth-accelerator',
    order: 4,
    title: 'Wealth Accelerator',
    shortLabel: 'Accelerate',
    summary:
      "Your money is working — now let's make it compound faster. Advanced tax strategies, entity structuring, and smart leverage can compress decades of wealth growth into years.",
    nextStageTeaser:
      "See how tax and entity strategy grew one practice's net worth from $3.98M to $17.8M in six years.",
    focusAreas: ['tax-strategy-accounting', 'growth-acquisition-exit'],
  },
  {
    slug: 'leave-a-legacy',
    order: 5,
    title: 'Leave a Legacy',
    shortLabel: 'Legacy',
    summary:
      "You've achieved financial independence. Now it's about protecting it, structuring it, and ensuring your wealth creates impact beyond your lifetime.",
    nextStageTeaser: "Protect what you've built. Book a legacy and asset-protection review with our team.",
    focusAreas: ['complete-dental-family-office'],
  },
];

const stageRef = (slug: string) => ({ _type: 'reference' as const, _ref: csJourneyStageDocId(SITE_KEY, slug), _key: k('st') });

// ---------------------------------------------------------------------------
// Assessment — the prototype's 14 questions verbatim. Points are a linear
// approximation (A=0 B=1 C=2 D=3, max 42) of the prototype's per-stage vote
// model; the client tunes points and bands in Studio without a code change.
// ---------------------------------------------------------------------------

const QUIZ_QUESTIONS: Array<{ prompt: string; options: string[] }> = [
  { prompt: 'How confident are you in your practice financials?', options: ["I don't fully trust or understand them", 'I understand them generally, but not in detail', 'I review them regularly and understand the drivers', 'I use them to make strategic decisions'] },
  { prompt: 'At the end of most months, your practice cash flow feels…', options: ['Tight or unpredictable', 'Stable, but not abundant', 'Consistently positive', 'More than enough for my lifestyle'] },
  { prompt: 'Which best describes your tax situation?', options: ['I usually find out what I owe right before the deadline', "I know I'm overpaying but haven't fixed it", 'I have proactive tax strategies in place', 'Taxes are part of a larger wealth strategy'] },
  { prompt: 'Do you have excess cash after personal and practice expenses?', options: ['Rarely or never', 'Occasionally', 'Consistently', "Yes, and it's intentionally deployed"] },
  { prompt: 'When you have extra cash, it usually…', options: ['Sits in checking', 'Goes to taxes or lifestyle creep', 'Is invested intentionally', 'Is deployed for compounding or leverage'] },
  { prompt: 'How dependent is your income on your personal production?', options: ['Nearly 100%', 'Mostly dependent', 'Partially dependent', 'Not dependent'] },
  { prompt: 'If you stopped working clinically tomorrow…', options: ['Income would drop dramatically', 'Income would decline but survive', 'Lifestyle would still be covered', 'Little would change'] },
  { prompt: 'Do you currently earn passive income?', options: ['No', 'A small amount', 'Meaningful income', 'Covers most or all expenses'] },
  { prompt: 'What matters more to you right now?', options: ['Stabilizing my practice', 'Keeping more of what I earn', 'Replacing my clinical income', 'Accelerating net worth'] },
  { prompt: 'Which best describes your growth approach?', options: ['Cautious — I want stability', 'Intentional but conservative', 'Strategic and leverage-aware', 'Opportunistic and scalable'] },
  { prompt: 'When do you want financial freedom?', options: ['Someday', '10–15 years', '5–10 years', 'As fast as reasonably possible'] },
  { prompt: 'Which statement resonates most?', options: ['I just want less stress', 'I want my money working harder', 'I want freedom from the chair', 'I want to build something bigger than me'] },
  { prompt: 'How complete is your estate and legacy planning?', options: ['Not started', 'Basic documents only', 'Coordinated plan', 'Actively reviewed with family'] },
  { prompt: 'Which feels most important now?', options: ['Financial security', 'Tax efficiency', 'Time with family', 'Multi-generational impact'] },
];

const ASSESSMENT_SLUG = 'wealth-journey';
const ASSESSMENT_ID = csAssessmentDocId(SITE_KEY, ASSESSMENT_SLUG);

// ---------------------------------------------------------------------------
// Podcast episodes (6) — Ep. 42-47 from the prototype's insights page. No
// listen links seeded: the prototype's platform buttons carry no real URLs,
// and we never invent external links.
// ---------------------------------------------------------------------------

const EPISODES: Array<{ slug: string; num: number; date: string; minutes: number; title: string; excerpt: string }> = [
  { slug: 'ep-47-practice-fixed-fundamentals', num: 47, date: '2026-06-10', minutes: 42, title: 'From $2.6M to $4.3M: How One Practice Fixed Its Fundamentals', excerpt: 'We walk through a real case study — a practice that looked successful on paper but felt cash-strapped. Learn the exact moves that unlocked 32% margins and nearly $1M/year in take-home.' },
  { slug: 'ep-46-the-tax-trap', num: 46, date: '2026-05-27', minutes: 38, title: "The Tax Trap Most Dentists Don't See Until It's Too Late", excerpt: "Proactive tax strategy isn't just about saving money — it's about avoiding the shock of owing six figures right before April 15th. We cover what to do differently and when to start." },
  { slug: 'ep-45-passive-income-that-works', num: 45, date: '2026-05-13', minutes: 51, title: 'Passive Income That Actually Works for Dentists', excerpt: 'Not every passive income strategy makes sense for a dental practice owner. We break down the framework we use to evaluate opportunities — risk, return, time, and tax implications.' },
  { slug: 'ep-44-understanding-overhead', num: 44, date: '2026-04-29', minutes: 44, title: 'Understanding Overhead: The KPIs Your Bookkeeper Should Be Tracking', excerpt: 'Overhead benchmarks vary dramatically by specialty. We walk through what general dentistry, oral surgery, and ortho practices should be measuring — and what the numbers actually mean.' },
  { slug: 'ep-43-fractional-cfo', num: 43, date: '2026-04-15', minutes: 35, title: 'When to Hire a Fractional CFO (And What to Expect)', excerpt: "A CFO isn't just for DSOs. We explain the inflection points where a fractional CFO changes the trajectory of a practice — and what the engagement actually looks like day to day." },
  { slug: 'ep-42-structuring-first-investment', num: 42, date: '2026-04-01', minutes: 47, title: 'Structuring Your First Investment: Entity Setup and Capital Deployment', excerpt: 'Once your practice generates surplus cash, the next question is where it goes. We cover entity structures, investment accounts, and how to build your personal financial operating system.' },
];

// ---------------------------------------------------------------------------
// Asset upload
// ---------------------------------------------------------------------------

const uploadedAssets = new Map<string, string>();

async function uploadImage(client: SanityClient, url: string, filename: string): Promise<string | null> {
  if (uploadedAssets.has(url)) return uploadedAssets.get(url)!;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ! image fetch failed (${res.status}): ${url}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const asset = await client.assets.upload('image', buf, { filename });
    uploadedAssets.set(url, asset._id);
    console.log(`  ↑ uploaded ${filename} (${asset._id})`);
    return asset._id;
  } catch (err) {
    console.warn(`  ! image upload failed: ${url}`, err instanceof Error ? err.message : err);
    return null;
  }
}

const imageField = (assetId: string | null | undefined) =>
  assetId ? { _type: 'image' as const, asset: { _type: 'reference' as const, _ref: assetId } } : undefined;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Seeding ${SITE_NAME} (${SITE_KEY}) into dataset "${dataset}"${dryRun ? ' [dry-run]' : ''}\n`);

  const client = dryRun
    ? null
    : createWriteClient({ dataset });

  // -------------------------------------------------------------------------
  // Assets (skipped in dry-run — doc JSON then has no image fields)
  // -------------------------------------------------------------------------
  const assetIds: Record<string, string | null> = {};
  if (client) {
    assetIds.logo = await uploadImage(client, IMAGES.logo, 'aligned-advisors-logo.png');
    assetIds.banner = await uploadImage(client, IMAGES.banner, 'aa-banner-oceanside.jpg');
    assetIds.servicesHero = await uploadImage(client, IMAGES.servicesHero, 'aa-services-hero.jpg');
    for (const member of TEAM) {
      assetIds[`team:${member.slug}`] = await uploadImage(client, IMAGES.team[member.slug]!, `aa-team-${member.slug}.jpg`);
    }
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  const site = {
    _id: SITE_ID,
    _type: 'csSite',
    siteKey: SITE_KEY,
    name: SITE_NAME,
    customDomain: 'alignedadvisors.com',
    tagline: 'The financial partner dentists have always needed but never had.',
    phone: '858.752.7179',
    email: 'info@alignedadvisors.com',
    address: { _type: 'csAddress', street: '1696 Ord Way', city: 'Oceanside', state: 'CA', zip: '92056' },
    logo: imageField(assetIds.logo),
    footerLogo: imageField(assetIds.logo),
    bannerImage: imageField(assetIds.banner),
    navigation: [
      { _type: 'csNavLink', _key: k('nav'), label: 'Services', href: '/services' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Insights', href: '/insights' },
      { _type: 'csNavLink', _key: k('nav'), label: 'About', href: '/about' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Contact', href: '/contact' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Take the Wealth Journey Quiz', href: '/assessment' },
    ],
    footerNav: [
      { _type: 'csNavLink', _key: k('nav'), label: 'Wealth Journey Assessment', href: '/assessment' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Podcast & Speaking', href: '/insights' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Contact', href: '/contact' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Privacy Policy', href: '/privacy' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Terms of Service', href: '/terms' },
      { _type: 'csNavLink', _key: k('nav'), label: 'Disclosures', href: '/disclosures' },
    ],
    // ⚠ Confirm with the client before go-live.
    leadRecipients: ['info@alignedadvisors.com'],
    organizationType: 'FinancialService',
    titleTemplate: '%s | Aligned Advisors',
    areaServed: ['United States'],
    openingHours: ['Mo-Fr 08:00-17:00'],
    robotsDisallow: true,
    // Placeholder pending the client's compliance copy — plain text only.
    footerDisclosure:
      'Aligned Advisors coordinates accounting, tax, and advisory services for dental practice owners. Case study results are specific client outcomes and are not a guarantee of future performance. This site is for information only and does not constitute individualized investment, legal, or tax advice.',
    seo: {
      _type: 'csSeo',
      metaTitle: 'Aligned Advisors | The Dental Money Team',
      metaDescription:
        'One dental-specialized Money Team handling your books, taxes, and wealth — so you can grow profit and step away from the chair.',
    },
  };

  const practiceAreas = FOCUS_AREAS.map((fa, i) => ({
    _id: csPracticeAreaDocId(SITE_KEY, fa.slug),
    _type: 'csPracticeArea',
    site: siteRef,
    title: fa.title,
    slug: { _type: 'slug', current: fa.slug },
    excerpt: fa.excerpt,
    shortLabel: fa.shortLabel,
    deliverables: fa.deliverables,
    body: pt(fa.excerpt, 'Every engagement is delivered by the same coordinated team that already knows your full picture — no silos, no hand-offs.'),
    order: i + 1,
    publishedAt: '2026-08-05T00:00:00Z',
  }));

  const team = TEAM.map((member) => ({
    _id: csAttorneyDocId(SITE_KEY, member.slug),
    _type: 'csAttorney',
    site: siteRef,
    name: member.name,
    slug: { _type: 'slug', current: member.slug },
    jobTitle: member.jobTitle,
    photo: imageField(assetIds[`team:${member.slug}`]),
  }));

  const stages = STAGES.map((st) => ({
    _id: csJourneyStageDocId(SITE_KEY, st.slug),
    _type: 'csJourneyStage',
    site: siteRef,
    order: st.order,
    title: st.title,
    slug: { _type: 'slug', current: st.slug },
    shortLabel: st.shortLabel,
    summary: st.summary,
    nextStageTeaser: st.nextStageTeaser,
    focusAreas: st.focusAreas.map(paRef),
  }));

  const caseStudies = [
    {
      slug: 'practice-growth-margin-expansion',
      headline: 'Practice Growth & Margin Expansion',
      metricLabel: 'Annual collections',
      beforeValue: '$2.6M',
      afterValue: '$4.3M',
      narrative:
        'By restructuring their DSO CFO tracking, we identified $150k in hidden overhead, growing revenue while expanding margins to 32%.',
      stage: 'wealth-accelerator',
      order: 1,
    },
    {
      slug: 'passive-income-generation',
      headline: 'Passive Income Generation',
      metricLabel: 'Monthly passive income',
      beforeValue: '$61K/mo',
      afterValue: null,
      narrative:
        'Transitioned an exhausted specialist from 100% clinical dependence to generating $61,000 monthly in passive real estate and market income.',
      stage: 'passive-income',
      order: 2,
    },
    {
      slug: 'net-worth-acceleration',
      headline: 'Net Worth Acceleration',
      metricLabel: 'Net worth',
      beforeValue: '$3.98M',
      afterValue: '$17.8M',
      timeframe: '6 years',
      narrative:
        'Through aggressive tax strategy, entity restructuring, and smart leverage, compressed decades of growth into a 6-year sprint.',
      stage: 'wealth-accelerator',
      order: 3,
    },
  ].map((cs) => ({
    _id: csCaseStudyDocId(SITE_KEY, cs.slug),
    _type: 'csCaseStudy',
    site: siteRef,
    headline: cs.headline,
    slug: { _type: 'slug', current: cs.slug },
    metricLabel: cs.metricLabel,
    beforeValue: cs.beforeValue,
    ...(cs.afterValue ? { afterValue: cs.afterValue } : {}),
    ...('timeframe' in cs && cs.timeframe ? { timeframe: cs.timeframe } : {}),
    narrative: pt(cs.narrative),
    approvedForUse: true,
    approvalNote: 'Figures already public on the client prototype (dental-wealth-navigator.replit.app); seeded 2026-08-05.',
    stage: { _type: 'reference', _ref: csJourneyStageDocId(SITE_KEY, cs.stage) },
    order: cs.order,
  }));

  const assessment = {
    _id: ASSESSMENT_ID,
    _type: 'csAssessment',
    site: siteRef,
    title: 'Wealth Journey Quiz v1',
    slug: { _type: 'slug', current: ASSESSMENT_SLUG },
    questions: QUIZ_QUESTIONS.map((q) => ({
      _type: 'csAssessmentQuestion',
      _key: k('q'),
      prompt: q.prompt,
      options: q.options.map((label, i) => ({ _type: 'csAssessmentOption', _key: k('o'), label, points: i })),
    })),
    // Linear bands over the 0-42 total (see file docblock).
    bands: [
      { stage: 'profitable-practice', minScore: 0, maxScore: 8 },
      { stage: 'excess-money-to-invest', minScore: 9, maxScore: 16 },
      { stage: 'passive-income', minScore: 17, maxScore: 25 },
      { stage: 'wealth-accelerator', minScore: 26, maxScore: 34 },
      { stage: 'leave-a-legacy', minScore: 35, maxScore: 42 },
    ].map((b) => ({
      _type: 'csAssessmentBand',
      _key: k('band'),
      stage: { _type: 'reference', _ref: csJourneyStageDocId(SITE_KEY, b.stage) },
      minScore: b.minScore,
      maxScore: b.maxScore,
    })),
    emailSubject: 'New Wealth Journey assessment result',
  };

  const episodes = EPISODES.map((ep) => ({
    _id: csPublicationDocId(SITE_KEY, ep.slug),
    _type: 'csPublication',
    site: siteRef,
    title: ep.title,
    slug: { _type: 'slug', current: ep.slug },
    kind: 'publication',
    excerpt: ep.excerpt,
    publishedAt: `${ep.date}T00:00:00Z`,
    episodeNumber: ep.num,
    durationMinutes: ep.minutes,
    externalEvent: 'Dental Wealth Mastermind',
  }));

  // --- Pages (builder arrays in the design's section order) -----------------

  const consultationChecklist = [
    { _type: 'csContactChecklistItem', _key: k('cl'), heading: 'Review your current setup', body: 'A clear look at how your practice and personal finances are structured today.' },
    { _type: 'csContactChecklistItem', _key: k('cl'), heading: 'Spot immediate opportunities', body: 'Where you may be overpaying in tax or leaking profit — and what to address first.' },
    { _type: 'csContactChecklistItem', _key: k('cl'), heading: 'Map your Wealth Journey', body: 'See which of the five stages you are in and the defined next step toward freedom.' },
  ];

  const consultationCta = {
    _type: 'csContactCtaBlock',
    _key: k('blk'),
    eyebrow: 'Free Consultation',
    heading: 'A complimentary, no-obligation strategy call.',
    body: "Spend 30 minutes with our team to see whether the Aligned Advisors family office model is the right fit for your practice and personal goals. Here's what we'll cover:",
    showForm: true,
    formVariant: 'consultation',
    formFootnote: "Complimentary and no-obligation. If we're not the right fit, we'll happily point you in the right direction.",
    checklist: consultationChecklist,
  };

  const pages = [
    {
      slug: 'home',
      title: 'Home',
      seo: {
        _type: 'csSeo',
        metaTitle: 'The Dental Money Team — Books, Taxes & Wealth for Dentists',
        metaDescription:
          'One dental-specialized Money Team handling your books, taxes, and wealth — so you can grow profit and step away from the chair.',
      },
      pageBuilder: [
        {
          _type: 'csHeroBlock',
          _key: k('blk'),
          eyebrow: 'Serving Dentists Since 2008',
          heading: 'Turn Your Practice Into Your Freedom Plan',
          subheading:
            'One dental-specialized Money Team handling your books, taxes, and wealth — so you can grow profit and step away from the chair.',
          ctaLabel: 'Take the Wealth Journey Quiz',
          ctaHref: '/assessment',
        },
        {
          _type: 'csStatRailBlock',
          _key: k('blk'),
          items: [
            { _type: 'csStatItem', _key: k('it'), value: '400+', label: 'Dental Clients Served' },
            { _type: 'csStatItem', _key: k('it'), value: '93+', label: 'Coordinated Services' },
            { _type: 'csStatItem', _key: k('it'), value: '$1.2B+', label: 'Practice Revenue Managed', footnote: 'Cumulative client practice revenue under advisory.' },
          ],
        },
        {
          _type: 'csValuePropsBlock',
          _key: k('blk'),
          heading: 'One team. One plan. No more piecing it together yourself.',
          eyebrow: 'Why Aligned',
          items: [
            { _type: 'csValuePropItem', _key: k('it'), icon: 'team', heading: 'A complete Money Team', body: 'Planner, tax strategist, CFO team, and legal coordination — one unit, not vendors you manage.' },
            { _type: 'csValuePropItem', _key: k('it'), icon: 'practice', heading: 'Practice + personal, one system', body: 'We find the profit leaks in your P&L and turn them into a stronger practice and a bigger nest egg.' },
            { _type: 'csValuePropItem', _key: k('it'), icon: 'roadmap', heading: 'A clear roadmap', body: 'The Wealth Journey names exactly what stage you are in — and what comes next.' },
          ],
        },
        {
          _type: 'csJourneyBlock',
          _key: k('blk'),
          eyebrow: 'The Framework',
          heading: 'The Wealth Journey',
          intro:
            'A proprietary 5-stage framework designed specifically for dentists. We meet you wherever you are financially and guide you to where you want to be.',
          stages: STAGES.map((st) => stageRef(st.slug)),
          ctaLabel: 'Find your stage — take the assessment',
          ctaHref: '/assessment',
        },
        {
          _type: 'csCaseStudyGridBlock',
          _key: k('blk'),
          eyebrow: 'Results',
          heading: 'Real Results. Real Dentists.',
          mode: 'all',
          limit: 3,
          disclaimer:
            'Results shown are specific client outcomes and are not typical or guaranteed. Your results will depend on your practice, market, and participation.',
        },
        {
          _type: 'csNumbersIqBlock',
          _key: k('blk'),
          eyebrow: 'NumbersIQ™',
          heading: 'Stop guessing. Start measuring against the best.',
          body: pt(
            'Our proprietary Practice Profitability Snapshot compares your practice directly against industry benchmarks for your specific specialty. See exactly where your practice is leaking money.',
          ),
          metrics: [
            { _type: 'csNumbersIqMetric', _key: k('it'), label: 'Staff Payroll', percent: 71, valueLabel: '28.4%' },
            { _type: 'csNumbersIqMetric', _key: k('it'), label: 'Dental Supplies', percent: 47, valueLabel: '5.2%' },
          ],
          ctaLabel: 'See Where Your Practice Is Leaking Profit',
          ctaHref: 'https://numbersiq.com',
          illustrative: true,
        },
        {
          _type: 'csEpisodeListBlock',
          _key: k('blk'),
          eyebrow: 'The Podcast',
          heading: 'Dental Wealth Mastermind',
          kind: 'publication',
          limit: 3,
          showListenLinks: true,
          ctaLabel: 'All episodes',
          ctaHref: '/insights',
        },
        consultationCta,
      ],
    },
    {
      slug: 'services',
      title: 'Our Services',
      seo: {
        _type: 'csSeo',
        metaTitle: 'Services — One Team for Profitability, Taxes, Wealth & Legacy',
        metaDescription:
          '80+ services, 187 deliverable checkpoints across 7 coordinated focus areas — delivered by one unified team that knows your full picture.',
      },
      pageBuilder: [
        {
          _type: 'csHeroBlock',
          _key: k('blk'),
          eyebrow: 'Our Services',
          heading: 'One Team for Your Practice Profitability, Taxes, Wealth & Legacy.',
          subheading:
            'No silos. No hand-offs. Every focus area below is delivered by the same unified team that already knows your full picture.',
          ctaLabel: 'Book a Free Consultation',
          ctaHref: '/contact',
        },
        {
          _type: 'csFocusAreaListBlock',
          _key: k('blk'),
          heading: 'Seven coordinated focus areas',
          summaryLine: '80+ services, 187 deliverable checkpoints across 7 coordinated focus areas.',
          areas: FOCUS_AREAS.map((fa) => paRef(fa.slug)),
          showDeliverableCounts: true,
        },
        {
          _type: 'csCompareBlock',
          _key: k('blk'),
          eyebrow: "Why We're Different",
          heading: "We Don't Just Manage One Part of Your Financial Life.",
          intro: 'We coordinate the entire money team behind your practice, taxes, wealth, and legacy.',
          leftLabel: 'Traditional',
          rightLabel: 'Aligned Advisors',
          rows: [
            { _type: 'csCompareRow', _key: k('it'), leftWho: 'Traditional Bookkeeper', leftQuote: 'Here are your reports.', rightQuote: 'Here is what your numbers mean and what to fix.' },
            { _type: 'csCompareRow', _key: k('it'), leftWho: 'Traditional CPA', leftQuote: 'Here is what you owe.', rightQuote: 'Here is how we plan ahead to reduce surprises.' },
            { _type: 'csCompareRow', _key: k('it'), leftWho: 'Traditional Financial Advisor', leftQuote: 'Here is your portfolio.', rightQuote: 'Here is your complete roadmap to financial freedom.' },
            { _type: 'csCompareRow', _key: k('it'), leftWho: 'Traditional Dental Consultant', leftQuote: 'Increase production.', rightQuote: 'Increase profit, reduce taxes, and build wealth beyond the chair.' },
            { _type: 'csCompareRow', _key: k('it'), leftWho: 'Traditional Siloed Advisors', leftQuote: 'Talk to your other advisor.', rightQuote: 'We coordinate the full team so every decision works together.' },
          ],
        },
        {
          _type: 'csCtaBannerBlock',
          _key: k('blk'),
          heading: "Not sure where to start? Take the Wealth Journey Quiz and we'll show you exactly which stage you're in.",
          ctaLabel: 'Take the Wealth Journey Quiz',
          ctaHref: '/assessment',
        },
      ],
    },
    {
      slug: 'about',
      title: 'About Us',
      seo: {
        _type: 'csSeo',
        metaTitle: 'About — One Team, Working as One System',
        metaDescription:
          'A single team coordinating your tax strategy, investments, practice financials, and legal structure — built around the life you actually want.',
      },
      pageBuilder: [
        {
          _type: 'csHeroBlock',
          _key: k('blk'),
          eyebrow: 'About Us',
          heading: "Because you didn't become a dentist to manage a finance department.",
          subheading:
            'When you work with us, you get a team that treats your practice and personal finances as one connected system — coordinated, proactive, and built around the life you actually want.',
          ctaLabel: 'Take the Wealth Journey Quiz',
          ctaHref: '/assessment',
        },
        {
          _type: 'csIntroBlock',
          _key: k('blk'),
          heading: 'One team, working as one system.',
          layout: 'stacked',
          body: pt(
            "A single team coordinating your tax strategy, investments, practice financials, and legal structure — so nothing falls through the cracks between advisors who've never spoken to each other.",
            'Real visibility into your numbers every month, not just a report once a year, so you always know what is working and what is leaking.',
            'A defined path from where you are today to the life you actually want — more profit, less tax drag, real passive income, and the freedom to step away from the chair when you are ready.',
          ),
        },
        {
          _type: 'csTeamGridBlock',
          _key: k('blk'),
          eyebrow: 'The Team',
          heading: 'Your Complete Advisory Team',
          intro: 'Experts in every discipline, working together for you.',
          mode: 'all',
          linkToProfiles: true,
        },
        {
          _type: 'csCtaBannerBlock',
          _key: k('blk'),
          heading: "You've built a great practice. Let's make sure it builds you a great life, too.",
          ctaLabel: 'Book a Free Consultation',
          ctaHref: '/contact',
        },
      ],
    },
    {
      slug: 'insights',
      title: 'Insights & Events',
      seo: {
        _type: 'csSeo',
        metaTitle: 'Insights — The Dental Wealth Mastermind Podcast',
        metaDescription:
          'Straight talk on the financial challenges of running a dental practice — and how to solve them. Built for practice owners who want financial freedom.',
      },
      pageBuilder: [
        {
          _type: 'csTabbedInsightsBlock',
          _key: k('blk'),
          eyebrow: 'Insights & Events',
          tabs: [
            { _type: 'csInsightsTab', _key: k('it'), label: 'Podcast', sublabel: 'Dental Wealth Mastermind episodes', href: '/insights', icon: 'podcast' },
            { _type: 'csInsightsTab', _key: k('it'), label: 'Speaking', sublabel: 'Live events & conference talks', href: '/insights/speaking', icon: 'mic' },
          ],
        },
        {
          _type: 'csIntroBlock',
          _key: k('blk'),
          eyebrow: 'The Podcast',
          heading: 'Dental Wealth Mastermind',
          layout: 'stacked',
          body: pt(
            'Straight talk on the financial challenges of running a dental practice — and how to solve them. No fluff, no generic advice. Every episode is built for practice owners who want to move faster toward financial freedom.',
          ),
        },
        {
          _type: 'csEpisodeListBlock',
          _key: k('blk'),
          heading: 'Recent Episodes',
          kind: 'publication',
          limit: 12,
          showListenLinks: true,
        },
        consultationCta,
      ],
    },
    {
      slug: 'insights-speaking',
      title: 'Speaking & Events',
      seo: {
        _type: 'csSeo',
        metaTitle: 'Speaking & Events',
        metaDescription: 'Live events, conference talks, and speaking engagements from the Aligned Advisors team.',
      },
      pageBuilder: [
        {
          _type: 'csTabbedInsightsBlock',
          _key: k('blk'),
          eyebrow: 'Insights & Events',
          tabs: [
            { _type: 'csInsightsTab', _key: k('it'), label: 'Podcast', sublabel: 'Dental Wealth Mastermind episodes', href: '/insights', icon: 'podcast' },
            { _type: 'csInsightsTab', _key: k('it'), label: 'Speaking', sublabel: 'Live events & conference talks', href: '/insights/speaking', icon: 'mic' },
          ],
        },
        {
          _type: 'csIntroBlock',
          _key: k('blk'),
          eyebrow: 'Speaking',
          heading: 'Live events & conference talks',
          layout: 'stacked',
          body: pt(
            'The Aligned Advisors team speaks at dental conferences, study clubs, and industry events on practice profitability, proactive tax strategy, and building wealth beyond the chair.',
          ),
        },
        {
          _type: 'csEpisodeListBlock',
          _key: k('blk'),
          heading: 'Recent Talks',
          kind: 'presentation',
          limit: 12,
          showListenLinks: false,
        },
        {
          _type: 'csCtaBannerBlock',
          _key: k('blk'),
          heading: 'Want the Aligned Advisors team at your event?',
          ctaLabel: 'Submit a Speaker Inquiry',
          ctaHref: '/contact',
        },
      ],
    },
    {
      slug: 'contact',
      title: 'Contact Us',
      seo: {
        _type: 'csSeo',
        metaTitle: 'Contact — Book a Free Consultation',
        metaDescription:
          'Book a complimentary, no-obligation strategy call and see whether the Aligned Advisors family office model is the right fit.',
      },
      pageBuilder: [consultationCta],
    },
    {
      slug: 'assessment',
      title: 'Wealth Journey Assessment',
      seo: {
        _type: 'csSeo',
        metaTitle: 'Where Are You on the Wealth Journey?',
        metaDescription:
          'A short assessment that identifies where you are on the Wealth Journey — and what to focus on next to move forward with clarity and confidence.',
      },
      pageBuilder: [
        {
          _type: 'csAssessmentBlock',
          _key: k('blk'),
          introHeading: 'Where are you on the Wealth Journey?',
          introBody:
            'This short assessment helps you identify where you are on the Wealth Journey — and what to focus on next to move forward with clarity and confidence.',
          startLabel: 'Start Assessment',
          quiz: { _type: 'reference', _ref: ASSESSMENT_ID },
          captureTiming: 'after-result',
          resultCtaLabel: 'Book your complimentary strategy call',
          resultCtaHref: '/contact',
        },
      ],
    },
    // Legal pages — placeholder bodies pending the client's own copy (site is
    // noindexed until cutover; csDisclosureBlock carries the real text later).
    ...['privacy', 'terms', 'disclosures'].map((slug) => ({
      slug,
      title: slug === 'privacy' ? 'Privacy Policy' : slug === 'terms' ? 'Terms of Service' : 'Disclosures',
      seo: { _type: 'csSeo' as const, noindex: true },
      pageBuilder: [
        {
          _type: 'csDisclosureBlock',
          _key: k('blk'),
          heading: slug === 'privacy' ? 'Privacy Policy' : slug === 'terms' ? 'Terms of Service' : 'Disclosures',
          content: pt('This page is pending final copy from Aligned Advisors. Content will be published before launch.'),
          note: 'Placeholder — replace with client-approved legal copy before DNS cutover.',
        },
      ],
    })),
  ].map((page) => ({
    _id: csPageDocId(SITE_KEY, page.slug),
    _type: 'csPage',
    site: siteRef,
    title: page.title,
    slug: { _type: 'slug', current: page.slug },
    seo: page.seo,
    pageBuilder: page.pageBuilder,
    publishedAt: '2026-08-05T00:00:00Z',
  }));

  // -------------------------------------------------------------------------
  // Write — dependency-ordered chunks so references resolve as they land.
  // -------------------------------------------------------------------------
  const chunks: Array<Array<Record<string, unknown>>> = [
    [site],
    practiceAreas,
    team,
    stages,
    caseStudies,
    [assessment],
    episodes,
    pages,
  ];

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
  console.log('  - leadRecipients seeded as info@alignedadvisors.com — confirm with the client.');
  console.log('  - Badge/logo wall + benchmark-report PDFs are client-supplied and NOT seeded.');
  console.log('  - robotsDisallow is TRUE (noindexed) until DNS cutover per the go-live runbook.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
