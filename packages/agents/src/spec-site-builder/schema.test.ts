import { describe, it, expect } from 'vitest';
import { SpecSiteBuilderInput, SpecSiteContent } from './schema';

describe('spec-site-builder schemas', () => {
  it('validates a well-formed dispatch input', () => {
    const ok = SpecSiteBuilderInput.safeParse({
      buildsell_site_id: '11111111-1111-1111-1111-111111111111',
      build_epoch: 'e1',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a non-uuid buildsell_site_id', () => {
    const bad = SpecSiteBuilderInput.safeParse({ buildsell_site_id: 'nope', build_epoch: 'e1' });
    expect(bad.success).toBe(false);
  });

  it('enforces section cardinality (3-6 reviews, 4-6 services)', () => {
    const base = {
      seo: { metaTitle: 't', metaDescription: 'd' },
      navigation: [
        { label: 'a', href: '#a' },
        { label: 'b', href: '#b' },
        { label: 'c', href: '#c' },
      ],
      theme: {
        preset: 'Aqua Slate', layoutVariant: 'split', primary: '#0e7490', primaryDark: '#155e75',
        accent: '#f59e0b', onPrimary: '#fff', bg: '#fff', surface: '#fff', text: '#000', muted: '#666',
        fontHeading: 'Poppins', fontBody: 'Inter',
      },
      hero: {
        eyebrow: 'e', headline: 'h', subhead: 's',
        badges: [{ icon: 'star', label: 'a' }, { icon: 'star', label: 'b' }, { icon: 'star', label: 'c' }],
        primaryCta: { label: 'q', href: '#contact', style: 'primary' },
        secondaryCta: { label: 'c', href: 'tel:', style: 'secondary' },
        imagePrompt: 'scene',
      },
      services: Array.from({ length: 4 }, (_, i) => ({ icon: 'wrench', title: `s${i}`, description: 'd' })),
      about: { heading: 'h', body: 'b', stats: [{ value: '1', label: 'a' }, { value: '2', label: 'b' }] },
      process: { heading: 'h', steps: [{ icon: 'phone', title: 't', description: 'd' }, { icon: 'check', title: 't', description: 'd' }, { icon: 'star', title: 't', description: 'd' }] },
      reviews: [
        { author: 'A B', rating: 5, text: 't' },
        { author: 'C D', rating: 5, text: 't' },
        { author: 'E F', rating: 4, text: 't' },
      ],
      contact: { heading: 'h', subhead: 's', hours: 'Mon', serviceArea: 'area' },
      footer: { tagline: 't', legal: 'l' },
    };
    expect(SpecSiteContent.safeParse(base).success).toBe(true);
    expect(SpecSiteContent.safeParse({ ...base, reviews: base.reviews.slice(0, 2) }).success).toBe(false);
    expect(SpecSiteContent.safeParse({ ...base, services: base.services.slice(0, 3) }).success).toBe(false);
  });
});
