import { describe, it, expect } from 'vitest';
import { parseCensusName } from './index';

describe('parseCensusName', () => {
  it('strips " city" suffix and state', () => {
    expect(parseCensusName('Owensboro city, Kentucky')).toBe('owensboro');
  });

  it('strips " city" when city name also contains "city"', () => {
    // "Boise City city, Idaho" -> "boise city" (only trailing " city" removed)
    expect(parseCensusName('Boise City city, Idaho')).toBe('boise city');
  });

  it('strips " town" suffix', () => {
    expect(parseCensusName('Oak Grove town, Missouri')).toBe('oak grove');
  });

  it('strips " CDP" suffix (case-insensitive internal match)', () => {
    expect(parseCensusName('Tanaina CDP, Alaska')).toBe('tanaina');
  });

  it('strips " village" suffix', () => {
    expect(parseCensusName('Skokie village, Illinois')).toBe('skokie');
  });

  it('strips " borough" suffix', () => {
    expect(parseCensusName('Kutztown borough, Pennsylvania')).toBe('kutztown');
  });

  it('strips " metro government (balance)" suffix', () => {
    expect(parseCensusName('Nashville-Davidson metro government (balance), Tennessee')).toBe(
      'nashville-davidson',
    );
  });

  it('strips " unified government (balance)" suffix', () => {
    expect(parseCensusName('Athens-Clarke County unified government (balance), Georgia')).toBe(
      'athens-clarke county',
    );
  });

  it('strips " charter township" suffix', () => {
    expect(parseCensusName('Meridian charter township, Michigan')).toBe('meridian');
  });

  it('handles no recognized suffix gracefully', () => {
    // No known suffix — returns lowercased name without state.
    expect(parseCensusName('Springfield, Illinois')).toBe('springfield');
  });

  it('returns lowercase', () => {
    const result = parseCensusName('Portland city, Oregon');
    expect(result).toBe(result.toLowerCase());
  });

  it('handles missing state suffix gracefully', () => {
    // No comma at all — treats whole string as place name.
    expect(parseCensusName('Smalltown city')).toBe('smalltown');
  });
});
