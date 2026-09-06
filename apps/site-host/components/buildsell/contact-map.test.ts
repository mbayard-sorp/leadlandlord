import { describe, expect, it } from 'vitest';
import type { BuildSellSection } from '@/lib/sanity';
import { buildMapEmbedUrl, resolveMapQuery, serviceAreaToMapQuery } from './contact-map';

const section = (over: Partial<BuildSellSection>): BuildSellSection =>
  ({ _type: 'bsContactSection', _key: 'contact', ...over }) as BuildSellSection;

describe('serviceAreaToMapQuery', () => {
  it('keeps only the leading place from generated prose', () => {
    expect(
      serviceAreaToMapQuery('San Tan Valley and surrounding East Valley communities', 'AZ'),
    ).toBe('San Tan Valley, AZ');
    expect(
      serviceAreaToMapQuery(
        'Avondale and surrounding West Valley communities including Goodyear, Tolleson, and Litchfield Park',
        'AZ',
      ),
    ).toBe('Avondale, AZ');
  });

  it('does not repeat a state the area already names', () => {
    expect(serviceAreaToMapQuery('Tucson, AZ', 'AZ')).toBe('Tucson, AZ');
  });

  it('passes the area through when there is no state', () => {
    expect(serviceAreaToMapQuery('Burbank, Glendale, Pasadena', null)).toBe('Burbank, Glendale, Pasadena');
  });
});

describe('resolveMapQuery', () => {
  it('prefers an explicit map location over everything else', () => {
    const q = resolveMapQuery(
      section({ mapQuery: 'Queen Creek, AZ', address: { serviceArea: 'Mesa and nearby', city: 'Mesa', state: 'AZ' } }),
    );
    expect(q).toBe('Queen Creek, AZ');
  });

  it('falls back to the street address when there is no service area', () => {
    const q = resolveMapQuery(section({ address: { street: '17602 N 55th Ave', city: 'Glendale', state: 'AZ', zip: '85308' } }));
    expect(q).toBe('17602 N 55th Ave, Glendale, AZ, 85308');
  });

  it('falls back to city + state as a last resort', () => {
    expect(resolveMapQuery(section({ address: { city: 'Mesa', state: 'AZ' } }))).toBe('Mesa, AZ');
  });

  it('returns null when there is nothing to geocode', () => {
    expect(resolveMapQuery(section({}))).toBeNull();
    expect(resolveMapQuery(section({ address: { hours: 'Mon-Sat' } }))).toBeNull();
  });
});

describe('buildMapEmbedUrl', () => {
  it('encodes the query and zoom into the keyless embed URL', () => {
    const url = buildMapEmbedUrl(section({ address: { serviceArea: 'San Tan Valley and surrounding areas', state: 'AZ' } }));
    expect(url).toBe('https://www.google.com/maps?q=San+Tan+Valley%2C+AZ&z=11&output=embed');
  });

  it('honours an explicit zoom', () => {
    const url = buildMapEmbedUrl(section({ mapQuery: 'Mesa, AZ', mapZoom: 14 }));
    expect(url).toContain('z=14');
  });

  it('returns null when the section has no location', () => {
    expect(buildMapEmbedUrl(section({}))).toBeNull();
  });
});
