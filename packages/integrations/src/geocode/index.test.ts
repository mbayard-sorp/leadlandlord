import { describe, it, expect } from 'vitest';
import { stateCentroid, geocodeCityState } from './index';

describe('stateCentroid', () => {
  it('returns a centroid for a known state (case-insensitive)', () => {
    const tx = stateCentroid('tx');
    expect(tx).not.toBeNull();
    expect(tx!.latitude).toBeCloseTo(31.05, 0);
    expect(tx!.longitude).toBeCloseTo(-97.56, 0);
    expect(tx!.source).toBe('state-centroid');
  });

  it('returns null for an unknown state', () => {
    expect(stateCentroid('ZZ')).toBeNull();
  });
});

describe('geocodeCityState', () => {
  it('resolves a known city to us-cities coordinates', async () => {
    // Henderson, NV is in the canonical us-cities dataset.
    const geo = await geocodeCityState('Henderson', 'NV');
    expect(geo).not.toBeNull();
    expect(geo!.source).toBe('us-cities');
    // Henderson, NV is ~36.03 N, ~114.98 W.
    expect(geo!.latitude).toBeCloseTo(36.03, 0);
    expect(geo!.longitude).toBeCloseTo(-114.98, 0);
  });

  it('is case-insensitive and trims the city name', async () => {
    const geo = await geocodeCityState('  henderson  ', 'nv');
    expect(geo).not.toBeNull();
    expect(geo!.source).toBe('us-cities');
  });

  it('falls back to the state centroid for a city not in the dataset', async () => {
    const geo = await geocodeCityState('Nonexistentville', 'TX');
    expect(geo).not.toBeNull();
    expect(geo!.source).toBe('state-centroid');
    expect(geo!.latitude).toBeCloseTo(31.05, 0);
  });

  it('returns null when the state is unknown', async () => {
    const geo = await geocodeCityState('Nowhere', 'ZZ');
    expect(geo).toBeNull();
  });
});
