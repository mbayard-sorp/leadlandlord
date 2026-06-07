import { describe, expect, it } from 'vitest';
import type { Bundle } from '../../lib/content';
import {
  serviceAreaLocality,
  subtypeFor,
  absUrl,
  localBusinessImage,
  buildLocalBusinessJsonLd,
  buildLocalBusinessRef,
  buildVideoObjectJsonLd,
} from './local-business-schema';

describe('subtypeFor', () => {
  it('maps the canonical single-word trades', () => {
    expect(subtypeFor('plumbing')).toBe('Plumber');
    expect(subtypeFor('plumber')).toBe('Plumber');
    expect(subtypeFor('hvac')).toBe('HVACBusiness');
    expect(subtypeFor('electrician')).toBe('Electrician');
    expect(subtypeFor('roofing')).toBe('RoofingContractor');
    expect(subtypeFor('roofer')).toBe('RoofingContractor');
    expect(subtypeFor('junk removal')).toBe('MovingCompany');
  });

  it('catches "roof"-family niches the old substring lookup missed', () => {
    // Regression: "roof replacement" does not contain "roofing"/"roofer".
    expect(subtypeFor('roof replacement')).toBe('RoofingContractor');
    expect(subtypeFor('roof repair')).toBe('RoofingContractor');
    expect(subtypeFor('residential roof installation')).toBe('RoofingContractor');
    expect(subtypeFor('shingle replacement')).toBe('RoofingContractor');
  });

  it('catches other multi-word niches with the same root-token gap', () => {
    // "tree removal"/"tree service" are present, but "tree trimming" is not.
    expect(subtypeFor('tree trimming')).toBe('TreeService');
    expect(subtypeFor('tree trim')).toBe('TreeService');
    // "painting"/"painter" are present, but "interior/exterior paint" are not.
    expect(subtypeFor('interior paint')).toBe('HousePainter');
    expect(subtypeFor('exterior paint')).toBe('HousePainter');
  });

  it('does not let a root token leak into an unrelated trade', () => {
    // "waterproofing" contains the substring "roof" — must NOT become roofing.
    expect(subtypeFor('basement waterproofing')).toBe('LocalBusiness');
    expect(subtypeFor('waterproofing')).toBe('LocalBusiness');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(subtypeFor('Roofing')).toBe('RoofingContractor');
    expect(subtypeFor('  Roof Replacement  ')).toBe('RoofingContractor');
  });

  it('falls back to LocalBusiness for unknown / typeless niches', () => {
    expect(subtypeFor('appliance repair')).toBe('LocalBusiness');
    expect(subtypeFor('foundation repair')).toBe('LocalBusiness');
    expect(subtypeFor('')).toBe('LocalBusiness');
  });
});

