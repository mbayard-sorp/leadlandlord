/**
 * Tests for spec-site-builder's persist-sanity.ts — the D4 read-merge /
 * Workstream-C section-merge module that writes a generated Build & Sell
 * spec site to Sanity. The only external effect is `createWriteClient()`
 * (@leadlandlord/integrations/sanity), which is fully mocked here — this
 * suite never touches a real Sanity project.
 *
 * Covered:
 *  - deterministic doc ids: `bs-site-<id>` for the main doc, `bs-review-<id>-N`
 *    for each review (N = array index)
 *  - review docs: source is ALWAYS 'manual' (never 'google' — ToS guard),
 *    initials derived from author when not provided, featured for the first
 *    3, order = index
 *  - D4 read-merge defaults (no existingDoc): draftMode/robotsDisallow
 *    default true, purchaseUrl/ownerEmail/klaviyoListId/phone/street
 *    default to undefined when neither incoming nor existing carries a value
 *  - D4 read-merge preservation: operator-owned fields (draftMode,
 *    robotsDisallow, purchaseUrl, ownerEmail, klaviyoListId, existingPhone,
 *    existingStreet) survive from `existingDoc` when the incoming payload
 *    carries none
 *  - D4 read-merge precedence: incoming payload values win over existingDoc
 *    values when both are present
 *  - themeLocked: preserved verbatim when true on the existing doc, omitted
 *    entirely when absent/false (never written as `false`)
 *  - migration overlay (`migrated`): headline/aboutBody/services/socials
 *    override generated content verbatim; heroImageAssetId/aboutImageAssetId
 *    take precedence over the freshly-generated asset ids; logoAssetId is
 *    written to the doc-root `logo` field; ugc section is rendered only when
 *    migrated.ugc is non-empty and omitted entirely otherwise; the migrated
 *    overlay itself is re-emitted verbatim on the doc so it survives the next
 *    createOrReplace
 *  - Workstream C section read-merge: no sectionOrder → canonical sections
 *    unchanged; removedKeys are dropped; customerOwnedKeys are taken
 *    verbatim from the existing doc (not regenerated); a sectionOrder key
 *    absent from canonical is pulled from existingSections verbatim
 *    (customer-added section); a canonical key absent from sectionOrder (a
 *    new section type, e.g. a later-approved `ugc`) is appended just before
 *    footer; footer is always last even when sectionOrder omits it
 *  - Workstream C handoff lock (defense-in-depth): siteStatus === 'live'
 *    throws RebuildProtectedError and the transaction is never touched (no
 *    createOrReplace, no commit)
 *  - theme written to Sanity carries ONLY preset/layoutVariant/fontHeading/
 *    fontBody — no per-doc hex fields (colors are 100% preset-driven)
 *  - result shape: docId/reviewDocIds/transactionId/sectionCount
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpecSiteContent } from './schema';
import type { ExistingDocFields, MigratedOverlay, CustomerLayoutOverlay } from './persist-sanity';

const SITE_ID = '44444444-4444-4444-4444-444444444444';

// ── Sanity write client (the only external effect) ─────────────────────────
const mockTxCreateOrReplace = vi.fn();
const mockTxCommit = vi.fn();
const mockTransaction = vi.fn(() => ({
  createOrReplace: mockTxCreateOrReplace,
  commit: mockTxCommit,
}));
const mockCreateWriteClient = vi.fn(() => ({ transaction: mockTransaction }));

vi.mock('@leadlandlord/integrations/sanity', () => ({
  createWriteClient: () => mockCreateWriteClient(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockTxCommit.mockResolvedValue({ transactionId: 'txn-mock-1' });
});

// ── Fixtures ─────────────────────────────────────────────────────────────

function buildContent(): SpecSiteContent {
  return {
    seo: {
      metaTitle: 'Acme Plumbing — Plumbing in Austin, TX',
      metaDescription: 'Acme Plumbing provides trusted plumbing services in Austin, TX.',
      ogImagePrompt: 'Plumber at work, clean composition, no text',
    },
    navigation: [
      { label: 'Services', href: '#services' },
      { label: 'About', href: '#about' },
      { label: 'Contact', href: '#contact' },
    ],
    theme: {
      preset: 'Aqua Slate',
      layoutVariant: 'split',
      primary: '#0e7490',
      primaryDark: '#155e75',
      accent: '#f59e0b',
      onPrimary: '#ffffff',
      bg: '#f8fafc',
      surface: '#ffffff',
      text: '#0f172a',
      muted: '#64748b',
      fontHeading: 'Poppins',
      fontBody: 'Inter',
    },
    hero: {
      eyebrow: "Austin's trusted plumbers",
      headline: 'Reliable Plumbing You Can Count On',
      highlight: 'Reliable Plumbing',
      subhead: 'Fast, professional plumbing service in Austin.',
      badges: [
        { icon: 'shield-check', label: 'Licensed & Insured' },
        { icon: 'star', label: 'Highly Rated' },
        { icon: 'clock', label: 'Fast Response' },
      ],
      primaryCta: { label: 'Get a Free Quote', href: '#contact', style: 'primary' },
      secondaryCta: { label: 'Call Us Today', href: 'tel:', style: 'secondary' },
      imagePrompt: 'Plumber replacing a corroded pipe, natural light, no text',
    },
    services: {
      heading: 'What We Do',
      cards: Array.from({ length: 4 }, (_, i) => ({
        icon: 'wrench',
        title: `Service ${i + 1}`,
        description: 'Fast, dependable repairs done right.',
      })),
    },
    about: {
      heading: 'Your Local Plumbing Experts',
      body: 'Acme is a locally trusted plumbing provider in Austin, TX.',
      stats: [
        { value: '10+', label: 'Years serving the area' },
        { value: '1,000+', label: 'Jobs completed' },
      ],
      imagePrompt: 'Plumbing team in uniform, friendly smiles, natural light',
    },
    process: {
      heading: 'How It Works',
      steps: [
        { icon: 'phone', title: 'Get in Touch', description: 'Call or fill out the quote form.' },
        { icon: 'calendar', title: 'Schedule', description: 'We find a time that works for you.' },
        { icon: 'check', title: 'Done Right', description: 'Quality work, backed by our guarantee.' },
      ],
    },
    reviews: {
      heading: 'What Our Customers Say',
      items: [
        { author: 'Maria G.', rating: 5, text: 'Showed up on time and did a great job.' },
        { author: 'James T.', initials: 'JT', rating: 5, text: 'Transparent pricing and great communication.' },
        { author: 'Priya S.', rating: 4, text: 'Professional and friendly.' },
        { author: 'Wei Chen', rating: 5, text: 'Quick and reliable service.' },
      ],
    },
    contact: {
      heading: 'Get Your Free Quote',
      subhead: "Reach out and we'll respond quickly.",
      hours: 'Mon–Sat 7am–6pm',
      serviceArea: 'Austin and surrounding areas',
    },
    footer: {
      tagline: 'Acme — quality plumbing you can count on.',
      legal: '© 2026 Acme. All rights reserved.',
      social: [{ platform: 'facebook', href: 'https://facebook.com/acme' }],
    },
  };
}

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    buildsellSiteId: SITE_ID,
    businessName: 'Acme Plumbing',
    trade: 'plumbing',
    city: 'Austin',
    state: 'TX',
    slug: 'acme-plumbing-austin-tx-444444',
    content: buildContent(),
    generatedAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

/** Pull the single buildsellSite doc-root createOrReplace payload out of the tx mock. */
function mainDocWrite(): Record<string, unknown> {
  const call = mockTxCreateOrReplace.mock.calls.find(
    ([doc]) => (doc as Record<string, unknown>)['_type'] === 'buildsellSite',
  );
  if (!call) throw new Error('buildsellSite doc write not found in tx.createOrReplace calls');
  return call[0] as Record<string, unknown>;
}

