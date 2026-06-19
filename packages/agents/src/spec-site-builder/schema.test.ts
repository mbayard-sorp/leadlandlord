import { describe, it, expect } from 'vitest';
import { SpecSiteBuilderInput, SpecSiteContent } from './schema';
import { lintSpecSite, normalizeSpecSite } from './index';

// ── Shared minimal fixture ──────────────────────────────────────────────────

const minimalBase = {
  seo: { metaTitle: 'Acme — Plumbing in Austin, TX', metaDescription: 'Acme provides trusted plumbing in Austin, TX.' },
  navigation: [
    { label: 'Services', href: '#services' },
    { label: 'About', href: '#about' },
    { label: 'Contact', href: '#contact' },
  ],
  theme: {
    preset: 'Aqua Slate',
    layoutVariant: 'split' as const,
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
    subhead: 'Fast, professional plumbing service in Austin.',
    badges: [
      { icon: 'shield-check', label: 'Licensed & Insured' },
      { icon: 'star', label: 'Highly Rated' },
      { icon: 'clock', label: 'Fast Response' },
    ],
    primaryCta: { label: 'Get a Free Quote', href: '#contact', style: 'primary' as const },
    secondaryCta: { label: 'Call Us Today', href: 'tel:', style: 'secondary' as const },
    imagePrompt: 'Plumber replacing a corroded pipe under a kitchen sink, natural light, no text',
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
      { author: 'James T.', rating: 5, text: 'Transparent pricing and great communication.' },
      { author: 'Priya S.', rating: 4, text: 'Professional and friendly.' },
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
  },
};

// ── SpecSiteBuilderInput ────────────────────────────────────────────────────

