/**
 * Unit tests for the pure cross-link classification used by the verifier/reaper.
 * The verifier module imports @leadlandlord/db + drizzle for its DB pass; we stub
 * them so importing the pure `classifyCrossLink` doesn't pull in a real client.
 */
vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(),
  crossSiteLinks: {},
  sites: {},
  isCrossLinkPaused: vi.fn(async () => false),
}));
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn(),
}));

import { describe, expect, it, vi } from 'vitest';
import { classifyCrossLink } from '../cross-link-verifier';

describe('classifyCrossLink', () => {
  it('reaps a link whose target site is no longer live', () => {
    expect(classifyCrossLink('archived', 200)).toBe('broken');
    expect(classifyCrossLink('paused', 200)).toBe('broken');
    expect(classifyCrossLink(null, 200)).toBe('broken');
  });

  it('marks a live target with a 2xx/3xx response as verified', () => {
    expect(classifyCrossLink('live', 200)).toBe('verified');
    expect(classifyCrossLink('warming', 301)).toBe('verified');
    expect(classifyCrossLink('rented', 200)).toBe('verified');
  });

  it('marks a live target returning 4xx/5xx as broken', () => {
    expect(classifyCrossLink('live', 404)).toBe('broken');
    expect(classifyCrossLink('live', 500)).toBe('broken');
  });

  it('leaves a link unknown on a transient network failure (null status)', () => {
    expect(classifyCrossLink('live', null)).toBe('unknown');
  });
});