function reviewDocWrites(): Array<Record<string, unknown>> {
  return mockTxCreateOrReplace.mock.calls
    .map(([doc]) => doc as Record<string, unknown>)
    .filter((doc) => doc['_type'] === 'bsReview');
}

// ── Deterministic ids + review docs ─────────────────────────────────────

describe('writeBuildSellToSanity — deterministic ids and review docs', () => {
  it('main doc id is bs-site-<buildsellSiteId>', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    const result = await writeBuildSellToSanity(baseArgs());
    expect(result.docId).toBe(`bs-site-${SITE_ID}`);
    expect(mainDocWrite()['_id']).toBe(`bs-site-${SITE_ID}`);
  });

  it('review doc ids are bs-review-<buildsellSiteId>-N (N = array index)', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    const result = await writeBuildSellToSanity(baseArgs());
    expect(result.reviewDocIds).toEqual([
      `bs-review-${SITE_ID}-0`,
      `bs-review-${SITE_ID}-1`,
      `bs-review-${SITE_ID}-2`,
      `bs-review-${SITE_ID}-3`,
    ]);
    const reviews = reviewDocWrites();
    expect(reviews.map((r) => r['_id'])).toEqual(result.reviewDocIds);
  });

  it('review source is ALWAYS "manual" — never "google" (ToS guard)', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs());
    for (const r of reviewDocWrites()) {
      expect(r['source']).toBe('manual');
    }
  });

  it('derives initials from author when not explicitly provided; keeps explicit initials otherwise', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs());
    const reviews = reviewDocWrites();
    // "Maria G." → no explicit initials → derived "MG".
    expect(reviews[0]?.['initials']).toBe('MG');
    // "James T." → explicit initials "JT" passed straight through.
    expect(reviews[1]?.['initials']).toBe('JT');
  });

  it('featured is true for the first 3 reviews only; order mirrors array index', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs());
    const reviews = reviewDocWrites();
    expect(reviews.map((r) => r['featured'])).toEqual([true, true, true, false]);
    expect(reviews.map((r) => r['order'])).toEqual([0, 1, 2, 3]);
  });

  it('result.sectionCount matches the written sections array length', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    const result = await writeBuildSellToSanity(baseArgs());
    const sections = mainDocWrite()['sections'] as unknown[];
    expect(result.sectionCount).toBe(sections.length);
    // hero, services, about, process, reviews, contact, footer — no migrated
    // ugc overlay, so 7 canonical sections.
    expect(sections.length).toBe(7);
  });

  it('result.transactionId comes from tx.commit()', async () => {
    mockTxCommit.mockResolvedValue({ transactionId: 'txn-custom-42' });
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    const result = await writeBuildSellToSanity(baseArgs());
    expect(result.transactionId).toBe('txn-custom-42');
    expect(mockTxCommit).toHaveBeenCalledWith({ visibility: 'sync' });
  });
});

