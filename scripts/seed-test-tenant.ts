#!/usr/bin/env -S tsx
/**
 * Seed FOUR fully-featured test tenants into the Sanity `development` dataset,
 * one per theme (classic / modern / premium / bright).
 *
 * Idempotent — uses deterministic IDs so re-running overwrites in place.
 *
 * Usage:  pnpm tsx scripts/seed-test-tenant.ts
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

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

import { createWriteClient } from '@leadlandlord/sanity-schema/client';
import { siteDocId, pageDocId, themeDocId, type ThemeName, type PageKind } from '@leadlandlord/sanity-schema/ids';

const NOW = new Date().toISOString();

// ---------------------------------------------------------------------------
// Tenant definitions — one per theme
// ---------------------------------------------------------------------------

interface ReviewSeed {
  author: string;
  rating: number;
  text: string;
  source: 'google' | 'yelp' | 'bbb' | 'facebook' | 'direct';
  date: string;
}

interface PageSeed {
  kind: PageKind;
  index: number;
  slug: string;
  title: string;
  metaDescription: string;
  mdx: string;
}

interface TenantDef {
  siteId: string;
  slug: string;
  businessName: string;
  niche: string;
  city: string;
  state: string;
  theme: ThemeName;
  trustSignals: string[];
  nearbyCities: string[];
  pages: PageSeed[];
  reviews: ReviewSeed[];
}

const TENANTS: TenantDef[] = [
  // -------------------------------------------------------------------------
  // 1. classic — HVAC / Phoenix AZ
  // -------------------------------------------------------------------------
  {
    siteId: '11110000-0000-0000-0000-000000000001',
    slug: 'restyle-classic-hvac',
    businessName: 'Desert Air HVAC',
    niche: 'hvac',
    city: 'Phoenix',
    state: 'AZ',
    theme: 'classic',
    trustSignals: ['Licensed and insured', '24/7 emergency service', 'Free estimates'],
    nearbyCities: ['Scottsdale', 'Tempe', 'Chandler', 'Mesa'],
    reviews: [
      {
        author: 'R. Navarro',
        rating: 5,
        text: '[TESTIMONIAL — REPLACE]',
        source: 'google',
        date: '2025-11-15',
      },
      {
        author: 'S. Whitfield',
        rating: 5,
        text: '[TESTIMONIAL — REPLACE]',
        source: 'google',
        date: '2025-10-03',
      },
    ],
    pages: [
      {
        kind: 'home',
        index: 0,
        slug: '/',
        title: 'HVAC Repair & Installation in Phoenix, AZ',
        metaDescription:
          'Phoenix HVAC service — AC repair, furnace install, duct cleaning. Same-day dispatch. Licensed and insured.',
        mdx: '# HVAC Repair & Installation in Phoenix, AZ\n\nKeeping Phoenix comfortable all year long.',
      },
      {
        kind: 'about',
        index: 0,
        slug: '/about',
        title: 'About Desert Air HVAC',
        metaDescription: 'Family-owned HVAC company serving Phoenix and the Valley.',
        mdx: '## About\n\nWe have been keeping Phoenix homes cool in summer and warm in winter. [YEARS-IN-BUSINESS] years of local service.',
      },
      {
        kind: 'contact',
        index: 0,
        slug: '/contact',
        title: 'Contact Desert Air HVAC',
        metaDescription: 'Call or request a free estimate from Desert Air HVAC in Phoenix.',
        mdx: '## Get a Free Estimate\n\nCall us or use the form below.',
      },
      {
        kind: 'service',
        index: 0,
        slug: '/services/ac-repair',
        title: 'AC Repair Phoenix',
        metaDescription: 'Fast AC repair in Phoenix — same-day appointments available.',
        mdx: '### AC Repair\n\nDiagnosis and repair for all makes and models.',
      },
      {
        kind: 'service',
        index: 1,
        slug: '/services/furnace-installation',
        title: 'Furnace Installation Phoenix',
        metaDescription: 'High-efficiency furnace installation by licensed HVAC techs.',
        mdx: '### Furnace Installation\n\nWe size, supply, and install.',
      },
      {
        kind: 'service',
        index: 2,
        slug: '/services/duct-cleaning',
        title: 'Duct Cleaning Phoenix',
        metaDescription: 'Professional duct cleaning improves air quality and system efficiency.',
        mdx: '### Duct Cleaning\n\nFull system inspection and clean-out.',
      },
      {
        kind: 'service',
        index: 3,
        slug: '/services/heat-pump',
        title: 'Heat Pump Service Phoenix',
        metaDescription: 'Heat pump repair and installation in Phoenix AZ.',
        mdx: '### Heat Pump Service\n\nRepair, tune-up, or new install.',
      },
      {
        kind: 'service_area',
        index: 0,
        slug: '/service-areas/scottsdale',
        title: 'HVAC Service in Scottsdale, AZ',
        metaDescription: 'Desert Air HVAC serves Scottsdale with same-day AC and heating service.',
        mdx: '### Scottsdale HVAC\n\nWe cover all of Scottsdale.',
      },
      {
        kind: 'service_area',
        index: 1,
        slug: '/service-areas/tempe',
        title: 'HVAC Service in Tempe, AZ',
        metaDescription: 'Fast HVAC repair and installation in Tempe.',
        mdx: '### Tempe HVAC\n\nTempe residents call us first.',
      },
      {
        kind: 'blog',
        index: 0,
        slug: '/blog/when-to-replace-ac-unit',
        title: 'When Should You Replace Your AC Unit?',
        metaDescription: 'Signs your Phoenix AC is past its prime and what to do next.',
        mdx: '# When Should You Replace Your AC Unit?\n\nMost units last 10-15 years in the Phoenix heat. Look for rising energy bills and frequent repairs.',
      },
      {
        kind: 'blog',
        index: 1,
        slug: '/blog/summer-hvac-prep',
        title: 'How to Prep Your HVAC for a Phoenix Summer',
        metaDescription: 'Pre-season HVAC checklist to survive Arizona summers.',
        mdx: '# How to Prep Your HVAC for a Phoenix Summer\n\nChange filters, clear the condenser pad, and book a tune-up before May.',
      },
      {
        kind: 'info',
        index: 0,
        slug: '/financing',
        title: 'HVAC Financing Options',
        metaDescription: 'Flexible payment plans for Phoenix HVAC repair and installation.',
        mdx: '## Financing\n\nAsk about 0% interest plans for qualifying installs.',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 2. modern — Solar / Austin TX
  // -------------------------------------------------------------------------
  {
    siteId: '22220000-0000-0000-0000-000000000002',
    slug: 'restyle-modern-solar',
    businessName: 'Lone Star Solar',
    niche: 'solar installation',
    city: 'Austin',
    state: 'TX',
    theme: 'modern',
    trustSignals: ['NABCEP certified installers', '25-year panel warranty', 'Zero-down financing'],
    nearbyCities: ['Round Rock', 'Cedar Park', 'Pflugerville', 'Georgetown'],
    reviews: [
      {
        author: 'M. Torres',
        rating: 5,
        text: '[TESTIMONIAL — REPLACE]',
        source: 'google',
        date: '2025-12-01',
      },
      {
        author: 'J. Kim',
        rating: 5,
        text: '[TESTIMONIAL — REPLACE]',
        source: 'google',
        date: '2025-11-20',
      },
    ],
    pages: [
      {
        kind: 'home',
        index: 0,
        slug: '/',
        title: 'Solar Panel Installation in Austin, TX',
        metaDescription:
          'Austin solar installation — residential and commercial panels, battery storage, EV chargers. NABCEP certified.',
        mdx: '# Solar Panel Installation in Austin, TX\n\nCut your energy bill with local solar experts.',
      },
      {
        kind: 'about',
        index: 0,
        slug: '/about',
        title: 'About Lone Star Solar',
        metaDescription: 'NABCEP-certified Austin solar installers with deep local roots.',
        mdx: '## About\n\nLone Star Solar serves Austin and the surrounding Hill Country.',
      },
      {
        kind: 'contact',
        index: 0,
        slug: '/contact',
        title: 'Get a Solar Quote',
        metaDescription: 'Free solar assessment for Austin homeowners and businesses.',
        mdx: '## Free Solar Assessment\n\nWe size your system based on your actual utility bill.',
      },
      {
        kind: 'service',
        index: 0,
        slug: '/services/residential-solar',
        title: 'Residential Solar Austin',
        metaDescription: 'Home solar systems installed by NABCEP-certified Austin pros.',
        mdx: '### Residential Solar\n\nCustom-sized systems, zero-down financing available.',
      },
      {
        kind: 'service',
        index: 1,
        slug: '/services/battery-storage',
        title: 'Solar Battery Storage Austin',
        metaDescription: 'Keep the lights on during grid outages with home battery backup.',
        mdx: '### Battery Storage\n\nPair your panels with whole-home backup.',
      },
      {
        kind: 'service',
        index: 2,
        slug: '/services/ev-charger-install',
        title: 'EV Charger Installation Austin',
        metaDescription: 'Level 2 EV charger installation by licensed Austin electricians.',
        mdx: '### EV Charger Install\n\nCharge overnight for pennies with solar power.',
      },
      {
        kind: 'service',
        index: 3,
        slug: '/services/commercial-solar',
        title: 'Commercial Solar Austin',
        metaDescription: 'Commercial solar for Austin businesses — rooftop and ground-mount.',
        mdx: '### Commercial Solar\n\nReduce operating costs with a commercial solar array.',
      },
      {
        kind: 'service_area',
        index: 0,
        slug: '/service-areas/round-rock',
        title: 'Solar Installation in Round Rock, TX',
        metaDescription: 'Lone Star Solar serves Round Rock with residential and commercial solar.',
        mdx: '### Round Rock Solar\n\nNeighbors all over Round Rock are going solar.',
      },
      {
        kind: 'service_area',
        index: 1,
        slug: '/service-areas/cedar-park',
        title: 'Solar Installation in Cedar Park, TX',
        metaDescription: 'Cedar Park homeowners choose Lone Star Solar for reliability and value.',
        mdx: '### Cedar Park Solar\n\nServing Cedar Park and the surrounding Hill Country.',
      },
      {
        kind: 'blog',
        index: 0,
        slug: '/blog/how-long-until-solar-pays-off',
        title: 'How Long Until Solar Pays for Itself in Austin?',
        metaDescription: 'Solar payback period calculator and real Austin numbers.',
        mdx: '# How Long Until Solar Pays for Itself in Austin?\n\nMost Austin systems hit payback in 6-8 years based on current ERCOT rates.',
      },
      {
        kind: 'blog',
        index: 1,
        slug: '/blog/texas-solar-incentives-2025',
        title: 'Texas Solar Tax Credits and Incentives for 2025',
        metaDescription: 'A rundown of federal and Texas-specific solar incentives available now.',
        mdx: '# Texas Solar Tax Credits and Incentives for 2025\n\nThe 30% federal ITC is still in effect. Here is what Austin homeowners need to know.',
      },
      {
        kind: 'info',
        index: 0,
        slug: '/solar-financing',
        title: 'Solar Financing Options in Austin',
        metaDescription: 'Zero-down loans and leases for Austin solar buyers.',
        mdx: '## Solar Financing\n\nWe work with multiple lenders to get you the best rate.',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 3. premium — Kitchen Remodel / Denver CO
  // -------------------------------------------------------------------------
  {
    siteId: '33330000-0000-0000-0000-000000000003',
    slug: 'restyle-premium-remodel',
    businessName: 'Summit Design+Build',
    niche: 'kitchen remodel',
    city: 'Denver',
    state: 'CO',
    theme: 'premium',
    trustSignals: ['General contractor license [LICENSE #]', 'Fully bonded and insured', 'Fixed-price contracts'],
    nearbyCities: ['Boulder', 'Lakewood', 'Aurora', 'Englewood'],
    reviews: [
      {
        author: 'C. Ohlson',
        rating: 5,
        text: '[TESTIMONIAL — REPLACE]',
        source: 'direct',
        date: '2025-10-28',
      },
      {
        author: 'P. Reyes',
        rating: 5,
        text: '[TESTIMONIAL — REPLACE]',
        source: 'google',
        date: '2025-09-14',
      },
    ],
    pages: [
      {
        kind: 'home',
        index: 0,
        slug: '/',
        title: 'Kitchen Remodel Denver, CO',
        metaDescription:
          'Denver kitchen remodeling — design, demo, and build by a licensed general contractor. Fixed-price quotes.',
        mdx: '# Kitchen Remodel Denver, CO\n\nTransform your kitchen with Summit Design+Build.',
      },
      {
        kind: 'about',
        index: 0,
        slug: '/about',
        title: 'About Summit Design+Build',
        metaDescription: 'Denver licensed general contractor specializing in kitchen and bath remodels.',
        mdx: '## About\n\nSummit Design+Build is Denver\'s trusted remodeling partner. License [LICENSE #].',
      },
      {
        kind: 'contact',
        index: 0,
        slug: '/contact',
        title: 'Request a Remodel Consultation',
        metaDescription: 'Schedule a free in-home design consultation with Summit Design+Build.',
        mdx: '## Free Consultation\n\nWe come to you — design ideas and a fixed-price quote in one visit.',
      },
      {
        kind: 'service',
        index: 0,
        slug: '/services/full-kitchen-remodel',
        title: 'Full Kitchen Remodel Denver',
        metaDescription: 'Complete kitchen gut and rebuild — layout, cabinets, counters, appliances.',
        mdx: '### Full Kitchen Remodel\n\nWe handle everything from permit to punch-list.',
      },
      {
        kind: 'service',
        index: 1,
        slug: '/services/custom-cabinetry',
        title: 'Custom Cabinetry Denver',
        metaDescription: 'Semi-custom and full-custom kitchen cabinets built for Denver homes.',
        mdx: '### Custom Cabinetry\n\nDovetail construction, soft-close, locally sourced where possible.',
      },
      {
        kind: 'service',
        index: 2,
        slug: '/services/countertop-install',
        title: 'Countertop Installation Denver',
        metaDescription: 'Quartz, granite, quartzite, marble — template and install by Summit.',
        mdx: '### Countertop Installation\n\nWe template digitally for zero seam surprises.',
      },
      {
        kind: 'service',
        index: 3,
        slug: '/services/bath-remodel',
        title: 'Bathroom Remodel Denver',
        metaDescription: 'Primary bath and guest bath remodeling by Summit Design+Build.',
        mdx: '### Bathroom Remodel\n\nFull gut to finished tile — on schedule, on budget.',
      },
      {
        kind: 'service_area',
        index: 0,
        slug: '/service-areas/boulder',
        title: 'Kitchen Remodel in Boulder, CO',
        metaDescription: 'Summit Design+Build serves Boulder with licensed kitchen and bath remodeling.',
        mdx: '### Boulder Remodeling\n\nWe regularly work in Boulder and the surrounding foothills.',
      },
      {
        kind: 'service_area',
        index: 1,
        slug: '/service-areas/lakewood',
        title: 'Kitchen Remodel in Lakewood, CO',
        metaDescription: 'Lakewood homeowners choose Summit for quality and fixed pricing.',
        mdx: '### Lakewood Remodeling\n\nServing Lakewood and the western suburbs of Denver.',
      },
      {
        kind: 'blog',
        index: 0,
        slug: '/blog/how-much-does-a-kitchen-remodel-cost-in-denver',
        title: 'How Much Does a Kitchen Remodel Cost in Denver?',
        metaDescription: 'Real Denver kitchen remodel cost ranges by scope, with material tiers explained.',
        mdx: '# How Much Does a Kitchen Remodel Cost in Denver?\n\nMid-range kitchens in Denver run $45k-$80k in 2025. Here is what drives the number.',
      },
      {
        kind: 'blog',
        index: 1,
        slug: '/blog/quartz-vs-granite-denver-kitchens',
        title: 'Quartz vs Granite for Denver Kitchens',
        metaDescription: 'Comparing the two most popular countertop materials for Colorado homes.',
        mdx: '# Quartz vs Granite for Denver Kitchens\n\nBoth work beautifully at altitude. Here is how to choose.',
      },
      {
        kind: 'info',
        index: 0,
        slug: '/our-process',
        title: 'Our Remodeling Process',
        metaDescription: 'How Summit Design+Build runs a kitchen remodel from first call to final walk.',
        mdx: '## Our Process\n\nDesign consultation → fixed-price contract → permit pull → build → punch-list → done.',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 4. bright — Cleaning / Nashville TN
  // -------------------------------------------------------------------------
  {
    siteId: '44440000-0000-0000-0000-000000000004',
    slug: 'restyle-bright-cleaning',
    businessName: 'Spotless Nashville',
    niche: 'house cleaning',
    city: 'Nashville',
    state: 'TN',
    theme: 'bright',
    trustSignals: ['Bonded and insured', 'Background-checked cleaners', 'Satisfaction guarantee'],
    nearbyCities: ['Brentwood', 'Franklin', 'Hendersonville', 'Murfreesboro'],
    reviews: [
      {
        author: 'A. Pemberton',
        rating: 5,
        text: '[TESTIMONIAL — REPLACE]',
        source: 'google',
        date: '2025-12-10',
      },
      {
        author: 'L. Huang',
        rating: 5,
        text: '[TESTIMONIAL — REPLACE]',
        source: 'yelp',
        date: '2025-11-30',
      },
    ],
    pages: [
      {
        kind: 'home',
        index: 0,
        slug: '/',
        title: 'House Cleaning Service in Nashville, TN',
        metaDescription:
          'Nashville house cleaning — recurring maid service, deep cleans, move-in/out. Bonded, insured, background-checked.',
        mdx: '# House Cleaning Service in Nashville, TN\n\nSpotless Nashville keeps your home guest-ready.',
      },
      {
        kind: 'about',
        index: 0,
        slug: '/about',
        title: 'About Spotless Nashville',
        metaDescription: 'Nashville cleaning company with bonded, background-checked cleaners.',
        mdx: '## About\n\nSpotless Nashville is a locally owned cleaning service. Every cleaner is background-checked and bonded.',
      },
      {
        kind: 'contact',
        index: 0,
        slug: '/contact',
        title: 'Book a Cleaning',
        metaDescription: 'Book a one-time or recurring house cleaning in Nashville.',
        mdx: '## Book Online or Call\n\nGet an instant quote and pick your date.',
      },
      {
        kind: 'service',
        index: 0,
        slug: '/services/recurring-cleaning',
        title: 'Recurring House Cleaning Nashville',
        metaDescription: 'Weekly or bi-weekly maid service in Nashville — same team every visit.',
        mdx: '### Recurring Cleaning\n\nSame cleaner, same schedule, consistent results.',
      },
      {
        kind: 'service',
        index: 1,
        slug: '/services/deep-cleaning',
        title: 'Deep Cleaning Nashville',
        metaDescription: 'One-time deep clean for Nashville homes — baseboards, inside appliances, grout.',
        mdx: '### Deep Cleaning\n\nPerfect before a party, after a renovation, or just because.',
      },
      {
        kind: 'service',
        index: 2,
        slug: '/services/move-in-out-cleaning',
        title: 'Move-In / Move-Out Cleaning Nashville',
        metaDescription: 'Nashville move-out cleans that pass landlord inspections.',
        mdx: '### Move-In / Move-Out\n\nWe clean to landlord-inspection standard.',
      },
      {
        kind: 'service',
        index: 3,
        slug: '/services/airbnb-turnover',
        title: 'Airbnb Turnover Cleaning Nashville',
        metaDescription: 'Fast, reliable Airbnb turnovers in Nashville — laundry, restock, inspect.',
        mdx: '### Airbnb Turnover\n\nSame-day turnaround available for short-term rentals.',
      },
      {
        kind: 'service_area',
        index: 0,
        slug: '/service-areas/brentwood',
        title: 'House Cleaning in Brentwood, TN',
        metaDescription: 'Spotless Nashville serves Brentwood with top-rated residential cleaning.',
        mdx: '### Brentwood Cleaning\n\nBrentwood neighbors trust Spotless Nashville.',
      },
      {
        kind: 'service_area',
        index: 1,
        slug: '/service-areas/franklin',
        title: 'House Cleaning in Franklin, TN',
        metaDescription: 'Franklin house cleaning by bonded, background-checked cleaners.',
        mdx: '### Franklin Cleaning\n\nServing Franklin and the surrounding Williamson County.',
      },
      {
        kind: 'blog',
        index: 0,
        slug: '/blog/how-often-should-you-deep-clean-your-home',
        title: 'How Often Should You Deep Clean Your Home?',
        metaDescription: 'A Nashville cleaner explains the schedule most households need.',
        mdx: '# How Often Should You Deep Clean Your Home?\n\nMost Nashville homes benefit from a deep clean every 3-6 months on top of regular maintenance.',
      },
      {
        kind: 'blog',
        index: 1,
        slug: '/blog/natural-vs-chemical-cleaners',
        title: 'Natural vs Chemical Cleaners: What We Actually Use',
        metaDescription: 'Spotless Nashville breaks down the products we choose and why.',
        mdx: '# Natural vs Chemical Cleaners: What We Actually Use\n\nWe default to plant-based products and step up only when the job demands it.',
      },
      {
        kind: 'info',
        index: 0,
        slug: '/booking-faq',
        title: 'Booking FAQ',
        metaDescription: 'Common questions about scheduling, pricing, and what to expect.',
        mdx: '## Booking FAQ\n\nYes, we bring supplies. No, you do not need to be home. Cancel anytime.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Deterministic review ID — no separate helper exported yet, so inline here.
// ---------------------------------------------------------------------------
function reviewDocId(siteId: string, index: number): string {
  return `review-${siteId}-${index}`;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

async function seedTenant(sanity: ReturnType<typeof createWriteClient>, t: TenantDef) {
  const tx = sanity.transaction();

  // Pages
  for (const p of t.pages) {
    tx.createOrReplace({
      _id: pageDocId(t.siteId, p.kind, p.index),
      _type: 'page',
      site: { _ref: siteDocId(t.siteId), _type: 'reference' },
      kind: p.kind,
      slug: p.slug,
      title: p.title,
      metaDescription: p.metaDescription,
      mdx: p.mdx,
    });
  }

  // Reviews
  for (let i = 0; i < t.reviews.length; i++) {
    const r = t.reviews[i];
    tx.createOrReplace({
      _id: reviewDocId(t.siteId, i),
      _type: 'review',
      siteRef: { _ref: siteDocId(t.siteId), _type: 'reference' },
      author: r.author,
      rating: r.rating,
      text: r.text,
      source: r.source,
      date: r.date,
      verified: false,
    });
  }

  // Bucket pages by kind for site doc references
  const byKind = (kind: PageKind) => t.pages.filter((p) => p.kind === kind);

  const services = byKind('service').map((p, i) => ({
    _key: `s${i}`,
    _ref: pageDocId(t.siteId, 'service', i),
    _type: 'reference',
  }));
  const serviceAreas = byKind('service_area').map((p, i) => ({
    _key: `sa${i}`,
    _ref: pageDocId(t.siteId, 'service_area', i),
    _type: 'reference',
  }));
  const blogPosts = byKind('blog').map((p, i) => ({
    _key: `b${i}`,
    _ref: pageDocId(t.siteId, 'blog', i),
    _type: 'reference',
  }));
  const infoPages = byKind('info').map((p, i) => ({
    _key: `i${i}`,
    _ref: pageDocId(t.siteId, 'info', i),
    _type: 'reference',
  }));
  const reviewRefs = t.reviews.map((_, i) => ({
    _key: `r${i}`,
    _ref: reviewDocId(t.siteId, i),
    _type: 'reference',
  }));

  // Site doc
  tx.createOrReplace({
    _id: siteDocId(t.siteId),
    _type: 'site',
    siteId: t.siteId,
    slug: { _type: 'slug', current: t.slug },
    businessName: t.businessName,
    niche: t.niche,
    city: t.city,
    state: t.state,
    theme: { _ref: themeDocId(t.theme), _type: 'reference' },
    domains: [
      {
        _key: 'k1',
        host: `restyle-${t.theme}.example.com`,
        isPrimary: true,
        verified: true,
        attachedAt: NOW,
      },
    ],
    robotsDisallow: true,
    trustSignals: t.trustSignals,
    nearbyCities: t.nearbyCities,
    home: { _ref: pageDocId(t.siteId, 'home', 0), _type: 'reference' },
    about: { _ref: pageDocId(t.siteId, 'about', 0), _type: 'reference' },
    contact: { _ref: pageDocId(t.siteId, 'contact', 0), _type: 'reference' },
    services,
    serviceAreas,
    blogPosts,
    infoPages,
    reviews: reviewRefs,
    generatedAt: NOW,
  });

  const res = await tx.commit({ visibility: 'sync' });
  console.log(`[seed-test-tenant] ${t.slug} committed transactionId=${res.transactionId}`);
  console.log(`  siteId: ${t.siteId}  theme: ${t.theme}  preview: ?site=${t.slug}`);
}

async function main() {
  const sanity = createWriteClient({ dataset: 'development' });
  console.log(`[seed-test-tenant] seeding ${TENANTS.length} tenants into development dataset`);

  for (const tenant of TENANTS) {
    await seedTenant(sanity, tenant);
  }

  console.log('\n[seed-test-tenant] done.');
  console.log('\nPreview slugs:');
  for (const t of TENANTS) {
    console.log(`  ?site=${t.slug}  (theme: ${t.theme})`);
  }
}

main().catch((err) => {
  console.error('[seed-test-tenant] fatal:', err);
  process.exit(1);
});
