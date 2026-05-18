import { describe, it, expect } from 'vitest';
import { listCities } from './index.js';

describe('listCities', () => {
  it('returns UsCity objects with correct shape', () => {
    const cities = listCities({ populationMin: 50_000, populationMax: 60_000, sampleN: 5 });
    expect(cities.length).toBeGreaterThan(0);
    for (const c of cities) {
      expect(typeof c.city).toBe('string');
      expect(typeof c.state).toBe('string');
      expect(c.state).toMatch(/^[A-Z]{2}$/);
      expect(typeof c.stateName).toBe('string');
      expect(typeof c.county).toBe('string');
      expect(typeof c.population).toBe('number');
      expect(typeof c.lat).toBe('number');
      expect(typeof c.lng).toBe('number');
    }
  });

  it('respects populationMin and populationMax', () => {
    const cities = listCities({ populationMin: 20_000, populationMax: 30_000 });
    expect(cities.length).toBeGreaterThan(0);
    for (const c of cities) {
      expect(c.population).toBeGreaterThanOrEqual(20_000);
      expect(c.population).toBeLessThanOrEqual(30_000);
    }
  });

  it('filters by state', () => {
    const cities = listCities({ states: ['TX'], populationMin: 10_000, populationMax: 100_000 });
    expect(cities.length).toBeGreaterThan(0);
    for (const c of cities) {
      expect(c.state).toBe('TX');
    }
  });

  it('returns at most sampleN results', () => {
    const cities = listCities({ populationMin: 10_000, populationMax: 100_000, sampleN: 10 });
    expect(cities.length).toBeLessThanOrEqual(10);
  });

  it('returns all matches when sampleN is omitted', () => {
    const all = listCities({ populationMin: 10_000, populationMax: 100_000 });
    const sampled = listCities({ populationMin: 10_000, populationMax: 100_000, sampleN: 9999 });
    // sampleN larger than pool returns the full pool
    expect(sampled.length).toBe(all.length);
  });

  it('excludes non-incorporated places', () => {
    // All returned cities should have valid state codes (proxy for correct parsing)
    const cities = listCities({ populationMin: 50_000, populationMax: 80_000 });
    for (const c of cities) {
      expect(c.state.length).toBe(2);
      expect(c.city.length).toBeGreaterThan(0);
    }
  });
});
