import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(),
  buildsellSites: {},
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { scheduleBuildsellReviewRefresh } from './buildsell-review-refresh';

const SITE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scheduleBuildsellReviewRefresh', () => {
  it('enqueues one event per non-draft site with a place_id', async () => {
    const { getDb } = await import('@leadlandlord/db');
    vi.mocked(getDb).mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ id: SITE_A }, { id: SITE_B }]),
    } as never);

    const events = await scheduleBuildsellReviewRefresh();

    expect(events).toHaveLength(2);
    for (const ev of events) {
      expect(ev.agent).toBe('buildsell-review-refresh');
      expect((ev.payload as { buildsell_site_id?: string }).buildsell_site_id).toBeTruthy();
      // dedupeKey ends with the YYYY-MM month key.
      expect(ev.dedupeKey).toMatch(/^buildsell-review-refresh:[0-9a-f-]+:\d{4}-\d{2}$/);
    }
    expect(events[0]!.payload).toEqual({ buildsell_site_id: SITE_A });
  });

  it('handles the {rows: [...]} result shape from db.execute', async () => {
    const { getDb } = await import('@leadlandlord/db');
    vi.mocked(getDb).mockReturnValue({
      execute: vi.fn().mockResolvedValue({ rows: [{ id: SITE_A }] }),
    } as never);

    const events = await scheduleBuildsellReviewRefresh();
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ buildsell_site_id: SITE_A });
  });

  it('returns an empty array when no sites qualify', async () => {
    const { getDb } = await import('@leadlandlord/db');
    vi.mocked(getDb).mockReturnValue({
      execute: vi.fn().mockResolvedValue([]),
    } as never);

    const events = await scheduleBuildsellReviewRefresh();
    expect(events).toEqual([]);
  });
});
