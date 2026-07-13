import { describe, it, expect } from 'vitest';
import {
  sampleProbeQueries,
  classifyCitation,
  runLiveCitationProbe,
  LIVE_CITATION_PROBE_UNAVAILABLE_REASON,
} from './citation-probe';

const HOME_HTML = `<html><body>
  <h2>How much does tree removal cost in Tucson?</h2>
  <p>Answer one.</p>
  <h2>Our Services</h2>
  <p>Not a question.</p>
  <h3>Do you offer emergency tree removal?</h3>
  <p>Answer two.</p>
</body></html>`;

const CONTACT_HTML = `<html><body>
  <h2>What areas do you serve?</h2>
  <p>Answer three.</p>
  <h3>Why choose us?</h3>
  <p>Answer four.</p>
</body></html>`;

const PAGES = [
  { url: 'https://tucsontreepros.com/', html: HOME_HTML },
  { url: 'https://tucsontreepros.com/contact', html: CONTACT_HTML },
];

describe('sampleProbeQueries', () => {
  it('returns only question-style headings', () => {
    const sampled = sampleProbeQueries(PAGES, '2026-W28', 10);
    expect(sampled.length).toBe(4);
    for (const q of sampled) {
      expect(/\?$/.test(q.query) || /^(how|what|why|when|where|who|which|can|do|does|is|are|should)\b/i.test(q.query)).toBe(true);
    }
  });

  it('caps the sample at n', () => {
    const sampled = sampleProbeQueries(PAGES, '2026-W28', 3);
    expect(sampled.length).toBe(3);
  });

  it('is deterministic for the same inputs', () => {
    const a = sampleProbeQueries(PAGES, '2026-W28', 3);
    const b = sampleProbeQueries(PAGES, '2026-W28', 3);
    expect(a).toEqual(b);
  });

  it('rotates the sample across different weeks', () => {
    // With 4 candidates and n=3, at least one week pair in a reasonable range
    // must produce a different starting offset (hash spread), proving the
    // rotation isn't a no-op — while any single week stays reproducible.
    const weeks = Array.from({ length: 8 }, (_, i) => `2026-W${String(20 + i).padStart(2, '0')}`);
    const samples = weeks.map((w) => sampleProbeQueries(PAGES, w, 3).map((q) => q.query).join('|'));
    const distinct = new Set(samples);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('returns empty when no question-style headings exist', () => {
    const flat = [{ url: 'https://example.com/', html: '<h2>Our Services</h2><p>text</p>' }];
    expect(sampleProbeQueries(flat, '2026-W28', 3)).toEqual([]);
  });
});

describe('classifyCitation', () => {
  it('matches an exact apex domain', () => {
    const { cited, citedUrls } = classifyCitation('tucsontreepros.com', [
      'https://tucsontreepros.com/faq',
      'https://otherhost.com/',
    ]);
    expect(cited).toBe(true);
    expect(citedUrls).toEqual(['https://tucsontreepros.com/faq']);
  });

  it('matches ignoring www and scheme', () => {
    const { cited } = classifyCitation('tucsontreepros.com', ['http://www.tucsontreepros.com/services']);
    expect(cited).toBe(true);
  });

  it('does not match a different domain, including similar substrings', () => {
    const { cited, citedUrls } = classifyCitation('tucsontreepros.com', [
      'https://nottucsontreepros.com/',
      'https://tucsontreepros.com.evil.example/',
    ]);
    expect(cited).toBe(false);
    expect(citedUrls).toEqual([]);
  });

  it('returns cited=false with no citations', () => {
    expect(classifyCitation('tucsontreepros.com', [])).toEqual({ cited: false, citedUrls: [] });
  });
});

describe('runLiveCitationProbe', () => {
  it('is unavailable with an explicit reason when a domain is present', async () => {
    const snap = await runLiveCitationProbe({ domain: 'tucsontreepros.com', pages: PAGES, week: '2026-W28' });
    expect(snap.status).toBe('unavailable');
    expect(snap.reason).toBe(LIVE_CITATION_PROBE_UNAVAILABLE_REASON);
    expect(snap.sampledCount).toBeGreaterThan(0);
    expect(snap.citedCount).toBe(0);
    for (const q of snap.queries) {
      expect(q.cited).toBeNull();
      expect(q.citedUrls).toEqual([]);
    }
  });

  it('is unavailable with a domain-specific reason when there is no domain', async () => {
    const snap = await runLiveCitationProbe({ domain: null, pages: PAGES, week: '2026-W28' });
    expect(snap.status).toBe('unavailable');
    expect(snap.reason).toMatch(/no domain/i);
    expect(snap.queries).toEqual([]);
    expect(snap.sampledCount).toBe(0);
  });

  it('never fabricates a cited result', async () => {
    const snap = await runLiveCitationProbe({ domain: 'tucsontreepros.com', pages: PAGES, week: '2026-W28' });
    expect(snap.status).not.toBe('ok');
    expect(snap.citedCount).toBe(0);
  });
});
