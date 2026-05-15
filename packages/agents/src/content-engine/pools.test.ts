import { describe, expect, it } from 'vitest';
import { getTrustSignals } from './trust-signal-pool';
import { getDisclosure } from './disclosure-pool';
import { getHeadlineTemplate } from './headline-templates';

const ID_A = '00000000-0000-0000-0000-000000000001';
const ID_B = '00000000-0000-0000-0000-000000000002';
const ID_C = '00000000-0000-0000-0000-000000000003';

describe('getTrustSignals', () => {
  it('returns the requested count of signals', () => {
    const signals = getTrustSignals(ID_A, 'classic', 4);
    expect(signals).toHaveLength(4);
  });

  it('returns distinct signals (no duplicates)', () => {
    const signals = getTrustSignals(ID_A, 'classic', 6);
    expect(new Set(signals).size).toBe(signals.length);
  });

  it('is deterministic — same siteId+niche always returns same values', () => {
    const first = getTrustSignals(ID_A, 'classic', 4);
    const second = getTrustSignals(ID_A, 'classic', 4);
    expect(first).toEqual(second);
  });

  it('different siteIds return different selections', () => {
    const a = getTrustSignals(ID_A, 'classic', 4);
    const b = getTrustSignals(ID_B, 'classic', 4);
    // Not guaranteed to differ on every element but should differ somewhere
    expect(a.join()).not.toBe(b.join());
  });

  it('returns non-empty strings', () => {
    for (const sig of getTrustSignals(ID_A, 'classic', 4)) {
      expect(sig.length).toBeGreaterThan(0);
    }
  });

  it('works for all four theme keys', () => {
    for (const theme of ['classic', 'modern', 'premium', 'bright']) {
      const signals = getTrustSignals(ID_A, theme, 3);
      expect(signals.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('caps at pool size without throwing', () => {
    expect(() => getTrustSignals(ID_A, 'classic', 100)).not.toThrow();
  });
});

describe('getDisclosure', () => {
  it('returns a non-empty string', () => {
    expect(getDisclosure(ID_A).length).toBeGreaterThan(10);
  });

  it('is deterministic — same siteId always returns same disclosure', () => {
    expect(getDisclosure(ID_A)).toBe(getDisclosure(ID_A));
  });

  it('different siteIds return different disclosures', () => {
    const results = new Set([ID_A, ID_B, ID_C].map(getDisclosure));
    // 3 different UUIDs should not all hash to the same pool entry
    expect(results.size).toBeGreaterThan(1);
  });

  it('disclosure contains referral/provider language', () => {
    const d = getDisclosure(ID_A);
    expect(d.toLowerCase()).toMatch(/provider|partner|referral|contractor|connect/);
  });
});

describe('getHeadlineTemplate', () => {
  it('returns a string containing at least one placeholder', () => {
    const tmpl = getHeadlineTemplate(ID_A, 'classic');
    expect(tmpl).toMatch(/\{service\}|\{city\}|\{trust_signal\}/);
  });

  it('is deterministic — same siteId+niche always returns same template', () => {
    expect(getHeadlineTemplate(ID_A, 'classic')).toBe(getHeadlineTemplate(ID_A, 'classic'));
  });

  it('different siteIds return different templates', () => {
    const results = new Set([ID_A, ID_B, ID_C].map((id) => getHeadlineTemplate(id, 'classic')));
    expect(results.size).toBeGreaterThan(1);
  });

  it('works for all four theme keys', () => {
    for (const theme of ['classic', 'modern', 'premium', 'bright']) {
      const tmpl = getHeadlineTemplate(ID_A, theme);
      expect(tmpl.length).toBeGreaterThan(0);
    }
  });

  it('falls back gracefully for unknown niche', () => {
    const tmpl = getHeadlineTemplate(ID_A, 'unknown-niche');
    expect(tmpl).toBeTruthy();
  });
});