describe('SpecSiteBuilderInput', () => {
  it('validates a well-formed dispatch input', () => {
    const ok = SpecSiteBuilderInput.safeParse({
      buildsell_site_id: '11111111-1111-1111-1111-111111111111',
      build_epoch: 'e1',
    });
    expect(ok.success).toBe(true);
  });

  it('accepts optional phone and address_line', () => {
    const ok = SpecSiteBuilderInput.safeParse({
      buildsell_site_id: '11111111-1111-1111-1111-111111111111',
      build_epoch: 'e1',
      phone: '+1 512 555 0100',
      address_line: '123 Main St, Austin, TX',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a non-uuid buildsell_site_id', () => {
    const bad = SpecSiteBuilderInput.safeParse({ buildsell_site_id: 'nope', build_epoch: 'e1' });
    expect(bad.success).toBe(false);
  });
});

// ── SpecSiteContent cardinality ─────────────────────────────────────────────

describe('SpecSiteContent cardinality', () => {
  it('validates the minimal fixture', () => {
    expect(SpecSiteContent.safeParse(minimalBase).success).toBe(true);
  });

  it('rejects fewer than 3 reviews', () => {
    const bad = {
      ...minimalBase,
      reviews: { ...minimalBase.reviews, items: minimalBase.reviews.items.slice(0, 2) },
    };
    expect(SpecSiteContent.safeParse(bad).success).toBe(false);
  });

  it('rejects more than 6 reviews', () => {
    const bad = {
      ...minimalBase,
      reviews: {
        ...minimalBase.reviews,
        items: Array.from({ length: 7 }, (_, i) => ({ author: `A${i} B`, rating: 5, text: 't' })),
      },
    };
    expect(SpecSiteContent.safeParse(bad).success).toBe(false);
  });

  it('rejects fewer than 4 service cards', () => {
    const bad = {
      ...minimalBase,
      services: {
        ...minimalBase.services,
        cards: minimalBase.services.cards.slice(0, 3),
      },
    };
    expect(SpecSiteContent.safeParse(bad).success).toBe(false);
  });

  it('rejects more than 6 service cards', () => {
    const bad = {
      ...minimalBase,
      services: {
        ...minimalBase.services,
        cards: Array.from({ length: 7 }, (_, i) => ({ icon: 'wrench', title: `s${i}`, description: 'd' })),
      },
    };
    expect(SpecSiteContent.safeParse(bad).success).toBe(false);
  });

  it('rejects services as a bare array (old schema)', () => {
    const bad = {
      ...minimalBase,
      services: [{ icon: 'wrench', title: 'Repairs', description: 'd' }],
    };
    expect(SpecSiteContent.safeParse(bad).success).toBe(false);
  });

  it('rejects missing services.heading', () => {
    const bad = {
      ...minimalBase,
      services: { cards: minimalBase.services.cards },
    };
    expect(SpecSiteContent.safeParse(bad).success).toBe(false);
  });

  it('rejects missing reviews.heading', () => {
    const bad = {
      ...minimalBase,
      reviews: { items: minimalBase.reviews.items },
    };
    expect(SpecSiteContent.safeParse(bad).success).toBe(false);
  });
});

// ── SpecSiteContent optional fields ─────────────────────────────────────────

describe('SpecSiteContent optional fields', () => {
  it('accepts missing optional fields (degrades, not fails)', () => {
    // No legalLinks, no social, no imagePrompts, no formLabels, no ogImagePrompt
    expect(SpecSiteContent.safeParse(minimalBase).success).toBe(true);
  });

  it('accepts reviews.items with optional location and initials', () => {
    const withOptionals = {
      ...minimalBase,
      reviews: {
        heading: 'Customer Stories',
        items: [
          { author: 'Maria G.', initials: 'MG', rating: 5, text: 'Great work.', location: 'Austin, TX' },
          { author: 'James T.', rating: 5, text: 'Very professional.' },
          { author: 'Priya S.', rating: 4, text: 'Solid job.' },
        ],
      },
    };
    expect(SpecSiteContent.safeParse(withOptionals).success).toBe(true);
  });
});

// ── Maximal fixture — every array at its max ─────────────────────────────────

describe('SpecSiteContent maximal fixture', () => {
  const maximal = {
    seo: {
      metaTitle: 'Acme Plumbing — Plumbing in Austin, TX',
      metaDescription: 'Acme Plumbing provides trusted plumbing services in Austin, TX. Free quotes, fast response.',
      ogImagePrompt: 'Plumber at work, clean composition, no text',
    },
    navigation: [
      { label: 'Services', href: '#services' },
      { label: 'About', href: '#about' },
      { label: 'How It Works', href: '#how-it-works' },
      { label: 'Reviews', href: '#reviews' },
      { label: 'Contact', href: '#contact' },
      { label: 'Locations', href: '#locations' },
    ],
    theme: {
      preset: 'Forest Green',
      layoutVariant: 'trust' as const,
      primary: '#166534',
      primaryDark: '#14532d',
      accent: '#f59e0b',
      onPrimary: '#ffffff',
      bg: '#f0fdf4',
      surface: '#ffffff',
      text: '#14532d',
      muted: '#6b7280',
      fontHeading: 'Space Grotesk',
      fontBody: 'Plus Jakarta Sans',
    },
    hero: {
      eyebrow: "Austin's trusted plumbers",
      headline: 'Expert Plumbing for Austin Homeowners',
      highlight: 'Expert Plumbing',
      subhead: 'Same-day service, upfront pricing, no surprises.',
      badges: [
        { icon: 'shield-check', label: 'Licensed & Insured' },
        { icon: 'star', label: 'Top Rated' },
        { icon: 'clock', label: 'Same-Day Service' },
        { icon: 'check-circle', label: 'Guaranteed Work' },
      ],
      primaryCta: { label: 'Get a Free Estimate', href: '#contact', style: 'primary' as const },
      secondaryCta: { label: 'Call Us Today', href: 'tel:', style: 'secondary' as const },
      imagePrompt: 'Skilled technician replacing a water heater in a bright utility room, professional, no text',
      highlight_color: '#f59e0b',
    },
    services: {
      heading: 'Our Plumbing Services',
      subhead: 'Full-service plumbing for every job, large or small.',
      cards: Array.from({ length: 6 }, (_, i) => ({
        icon: 'wrench',
        title: `Service ${i + 1}`,
        description: `Professional plumbing service ${i + 1} for Austin homeowners.`,
        link: '#contact',
      })),
    },
    about: {
      heading: 'Your Austin Plumbing Specialists',
      body: 'Acme Plumbing is a trusted plumbing provider in Austin, TX. We deliver honest work, fair pricing, and treat every customer like a neighbor.',
      stats: [
        { value: '15+', label: 'Years in Austin' },
        { value: '2,000+', label: 'Jobs completed' },
        { value: 'Same-day', label: 'Response time' },
        { value: '100%', label: 'Satisfaction guarantee' },
      ],
      imagePrompt: 'Plumbing team in uniform, friendly smiles, Austin backdrop, natural light',
    },
    process: {
      heading: 'How It Works',
      steps: [
        { icon: 'phone', title: 'Get in Touch', description: 'Call or fill out the quick form below.' },
        { icon: 'calendar', title: 'Schedule', description: 'We confirm a time that fits your day.' },
        { icon: 'wrench', title: 'We Show Up', description: 'Uniformed, on-time, and fully equipped.' },
        { icon: 'check', title: 'Done Right', description: 'Backed by our quality guarantee.' },
      ],
    },
    reviews: {
      heading: 'What Our Customers Say',
      items: Array.from({ length: 6 }, (_, i) => ({
        author: `Customer ${String.fromCharCode(65 + i)}. Z`,
        initials: `C${String.fromCharCode(65 + i)}`,
        rating: 5,
        text: `Acme Plumbing did a great job on our plumbing project in Austin. Very professional team.`,
        location: 'Austin, TX',
      })),
    },
    contact: {
      heading: 'Request Your Free Estimate',
      subhead: "Tell us about your project and we'll get back to you fast.",
      hours: 'Mon–Sat 7am–7pm',
      serviceArea: 'Austin, Round Rock, Cedar Park, and surrounding Travis County',
      formLabels: {
        name: 'Your Name',
        phone: 'Phone Number',
        message: 'Describe your plumbing issue',
        submit: 'Send My Request',
      },
    },
    footer: {
      tagline: 'Acme Plumbing — expert plumbing service in Austin, TX.',
      legal: '© 2026 Acme Plumbing. All rights reserved.',
      columns: [
        { heading: 'Services', links: Array.from({ length: 6 }, (_, i) => ({ label: `Service ${i + 1}`, href: '#services' })) },
        { heading: 'Areas', links: [{ label: 'Austin', href: '#' }, { label: 'Round Rock', href: '#' }, { label: 'Cedar Park', href: '#' }] },
        { heading: 'Company', links: [{ label: 'About', href: '#about' }, { label: 'Contact', href: '#contact' }] },
      ],
      social: [
        { platform: 'facebook' as const, href: '#' },
        { platform: 'instagram' as const, href: '#' },
        { platform: 'yelp' as const, href: '#' },
        { platform: 'google' as const, href: '#' },
        { platform: 'nextdoor' as const, href: '#' },
      ],
      legalLinks: [
        { label: 'Privacy Policy', href: '/privacy' },
        { label: 'Terms of Service', href: '/terms' },
        { label: 'Accessibility', href: '/accessibility' },
        { label: 'Sitemap', href: '/sitemap' },
      ],
    },
  };

  it('validates the maximal fixture (all arrays at max)', () => {
    const result = SpecSiteContent.safeParse(maximal);
    if (!result.success) {
      console.error('Maximal fixture errors:', JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('maximal fixture passes banned-phrase lint', () => {
    const parsed = SpecSiteContent.parse(maximal);
    const violations = lintSpecSite(parsed);
    expect(violations).toEqual([]);
  });
});

// ── lintSpecSite ─────────────────────────────────────────────────────────────

describe('lintSpecSite', () => {
  it('returns no violations for the minimal mock fixture', () => {
    const parsed = SpecSiteContent.parse(minimalBase);
    const violations = lintSpecSite(parsed);
    expect(violations).toEqual([]);
  });

  it('flags hardcoded "Our Services" heading', () => {
    const bad = SpecSiteContent.parse({ ...minimalBase, services: { ...minimalBase.services, heading: 'Our Services' } });
    const violations = lintSpecSite(bad);
    expect(violations.some((v) => v.includes('"Our Services"'))).toBe(true);
  });

  it('flags hardcoded "What Customers Say" heading', () => {
    const bad = SpecSiteContent.parse({ ...minimalBase, reviews: { ...minimalBase.reviews, heading: 'What Customers Say' } });
    const violations = lintSpecSite(bad);
    expect(violations.some((v) => v.includes('"What Customers Say"'))).toBe(true);
  });

  it('flags an invented founding year', () => {
    const bad = SpecSiteContent.parse({ ...minimalBase, about: { ...minimalBase.about, body: 'Serving Austin since 1998.' } });
    const violations = lintSpecSite(bad);
    expect(violations.some((v) => v.includes('founding year'))).toBe(true);
  });

  it('flags an invented phone literal', () => {
    const bad = SpecSiteContent.parse({
      ...minimalBase,
      contact: { ...minimalBase.contact, subhead: 'Call us at 512-555-1234 today.' },
    });
    const violations = lintSpecSite(bad);
    expect(violations.some((v) => v.includes('phone'))).toBe(true);
  });

  it('flags an invented email literal', () => {
    const bad = SpecSiteContent.parse({
      ...minimalBase,
      contact: { ...minimalBase.contact, subhead: 'Email us at info@acme.com for a quote.' },
    });
    const violations = lintSpecSite(bad);
    expect(violations.some((v) => v.includes('email'))).toBe(true);
  });
});

// ── normalizeSpecSite ─────────────────────────────────────────────────────────

describe('normalizeSpecSite', () => {
  it('backfills © year when missing from footer.legal', () => {
    const noYear = SpecSiteContent.parse({ ...minimalBase, footer: { ...minimalBase.footer, legal: 'All rights reserved.' } });
    const { content } = normalizeSpecSite(noYear, 'Acme');
    expect(content.footer.legal).toContain('©');
    expect(content.footer.legal).toContain(String(new Date().getFullYear()));
  });

  it('strips phone literals from contact subhead', () => {
    const withPhone = SpecSiteContent.parse({
      ...minimalBase,
      contact: { ...minimalBase.contact, subhead: 'Call us at (512) 555-1234.' },
    });
    const { content } = normalizeSpecSite(withPhone, 'Acme');
    expect(content.contact.subhead).not.toMatch(/\d{3}[-.\s]\d{4}/);
    expect(content.contact.subhead).toContain('{{phone}}');
  });

  it('returns lint violations for banned phrases', () => {
    const withBanned = SpecSiteContent.parse({
      ...minimalBase,
      services: { ...minimalBase.services, heading: 'Our Services' },
    });
    const { violations } = normalizeSpecSite(withBanned, 'Acme');
    expect(violations.length).toBeGreaterThan(0);
  });

  it('returns no violations for the clean mock fixture', () => {
    const parsed = SpecSiteContent.parse(minimalBase);
    const { violations } = normalizeSpecSite(parsed, 'Acme');
    expect(violations).toEqual([]);
  });
});
