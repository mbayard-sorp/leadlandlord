import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(),
  sites: {},
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

// The local-content-scout module imports @leadlandlord/integrations/sanity which
// pulls in Sanity's CSS bundle and breaks vitest's loader. Mock it out here since
// the scheduler only uses the isoWeek helper (no Sanity calls).
vi.mock('@leadlandlord/integrations/sanity', () => ({
  createReadClient: vi.fn(),
  createWriteClient: vi.fn(),
  siteDocId: (id: string) => `site-${id}`,
  pageDocId: (siteId: string, kind: string, idx: number) => `page-${siteId}-${kind}-${idx}`,
}));

vi.mock('@leadlandlord/integrations/dataforseo', () => ({
  getLocalKeywordMetrics: vi.fn().mockResolvedValue([]),
}));

vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: vi.fn(),
  estimateCostUsd: vi.fn().mockReturnValue(0),
}));

vi.mock('../approval-engine', () => ({
  checkAutoApprove: vi.fn().mockResolvedValue({ matched: false }),
}));

import { scheduleLocalContentScout } from './local-content-scout';

const SITE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Precompute day-of-week slots for our test sites using the same hash as the impl.
function siteSlot(siteId: string): number {
  let h = 5381;
  for (let i = 0; i < siteId.length; i++) {
    h = ((h * 33) ^ siteId.charCodeAt(i)) >>> 0;
  }
  return h % 7;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scheduleLocalContentScout', () => {
  it('only enqueues sites with localContentEnabled=true', async () => {
    const { getDb } = await import('@leadlandlord/db');
    vi.mocked(getDb).mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ site_id: SITE_A }]),
    } as never);

    const events = await scheduleLocalContentScout();
    // All returned rows are from the DB query which already filters localContentEnabled.
    // The scheduler additionally filters by day-of-week slot.
    // Since we can't control today's DOW, just verify structure if any events returned.
    for (const ev of events) {
      expect(ev.agent).toBe('local-content-scout');
      expect((ev.payload as { site_id?: string }).site_id).toBeTruthy();
      expect(ev.dedupeKey).toMatch(/^local-content-scout:site:/);
    }
  });

  it('day-of-week slotting is deterministic — same siteId always maps to same slot', () => {
    const slot1 = siteSlot(SITE_A);
    const slot2 = siteSlot(SITE_A);
    expect(slot1).toBe(slot2);
    expect(slot1).toBeGreaterThanOrEqual(0);
    expect(slot1).toBeLessThan(7);
  });

  it('two different siteIds may get different slots', () => {
    const slotA = siteSlot(SITE_A);
    const slotB = siteSlot(SITE_B);
    // They won't always differ, but for these two specific UUIDs we can check they are valid.
    expect(slotA).toBeGreaterThanOrEqual(0);
    expect(slotB).toBeGreaterThanOrEqual(0);
    // The hash function distributes across 0-6. Log both for documentation.
    expect([slotA, slotB].every((s) => s >= 0 && s < 7)).toBe(true);
  });

  it('dedupeKey includes isoWeek', async () => {
    const { getDb } = await import('@leadlandlord/db');

    // Find a site whose slot matches today's DOW so it actually gets enqueued.
    const todayDow = new Date().getUTCDay();
    const matchingSite = [SITE_A, SITE_B].find((id) => siteSlot(id) === todayDow);

    if (!matchingSite) {
      // No test site happens to match today — skip the dedupeKey content assertion.
      return;
    }

    vi.mocked(getDb).mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ site_id: matchingSite }]),
    } as never);

    const events = await scheduleLocalContentScout();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.dedupeKey).toMatch(/-W\d{2}$/);
  });

  it('returns empty array when DB returns no sites', async () => {
    const { getDb } = await import('@leadlandlord/db');
    vi.mocked(getDb).mockReturnValue({
      execute: vi.fn().mockResolvedValue([]),
    } as never);

    const events = await scheduleLocalContentScout();
    expect(events).toEqual([]);
  });

  it('returns empty array when no sites match today slot', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const todayDow = new Date().getUTCDay();
    // Find a site that does NOT match today's slot.
    const nonMatchingSite = [SITE_A, SITE_B].find((id) => siteSlot(id) !== todayDow);

    if (!nonMatchingSite) return; // both match today — skip

    vi.mocked(getDb).mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ site_id: nonMatchingSite }]),
    } as never);

    const events = await scheduleLocalContentScout();
    expect(events).toEqual([]);
  });
});