describe('serviceAreaLocality', () => {
  it('extracts the locality from a "<service> <city> <st> | <suffix>" title', () => {
    expect(
      serviceAreaLocality('Junk Removal Henderson NV | Same-Day Service', 'junk removal', 'NV'),
    ).toBe('Henderson, NV');
    expect(
      serviceAreaLocality('Roof Replacement Owensboro KY | Smith Roofing', 'roof replacement', 'KY'),
    ).toBe('Owensboro, KY');
  });

  it('does not leak the "|"-delimited marketing suffix', () => {
    const out = serviceAreaLocality('Junk Removal Henderson NV | Same-Day Service', 'junk removal', 'NV');
    expect(out).not.toContain('|');
    expect(out).not.toMatch(/same-day/i);
  });

  it('handles the legacy "<service> in <city>, <st>" shape', () => {
    expect(serviceAreaLocality('Plumbing in Henderson, NV', 'plumbing', 'NV')).toBe('Henderson, NV');
    expect(serviceAreaLocality('Junk Removal in Henderson NV | Fast', 'junk removal', 'NV')).toBe(
      'Henderson, NV',
    );
  });

  it('keeps a bare locality when the title carries no state token', () => {
    expect(serviceAreaLocality('tree removal in Mesa', 'tree removal', 'AZ')).toBe('Mesa');
  });

  it('preserves multi-word localities', () => {
    expect(
      serviceAreaLocality('Junk Removal North Las Vegas NV | Same-Day', 'junk removal', 'NV'),
    ).toBe('North Las Vegas, NV');
  });

  it('works without a marketing suffix', () => {
    expect(serviceAreaLocality('Roof Replacement Owensboro KY', 'roof replacement', 'KY')).toBe(
      'Owensboro, KY',
    );
  });

  it('returns empty for a blank title', () => {
    expect(serviceAreaLocality('', 'roofing', 'NV')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Bundle fixture factory
// ---------------------------------------------------------------------------

function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    niche: 'roofing',
    city: 'Henderson',
    state: 'NV',
    business_name: 'Acme Roofing',
    variant: 'classic',
    hero_image_url: undefined,
    video_url: undefined,
    video_description: undefined,
    video_upload_date: undefined,
    logo_url: undefined,
    favicon_url: undefined,
    nearby_cities: [],
    trust_signals: [],
    same_as: [],
    latitude: undefined,
    longitude: undefined,
    home: {
      kind: 'home',
      slug: '',
      title: 'Roofing Henderson NV',
      meta_description: 'Top roofer in Henderson NV.',
      mdx: '',
    },
    services: [],
    service_areas: [],
    about: { kind: 'about', slug: 'about', title: 'About', meta_description: '', mdx: '' },
    contact: { kind: 'contact', slug: 'contact', title: 'Contact', meta_description: '', mdx: '' },
    blog_posts: [],
    info_pages: [],
    generated_at: '2025-01-01T00:00:00.000Z',
    reviews: [],
    aggregate_rating: undefined,
    license_number: undefined,
    insurance_carrier: undefined,
    years_in_business: undefined,
    certifications: [],
    photo_gallery: [],
    guarantees: [],
    response_time_promise: undefined,
    neighborhoods: [],
    longform_body: undefined,
    hero_image_prompt: undefined,
    ...overrides,
  };
}

const BASE_URL = 'https://example.com/';

// ---------------------------------------------------------------------------
// absUrl
// ---------------------------------------------------------------------------

describe('absUrl', () => {
  it('resolves a relative path to absolute', () => {
    expect(absUrl('/images/hero.jpg', 'https://example.com/')).toBe('https://example.com/images/hero.jpg');
  });

  it('leaves an already-absolute URL unchanged', () => {
    expect(absUrl('https://cdn.example.com/img.jpg', 'https://example.com/')).toBe(
      'https://cdn.example.com/img.jpg',
    );
  });
});

// ---------------------------------------------------------------------------
// localBusinessImage
// ---------------------------------------------------------------------------

describe('localBusinessImage', () => {
  it('returns undefined when no hero image is set', () => {
    const bundle = makeBundle({ hero_image_url: undefined, photo_gallery: [] });
    expect(localBusinessImage(bundle, BASE_URL)).toBeUndefined();
  });

  it('returns a plain string (not array) when hero only — byte-identity guarantee', () => {
    const bundle = makeBundle({
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      photo_gallery: [],
    });
    const result = localBusinessImage(bundle, BASE_URL);
    expect(typeof result).toBe('string');
    expect(result).toBe('https://cdn.example.com/hero.jpg');
  });

  it('returns [hero, ...gallery] when gallery is non-empty', () => {
    const bundle = makeBundle({
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      photo_gallery: [
        { url: 'https://cdn.example.com/g1.jpg', alt: 'G1' },
        { url: 'https://cdn.example.com/g2.jpg', alt: 'G2' },
      ],
    });
    const result = localBusinessImage(bundle, BASE_URL);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      'https://cdn.example.com/hero.jpg',
      'https://cdn.example.com/g1.jpg',
      'https://cdn.example.com/g2.jpg',
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildLocalBusinessJsonLd
// ---------------------------------------------------------------------------

describe('buildLocalBusinessJsonLd', () => {
  it('emits correct @type and @id', () => {
    // Use a trailing-slash URL so the url.replace(/\/$/, '') normalization fires.
    const bundle = makeBundle();
    const json = buildLocalBusinessJsonLd(bundle, '555-1234', BASE_URL);
    expect(json['@type']).toBe('RoofingContractor');
    expect(json['@id']).toBe('https://example.com/#localbusiness');
  });

  it('emits logo when logo_url is set', () => {
    const bundle = makeBundle({ logo_url: 'https://cdn.example.com/logo.png' });
    const json = buildLocalBusinessJsonLd(bundle, '555-1234', BASE_URL);
    expect(json.logo).toBe('https://cdn.example.com/logo.png');
  });

  it('omits logo when logo_url is absent', () => {
    const bundle = makeBundle({ logo_url: undefined });
    const json = buildLocalBusinessJsonLd(bundle, '555-1234', BASE_URL);
    expect(json.logo).toBeUndefined();
  });

  it('emits a plain string image when hero-only', () => {
    const bundle = makeBundle({
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      photo_gallery: [],
    });
    const json = buildLocalBusinessJsonLd(bundle, '555-1234', BASE_URL);
    expect(typeof json.image).toBe('string');
  });

  it('emits an array image when hero + gallery present', () => {
    const bundle = makeBundle({
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      photo_gallery: [{ url: 'https://cdn.example.com/g1.jpg', alt: 'G1' }],
    });
    const json = buildLocalBusinessJsonLd(bundle, '555-1234', BASE_URL);
    expect(Array.isArray(json.image)).toBe(true);
  });

  it('omits image when no hero', () => {
    const bundle = makeBundle({ hero_image_url: undefined });
    const json = buildLocalBusinessJsonLd(bundle, '555-1234', BASE_URL);
    expect(json.image).toBeUndefined();
  });

  it('does NOT emit openingHoursSpecification (regression guard)', () => {
    const bundle = makeBundle();
    const json = buildLocalBusinessJsonLd(bundle, '555-1234', BASE_URL);
    expect(json).not.toHaveProperty('openingHoursSpecification');
  });
});

// ---------------------------------------------------------------------------
// buildLocalBusinessRef
// ---------------------------------------------------------------------------

describe('buildLocalBusinessRef', () => {
  it('@id and @type match the rich builder — entity merging invariant', () => {
    // Trailing-slash URL exercises the url.replace(/\/$/, '') normalization in both builders.
    const bundle = makeBundle();
    const rich = buildLocalBusinessJsonLd(bundle, '555-1234', BASE_URL);
    const ref = buildLocalBusinessRef(bundle, BASE_URL);
    expect(ref['@type']).toBe(rich['@type']);
    expect(ref['@id']).toBe(rich['@id']);
  });

  it('emits logo when logo_url is set', () => {
    const bundle = makeBundle({ logo_url: 'https://cdn.example.com/logo.png' });
    const json = buildLocalBusinessRef(bundle, BASE_URL);
    expect(json.logo).toBe('https://cdn.example.com/logo.png');
  });

  it('omits logo when logo_url is absent', () => {
    const bundle = makeBundle({ logo_url: undefined });
    const json = buildLocalBusinessRef(bundle, BASE_URL);
    expect(json.logo).toBeUndefined();
  });

  it('emits a plain string image when hero-only', () => {
    const bundle = makeBundle({
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      photo_gallery: [],
    });
    const json = buildLocalBusinessRef(bundle, BASE_URL);
    expect(typeof json.image).toBe('string');
  });

  it('emits an array image when hero + gallery present', () => {
    const bundle = makeBundle({
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      photo_gallery: [{ url: 'https://cdn.example.com/g1.jpg', alt: 'G1' }],
    });
    const json = buildLocalBusinessRef(bundle, BASE_URL);
    expect(Array.isArray(json.image)).toBe(true);
  });

  it('omits image when no hero', () => {
    const bundle = makeBundle({ hero_image_url: undefined });
    const json = buildLocalBusinessRef(bundle, BASE_URL);
    expect(json.image).toBeUndefined();
  });

  it('emits url with trailing slash (ref asymmetry preserved)', () => {
    const bundle = makeBundle();
    const json = buildLocalBusinessRef(bundle, BASE_URL);
    expect(json.url).toBe('https://example.com/');
  });
});

// ---------------------------------------------------------------------------
// buildVideoObjectJsonLd
// ---------------------------------------------------------------------------

describe('buildVideoObjectJsonLd', () => {
  it('returns null when video_url is absent', () => {
    const bundle = makeBundle({ video_url: undefined, video_upload_date: '2024-06-01' });
    expect(buildVideoObjectJsonLd(bundle, BASE_URL)).toBeNull();
  });

  it('returns null when video_url is not a parseable YouTube URL', () => {
    const bundle = makeBundle({
      video_url: 'https://vimeo.com/123456789',
      video_upload_date: '2024-06-01',
    });
    expect(buildVideoObjectJsonLd(bundle, BASE_URL)).toBeNull();
  });

  it('returns null when video_upload_date is absent', () => {
    const bundle = makeBundle({
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      video_upload_date: undefined,
    });
    expect(buildVideoObjectJsonLd(bundle, BASE_URL)).toBeNull();
  });

  it('returns a valid VideoObject when all required signals are present', () => {
    const bundle = makeBundle({
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      video_upload_date: '2024-06-01',
      video_description: 'Watch our team in action',
    });
    const json = buildVideoObjectJsonLd(bundle, BASE_URL);
    expect(json).not.toBeNull();
    expect(json!['@type']).toBe('VideoObject');
    expect(json!.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
    expect(json!.uploadDate).toBe('2024-06-01');
    expect(json!.contentUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(json!.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(json!.name).toBe('Watch our team in action');
    expect(json!.description).toBe('Watch our team in action');
  });

  it('name falls back to a non-empty phrase when video_description is absent', () => {
    const bundle = makeBundle({
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      video_upload_date: '2024-06-01',
      video_description: undefined,
      business_name: 'Acme Roofing',
      niche: 'roofing',
      city: 'Henderson',
      state: 'NV',
    });
    const json = buildVideoObjectJsonLd(bundle, BASE_URL);
    expect(json).not.toBeNull();
    const name = json!.name as string;
    expect(name.length).toBeGreaterThan(0);
    expect(name).toBe('Acme Roofing — roofing in Henderson, NV');
  });

  it('omits description property when video_description is absent', () => {
    const bundle = makeBundle({
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      video_upload_date: '2024-06-01',
      video_description: undefined,
    });
    const json = buildVideoObjectJsonLd(bundle, BASE_URL);
    expect(json).not.toBeNull();
    expect(json!.description).toBeUndefined();
  });
});