// ── D4 read-merge: defaults + preservation + precedence ─────────────────

describe('writeBuildSellToSanity — D4 read-merge', () => {
  it('defaults draftMode/robotsDisallow to true and leaves purchaseUrl/ownerEmail/phone/street undefined when nothing is known', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs());
    const doc = mainDocWrite();
    expect(doc['draftMode']).toBe(true);
    expect(doc['robotsDisallow']).toBe(true);
    expect(doc['purchaseUrl']).toBeUndefined();
    expect(doc['ownerEmail']).toBeUndefined();
    expect(doc['phone']).toBeUndefined();
    const contactSection = (doc['sections'] as Array<Record<string, unknown>>).find(
      (s) => s['_key'] === 'contact',
    )!;
    expect((contactSection['address'] as Record<string, unknown>)['street']).toBeUndefined();
  });

  it('preserves operator-owned fields from existingDoc when the incoming payload carries none', async () => {
    const existingDoc: ExistingDocFields = {
      draftMode: false,
      robotsDisallow: false,
      purchaseUrl: 'https://buy.example.com/acme',
      ownerEmail: 'owner@acme.example',
      klaviyoListId: 'list-existing-1',
      existingPhone: '+15125550100',
      existingStreet: '123 Main St',
    };
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs({ existingDoc }));
    const doc = mainDocWrite();
    expect(doc['draftMode']).toBe(false);
    expect(doc['robotsDisallow']).toBe(false);
    expect(doc['purchaseUrl']).toBe('https://buy.example.com/acme');
    expect(doc['ownerEmail']).toBe('owner@acme.example');
    expect(doc['klaviyoListId']).toBe('list-existing-1');
    expect(doc['phone']).toBe('+15125550100');
    const contactSection = (doc['sections'] as Array<Record<string, unknown>>).find(
      (s) => s['_key'] === 'contact',
    )!;
    expect((contactSection['address'] as Record<string, unknown>)['street']).toBe('123 Main St');
  });

  it('incoming payload values win over existingDoc values when both are present', async () => {
    const existingDoc: ExistingDocFields = {
      purchaseUrl: 'https://old.example.com',
      ownerEmail: 'old-owner@acme.example',
      klaviyoListId: 'list-old',
      existingPhone: '+15125550100',
      existingStreet: 'OLD Street',
    };
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(
      baseArgs({
        existingDoc,
        purchaseUrl: 'https://new.example.com',
        ownerEmail: 'new-owner@acme.example',
        klaviyoListId: 'list-new',
        phone: '+15125559999',
        addressLine: 'NEW Street, Austin, TX',
      }),
    );
    const doc = mainDocWrite();
    expect(doc['purchaseUrl']).toBe('https://new.example.com');
    expect(doc['ownerEmail']).toBe('new-owner@acme.example');
    expect(doc['klaviyoListId']).toBe('list-new');
    expect(doc['phone']).toBe('+15125559999');
    const contactSection = (doc['sections'] as Array<Record<string, unknown>>).find(
      (s) => s['_key'] === 'contact',
    )!;
    expect((contactSection['address'] as Record<string, unknown>)['street']).toBe('NEW Street, Austin, TX');
  });

  it('themeLocked:true on the existing doc is preserved verbatim', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs({ existingDoc: { themeLocked: true } as ExistingDocFields }));
    expect(mainDocWrite()['themeLocked']).toBe(true);
  });

  it('themeLocked is OMITTED (not written as false) when absent or false on the existing doc', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs());
    expect('themeLocked' in mainDocWrite()).toBe(false);

    mockTxCreateOrReplace.mockClear();
    await writeBuildSellToSanity(baseArgs({ existingDoc: { themeLocked: false } as ExistingDocFields }));
    expect('themeLocked' in mainDocWrite()).toBe(false);
  });

  it('theme written to Sanity carries only preset/layoutVariant/fontHeading/fontBody — no hex fields', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs());
    const doc = mainDocWrite();
    expect(doc['theme']).toEqual({
      _type: 'buildsellTheme',
      preset: 'Aqua Slate',
      layoutVariant: 'split',
      fontHeading: 'Poppins',
      fontBody: 'Inter',
    });
  });
});

