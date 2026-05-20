import { describe, expect, it } from 'vitest';
import { serviceAreaLocality, subtypeFor } from './local-business-schema';

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
