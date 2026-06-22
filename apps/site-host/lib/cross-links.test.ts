/**
 * Unit tests for the pure cross-link injection logic. The module imports
 * @leadlandlord/db at the top level (for the DB-backed fetch), so we stub it —
 * `injectCrossLinks` itself touches no DB.
 */
vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(),
  crossSiteLinks: {},
  eq: vi.fn(),
  and: vi.fn(),
  isCrossLinkPaused: vi.fn(async () => false),
}));

import { describe, expect, it, vi } from 'vitest';
import { injectCrossLinks, type InjectableCrossLink } from './cross-links';

function link(overrides: Partial<InjectableCrossLink> = {}): InjectableCrossLink {
  return {
    matchContext: 'We also serve nearby Dallas.',
    injectedMarkdown: 'We also serve nearby [plumbing in Dallas](https://dallasplumb.com/).',
    anchorText: 'plumbing in Dallas',
    targetUrl: 'https://dallasplumb.com/',
    ...overrides,
  };
}

describe('injectCrossLinks', () => {
  it('replaces the matched source sentence with the injected markdown', () => {
    const md = 'We do great work. We also serve nearby Dallas. Call today.';
    const out = injectCrossLinks(md, [link()]);
    expect(out).toContain('[plumbing in Dallas](https://dallasplumb.com/)');
    expect(out).toContain('We do great work.');
    expect(out).toContain('Call today.');
    // The original (un-linked) sentence is gone.
    expect(out).not.toContain('We also serve nearby Dallas. Call');
  });

  it('is a no-op when the match context is absent (content drift) — never misplaces', () => {
    const md = 'Totally different copy with no matching sentence.';
    const out = injectCrossLinks(md, [link()]);
    expect(out).toBe(md);
  });

  it('does not double-inject when the link is already present', () => {
    const md = 'Intro. We also serve nearby [plumbing in Dallas](https://dallasplumb.com/). End.';
    const out = injectCrossLinks(md, [link()]);
    expect(out).toBe(md);
    // Only one occurrence of the href.
    expect(out.match(/dallasplumb\.com/g)?.length).toBe(1);
  });

  it('returns markdown unchanged when there are no links', () => {
    const md = 'Some copy.';
    expect(injectCrossLinks(md, [])).toBe(md);
  });

  it('injects only the first occurrence of a repeated context', () => {
    const md = 'We also serve nearby Dallas. Middle. We also serve nearby Dallas.';
    const out = injectCrossLinks(md, [link()]);
    expect(out.match(/dallasplumb\.com/g)?.length).toBe(1);
    // The trailing duplicate sentence is left intact.
    expect(out.endsWith('We also serve nearby Dallas.')).toBe(true);
  });
});