// ── Migration overlay ─────────────────────────────────────────────────────

describe('writeBuildSellToSanity — migration overlay', () => {
  function makeMigrated(overrides: Partial<MigratedOverlay> = {}): MigratedOverlay {
    return {
      headline: 'Approved Real Headline From Prospect Site',
      aboutBody: 'Approved real about-us copy, verbatim from the prospect site.',
      services: [{ icon: 'wrench', title: 'Real Service', description: 'Real approved description.' }],
      socials: [{ platform: 'facebook', href: 'https://facebook.com/real-acme' }],
      logoAssetId: 'image-real-logo-1',
      heroImageAssetId: 'image-real-hero-1',
      aboutImageAssetId: 'image-real-about-1',
      source: 'content-migrator',
      migratedAt: '2026-08-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('migrated headline/aboutBody override the generated content verbatim; highlight is dropped', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs({ existingDoc: { migrated: makeMigrated() } as ExistingDocFields }));
    const doc = mainDocWrite();
    const hero = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'hero')!;
    const about = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'about')!;
    expect(hero['headline']).toBe('Approved Real Headline From Prospect Site');
    expect(hero['highlight']).toBeUndefined();
    expect(about['body']).toBe('Approved real about-us copy, verbatim from the prospect site.');
  });

  it('migrated services/socials replace the generated cards/social links', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs({ existingDoc: { migrated: makeMigrated() } as ExistingDocFields }));
    const doc = mainDocWrite();
    const services = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'services')!;
    expect(services['services']).toEqual([
      expect.objectContaining({ icon: 'wrench', title: 'Real Service', description: 'Real approved description.' }),
    ]);
    const footer = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'footer')!;
    expect(footer['social']).toEqual([
      expect.objectContaining({ platform: 'facebook', href: 'https://facebook.com/real-acme' }),
    ]);
  });

  it('migrated heroImageAssetId/aboutImageAssetId take precedence over freshly-generated asset ids', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(
      baseArgs({
        existingDoc: { migrated: makeMigrated() } as ExistingDocFields,
        heroImageAssetId: 'image-freshly-generated-hero',
        aboutImageAssetId: 'image-freshly-generated-about',
      }),
    );
    const doc = mainDocWrite();
    const hero = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'hero')!;
    const about = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'about')!;
    expect((hero['image'] as Record<string, unknown>)['asset']).toEqual(
      expect.objectContaining({ _ref: 'image-real-hero-1' }),
    );
    expect((about['image'] as Record<string, unknown>)['asset']).toEqual(
      expect.objectContaining({ _ref: 'image-real-about-1' }),
    );
  });

  it('migrated.logoAssetId is written to the doc-root `logo` field', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs({ existingDoc: { migrated: makeMigrated() } as ExistingDocFields }));
    const doc = mainDocWrite();
    expect((doc['logo'] as Record<string, unknown>)['asset']).toEqual(
      expect.objectContaining({ _ref: 'image-real-logo-1' }),
    );
  });

  it('the migrated overlay is re-emitted verbatim on the doc so it survives the next createOrReplace', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs({ existingDoc: { migrated: makeMigrated() } as ExistingDocFields }));
    const doc = mainDocWrite();
    const migrated = doc['migrated'] as Record<string, unknown>;
    expect(migrated['_type']).toBe('bsMigrated');
    expect(migrated['headline']).toBe('Approved Real Headline From Prospect Site');
    expect(migrated['source']).toBe('content-migrator');
  });

  it('ugc section is rendered ONLY when migrated.ugc is non-empty; omitted entirely otherwise', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');

    // No ugc at all — section absent.
    await writeBuildSellToSanity(baseArgs({ existingDoc: { migrated: makeMigrated() } as ExistingDocFields }));
    let sections = mainDocWrite()['sections'] as Array<Record<string, unknown>>;
    expect(sections.some((s) => s['_key'] === 'ugc')).toBe(false);

    mockTxCreateOrReplace.mockClear();

    // ugc present — section appears with items mapped from the overlay.
    await writeBuildSellToSanity(
      baseArgs({
        existingDoc: {
          migrated: makeMigrated({
            ugc: [{ platform: 'instagram', thumbnailAssetId: 'image-ugc-1', caption: 'Nice job!' }],
          }),
        } as ExistingDocFields,
      }),
    );
    sections = mainDocWrite()['sections'] as Array<Record<string, unknown>>;
    const ugcSection = sections.find((s) => s['_key'] === 'ugc');
    expect(ugcSection).toBeDefined();
    expect((ugcSection!['items'] as unknown[]).length).toBe(1);
  });
});

