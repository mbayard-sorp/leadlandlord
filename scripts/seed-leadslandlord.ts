#!/usr/bin/env -S tsx
/**
 * Seed the leadslandlord.com corporate marketing site into Sanity:
 *   - one corporateSite singleton (brand identity, nav, footer, SMS disclosure)
 *   - seven corporatePage docs (home, services, pricing, about, contact, privacy, terms)
 *
 * Idempotent — re-running overwrites in place via createOrReplace, so the
 * corporate communication agent + SEO expert can iterate on copy without
 * blowing away references.
 *
 * Usage:
 *   pnpm tsx scripts/seed-leadslandlord.ts                       # production
 *   pnpm tsx scripts/seed-leadslandlord.ts --dataset development
 *   pnpm tsx scripts/seed-leadslandlord.ts --dataset all
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
const envFile = findEnvFile(__dirname, '.env');
if (envFile) loadEnv({ path: envFile, override: true });

import {
  createWriteClient,
  corporateSiteDocId,
  corporatePageDocId,
  CORPORATE_PAGE_KINDS,
  type CorporatePageKind,
} from '@leadlandlord/sanity-schema';

const BRAND = 'LeadLandlord';
const PRIMARY_HOST = 'leadslandlord.com';

const SMS_DISCLOSURE = `By providing your phone number you consent to receive SMS messages from ${BRAND} regarding your account, free trial, and service updates. Message frequency varies. Message and data rates may apply. Reply HELP for help, STOP to unsubscribe at any time. We do not share your mobile information with third parties or affiliates for marketing or promotional purposes.`;

const NAV_ITEMS = [
  { label: 'Services', href: '/services' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

const FOOTER_LINKS = [
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Contact', href: '/contact' },
];

const PRIMARY_CTA = { label: 'Start your free week', href: '/contact' };

interface PageSeed {
  kind: CorporatePageKind;
  slug: string;
  title: string;
  metaDescription: string;
  heroEyebrow?: string;
  heroHeadline?: string;
  heroSubhead?: string;
  mdx: string;
  jsonLd?: string;
}

const PAGES: PageSeed[] = [
  {
    kind: 'home',
    slug: '',
    title: `${BRAND} — Custom lead-gen sites for local service businesses`,
    metaDescription:
      'We build the website, run the marketing, and send qualified calls to your phone. Free for a week. No commitments. No catches.',
    heroEyebrow: 'Lead generation, done for you',
    heroHeadline: 'Qualified calls, sent straight to your phone.',
    heroSubhead:
      'We build the site, run the marketing, and forward every qualified lead to your business line. Free for a week. No commitments. No catches.',
    mdx: `## How it works

1. **We build the site.** Custom landing page for your trade and city — copy, photos, schema, the works. No templates.
2. **We run the marketing.** Local SEO, Google Business Profile, and paid ads where it makes sense. You don't lift a finger.
3. **You answer the phone.** Every qualified call forwards to your business line. We track outcomes so you know what's working.

## Who it's for

Local service businesses with proven demand and the capacity to take more work — tree removal, junk hauling, plumbing, HVAC, lawn care, cleaning, moving, pest control. Anything where a phone call is the conversion.

## Why "free for a week"?

Because we're confident the calls will speak for themselves. Run the trial. Keep every lead it generates. If it's not earning you more than it'll cost, walk away.

[Start your free week →](/contact)`,
  },
  {
    kind: 'services',
    slug: 'services',
    title: 'Services',
    metaDescription:
      'A custom lead-gen website plus the marketing engine to drive qualified calls to your local service business.',
    heroEyebrow: 'What you get',
    heroHeadline: 'A complete lead-gen system, built around your trade.',
    heroSubhead:
      'One package. Everything you need to start receiving qualified calls within a week.',
    mdx: `## What's included

### Custom landing page
A site built from scratch for your trade and city. Real photography, real copy, schema markup, fast load times. Not a template.

### Local SEO foundation
Google Business Profile claim and optimization. Local schema. Citations to the directories that move the needle. Built to rank in your service area.

### Call tracking
Every call to the site forwards to your business line. We record outcomes (booked / quoted / no-answer) so you can see what's actually working.

### Paid traffic, if it fits
For some trades and markets, Google LSAs or paid search pays back inside a month. We turn it on when the math works and turn it off when it doesn't.

### Ongoing optimization
We watch your numbers and tune the site for you — what to add, what to cut, what to test next. You don't have to think about marketing.

## What you don't get

- A login to a marketing dashboard you'll never check
- Lock-in contracts
- A junior account manager
- Generic copy that could be on any tree-removal site in any city

[See pricing →](/pricing)`,
  },
  {
    kind: 'pricing',
    slug: 'pricing',
    title: 'Pricing',
    metaDescription: 'Free for a week. No commitments. Talk to us about what comes next.',
    heroEyebrow: 'Pricing',
    heroHeadline: 'Free for a week. No commitments. No catches.',
    heroSubhead:
      "Run the trial. Keep every lead it generates. If the numbers don't work, walk away — no contract, no clawback.",
    mdx: `## The free trial

For seven days we run the site and forward every qualified call to your business line. You owe nothing. You sign nothing.

If the leads pay back the cost of the service, we'll tell you exactly what that math looks like — based on your trial week's actual numbers — and you decide whether to continue.

## After the trial

Pricing depends on your trade, your service area, and how aggressive you want to be on paid traffic. We'll give you a flat monthly number based on the volume your trial produced.

No tiers. No setup fees. No long-term contracts. Cancel any time.

## Questions?

[Email us](/contact) — we'll get back to you the same day.`,
  },
  {
    kind: 'about',
    slug: 'about',
    title: 'About',
    metaDescription:
      'LeadLandlord builds and operates lead-generation websites for local service businesses, so you can focus on the work.',
    heroEyebrow: 'About',
    heroHeadline: 'We build websites that send you customers.',
    heroSubhead:
      'Lead generation for trades and local services. Operated end-to-end so you stay focused on the job.',
    mdx: `## What we do

We build and operate lead-generation websites for local service businesses — tree removal, junk hauling, plumbing, HVAC, lawn care, cleaning, and similar trades.

You hire us. We do the website, the SEO, the listings, and the paid traffic. Calls forward to your phone. You answer them.

## Why this exists

Most local service businesses are great at the work and not interested in becoming marketers. Most marketing agencies sell tools and dashboards instead of outcomes.

We sell phone calls. That's it.

## Get in touch

Have a trade, a city, and capacity for more work? [Send us a note](/contact).`,
  },
  {
    kind: 'contact',
    slug: 'contact',
    title: 'Contact',
    metaDescription: 'Get in touch — we typically reply the same business day.',
    heroEyebrow: 'Contact',
    heroHeadline: "Let's talk.",
    heroSubhead:
      'Tell us your trade, city, and roughly how busy you are right now. We typically respond the same business day.',
    mdx: `Email is the fastest way to reach us. Include:

- Your business name and trade
- The city / service area you cover
- Whether you have a current website and Google Business Profile
- How much capacity you have for new work this month

We'll come back with whether we think we're a fit, and if so, what your free trial week would look like.`,
  },
  {
    kind: 'privacy',
    slug: 'privacy',
    title: 'Privacy Policy',
    metaDescription: `${BRAND} privacy policy — what we collect, how we use it, and how to opt out.`,
    heroEyebrow: 'Privacy',
    heroHeadline: 'Privacy Policy',
    heroSubhead: 'Last updated: 2026.',
    mdx: `## What we collect

When you contact us through this website or sign up for a trial, we collect:

- **Identifying information:** business name, your name, mailing address, email address, phone number.
- **Service information:** trade, service area, current website (if any), and details you provide about your business.
- **Technical information:** IP address, browser type, pages visited, and similar standard analytics, collected via Google Analytics 4.

## How we use it

We use your information to:

- Operate the trial and the ongoing service (build your site, route calls, send updates).
- Reply to your inquiries.
- Comply with legal obligations.

We do **not** sell your information. We do not share it with third parties for their marketing or promotional purposes.

## How we share it

We share information only with vendors that operate our service on our behalf — for example, our website host, email delivery provider, payment processor, and SMS provider. They are contractually limited to the use described above.

We may disclose information when required by law or to protect rights, safety, or the integrity of the service.

## Your choices

- **Email:** unsubscribe link on every marketing email; reply asking to be removed.
- **SMS:** reply STOP to unsubscribe; reply HELP for help. See "SMS & Messaging" below.
- **Access / deletion:** email us and we'll respond within 30 days.

## Children

Our service is not directed at children under 13 and we do not knowingly collect their information.

## Changes

We'll update the "last updated" date at the top of this page when we change this policy. Material changes will be notified by email when we have one on file.

## Contact

Questions? Email us using the address in the footer.`,
  },
  {
    kind: 'terms',
    slug: 'terms',
    title: 'Terms of Service',
    metaDescription: `${BRAND} terms of service.`,
    heroEyebrow: 'Terms',
    heroHeadline: 'Terms of Service',
    heroSubhead: 'Last updated: 2026.',
    mdx: `## Use of the service

By using ${BRAND} you agree to these terms. If you don't agree, don't use the service.

## The free trial

For the first seven days of service, you owe us nothing. You're not signing a contract. You can walk away at any time. After the trial, continued use is on a month-to-month basis at the rate quoted to you. Cancel any time, no clawback.

## What you provide

You're responsible for:

- Accurate information about your business (legal name, license numbers, service area).
- Answering the calls that forward to your business line.
- Performing the work that is booked through leads we send you.

## What we provide

We're responsible for:

- Building and operating the website.
- Running the marketing channels we agree to operate (SEO, listings, optionally paid traffic).
- Forwarding qualified calls to your business line.

We do not guarantee a specific lead volume or conversion rate. Local-business lead generation is a function of demand, capacity, and competition we don't fully control.

## Acceptable use

Don't use the service to misrepresent your business, advertise services you don't actually perform, or violate any law (including consumer protection, telemarketing, and unfair-competition law). We may terminate immediately for material breach.

## Limitation of liability

To the maximum extent permitted by law, our liability is limited to the amount you've paid us in the 12 months preceding the claim. We're not liable for lost profits or consequential damages.

## Termination

You can cancel any time by sending a note to the email address in the footer. We'll wind down the service within 14 days of your notice. We can terminate if you breach these terms or stop paying. The website, content, phone numbers, and Google Business Profile we built or operated remain ours after termination unless we explicitly transfer them.

## Changes

We may update these terms; we'll change the "last updated" date and notify you by email of material changes.

## Contact

Questions? Email us using the address in the footer.`,
  },
];

function parseDatasetArg(): string[] {
  const { values } = parseArgs({
    options: { dataset: { type: 'string', default: 'production' } },
    allowPositionals: false,
  });
  const v = values.dataset!;
  if (v === 'all') return ['production', 'development'];
  return [v];
}

async function seedDataset(dataset: string) {
  const client = createWriteClient({ dataset });
  const tx = client.transaction();

  tx.createOrReplace({
    _id: corporateSiteDocId(),
    _type: 'corporateSite',
    brandName: BRAND,
    tagline: 'Custom lead-gen sites for local service businesses.',
    primaryHost: PRIMARY_HOST,
    legalEntity: {
      name: '[Placeholder] LeadLandlord LLC',
      dba: '',
      address: '[Placeholder — registered address TBD]',
      supportEmail: 'hello@leadslandlord.com',
      legalEmail: 'legal@leadslandlord.com',
    },
    navItems: NAV_ITEMS,
    footerLinks: FOOTER_LINKS,
    primaryCta: PRIMARY_CTA,
    smsDisclosure: SMS_DISCLOSURE,
    robotsDisallow: true,
  });

  for (const seed of PAGES) {
    tx.createOrReplace({
      _id: corporatePageDocId(seed.kind),
      _type: 'corporatePage',
      kind: seed.kind,
      slug: seed.slug,
      title: seed.title,
      metaDescription: seed.metaDescription,
      heroEyebrow: seed.heroEyebrow,
      heroHeadline: seed.heroHeadline,
      heroSubhead: seed.heroSubhead,
      mdx: seed.mdx,
      jsonLd: seed.jsonLd,
    });
  }

  const res = await tx.commit({ visibility: 'sync' });
  console.log(
    `[seed] dataset=${dataset} corporate site + ${PAGES.length} pages seeded (${CORPORATE_PAGE_KINDS.length} kinds total) — txn=${res.transactionId}`,
  );
}

async function main() {
  const datasets = parseDatasetArg();
  for (const dataset of datasets) {
    await seedDataset(dataset);
  }
  console.log('[seed] done.');
}

main().catch((err) => {
  console.error('[seed] error:', err);
  process.exit(1);
});