// ── Workstream C section read-merge ───────────────────────────────────────

describe('writeBuildSellToSanity — customerLayout section read-merge', () => {
  it('no sectionOrder → canonical sections returned unchanged, in the hardcoded order', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs());
    const sections = mainDocWrite()['sections'] as Array<Record<string, unknown>>;
    expect(sections.map((s) => s['_key'])).toEqual([
      'hero',
      'services',
      'about',
      'process',
      'reviews',
      'contact',
      'footer',
    ]);
  });

  it('removedKeys are dropped from the merged output', async () => {
    const customerLayout: CustomerLayoutOverlay = {
      sectionOrder: ['hero', 'services', 'about', 'reviews', 'contact', 'footer'],
      removedKeys: ['process'],
      customerOwnedKeys: [],
    };
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs({ existingDoc: { customerLayout, existingSections: [] } as ExistingDocFields }));
    const sections = mainDocWrite()['sections'] as Array<Record<string, unknown>>;
    expect(sections.map((s) => s['_key'])).not.toContain('process');
  });

  it('customerOwnedKeys are taken verbatim from existingSections, not regenerated', async () => {
    const customerOwnedAbout = {
      _key: 'about',
      _type: 'bsAboutSection',
      heading: 'CUSTOMER-EDITED HEADING — DO NOT REGENERATE',
      body: 'Customer hand-wrote this paragraph in the portal.',
    };
    const customerLayout: CustomerLayoutOverlay = {
      sectionOrder: ['hero', 'services', 'about', 'process', 'reviews', 'contact', 'footer'],
      removedKeys: [],
      customerOwnedKeys: ['about'],
    };
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(
      baseArgs({
        existingDoc: { customerLayout, existingSections: [customerOwnedAbout] } as ExistingDocFields,
      }),
    );
    const sections = mainDocWrite()['sections'] as Array<Record<string, unknown>>;
    const about = sections.find((s) => s['_key'] === 'about')!;
    expect(about).toEqual(customerOwnedAbout);
    // The freshly-generated about heading from buildContent() must NOT appear.
    expect(about['heading']).not.toBe('Your Local Plumbing Experts');
  });

  it('a sectionOrder key absent from canonical (customer-added section) is pulled verbatim from existingSections', async () => {
    const customAddedSection = { _key: 'custom-testimonial-video', _type: 'bsCustomSection', note: 'customer added this' };
    const customerLayout: CustomerLayoutOverlay = {
      sectionOrder: ['hero', 'services', 'about', 'process', 'reviews', 'custom-testimonial-video', 'contact', 'footer'],
      removedKeys: [],
      customerOwnedKeys: [],
    };
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(
      baseArgs({
        existingDoc: { customerLayout, existingSections: [customAddedSection] } as ExistingDocFields,
      }),
    );
    const sections = mainDocWrite()['sections'] as Array<Record<string, unknown>>;
    const keys = sections.map((s) => s['_key']);
    expect(keys).toContain('custom-testimonial-video');
    expect(sections.find((s) => s['_key'] === 'custom-testimonial-video')).toEqual(customAddedSection);
    // Positioned exactly where sectionOrder placed it: right before 'contact'.
    expect(keys.indexOf('custom-testimonial-video')).toBe(keys.indexOf('contact') - 1);
  });

  it('a canonical key not present in sectionOrder (new section type, e.g. later-approved ugc) is appended just before footer', async () => {
    const customerLayout: CustomerLayoutOverlay = {
      // Predates the ugc migration approval — 'ugc' was never part of this order.
      sectionOrder: ['hero', 'services', 'about', 'process', 'reviews', 'contact', 'footer'],
      removedKeys: [],
      customerOwnedKeys: [],
    };
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(
      baseArgs({
        existingDoc: {
          customerLayout,
          existingSections: [],
          migrated: {
            ugc: [{ platform: 'instagram', thumbnailAssetId: 'image-ugc-1' }],
          } as MigratedOverlay,
        } as ExistingDocFields,
      }),
    );
    const sections = mainDocWrite()['sections'] as Array<Record<string, unknown>>;
    const keys = sections.map((s) => s['_key']);
    expect(keys.indexOf('ugc')).toBe(keys.length - 2);
    expect(keys[keys.length - 1]).toBe('footer');
  });

  it('footer is always last, even when sectionOrder omits it entirely', async () => {
    const customerLayout: CustomerLayoutOverlay = {
      sectionOrder: ['hero', 'services', 'about', 'process', 'reviews', 'contact'],
      removedKeys: [],
      customerOwnedKeys: [],
    };
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    await writeBuildSellToSanity(baseArgs({ existingDoc: { customerLayout, existingSections: [] } as ExistingDocFields }));
    const sections = mainDocWrite()['sections'] as Array<Record<string, unknown>>;
    expect(sections[sections.length - 1]?.['_key']).toBe('footer');
  });
});

// ── Workstream C handoff lock (defense-in-depth) ─────────────────────────

describe('writeBuildSellToSanity — handoff lock (siteStatus === "live")', () => {
  it('throws RebuildProtectedError and never touches the transaction (no createOrReplace, no commit)', async () => {
    const { writeBuildSellToSanity, RebuildProtectedError } = await import('./persist-sanity');
    await expect(writeBuildSellToSanity(baseArgs({ siteStatus: 'live' }))).rejects.toThrow(RebuildProtectedError);
    expect(mockTxCreateOrReplace).not.toHaveBeenCalled();
    expect(mockTxCommit).not.toHaveBeenCalled();
  });

  it('does NOT throw for any other siteStatus (draft/building/paid/invoiced)', async () => {
    const { writeBuildSellToSanity } = await import('./persist-sanity');
    for (const status of ['draft', 'building', 'paid', 'invoiced']) {
      mockTxCreateOrReplace.mockClear();
      await expect(writeBuildSellToSanity(baseArgs({ siteStatus: status }))).resolves.toBeDefined();
      expect(mockTxCreateOrReplace).toHaveBeenCalled();
    }
  });
});
