import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ────────────────────────────────────────────────────────────
// Mock harness — captures inserts and feeds back a fake site row.
// ────────────────────────────────────────────────────────────

interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}

const insertCalls: InsertCall[] = [];

function makeFakeDb(siteRow: Record<string, unknown> | null) {
  return {
    execute: async () => undefined,
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => ({
          limit: async () => {
            if (table?.__table === 'sites') return siteRow ? [siteRow] : [];
            return [];
          },
        }),
      }),
    }),
    insert: (table: { __table?: string }) => ({
      values: (values: Record<string, unknown>) => {
        const tableName = table?.__table ?? '?';
        const chain = {
          onConflictDoNothing: () => ({
            returning: async () => {
              insertCalls.push({ table: tableName, values });
              return [{ id: `row-${insertCalls.length}` }];
            },
          }),
          onConflictDoUpdate: async () => {
            insertCalls.push({ table: tableName, values });
            return undefined;
          },
          returning: async () => {
            insertCalls.push({ table: tableName, values });
            return [{ id: `row-${insertCalls.length}` }];
          },
        };
        // Make the values() call thenable so `await db.insert().values()` works
        // for tables like agent_runs that BaseAgent uses without onConflict.
        return Object.assign(
          {
            then: (resolve: (v: unknown) => void) => {
              insertCalls.push({ table: tableName, values });
              resolve(undefined);
            },
          },
          chain,
        );
      },
    }),
    update: (table: { __table?: string }) => ({
      set: () => ({
        where: async () => {
          insertCalls.push({ table: `update:${table?.__table ?? '?'}`, values: {} });
          return undefined;
        },
      }),
    }),
  };
}

const FAKE_SITE = {
  id: '11111111-1111-1111-1111-111111111111',
  niche: 'plumbing',
  city: 'Austin',
  state: 'TX',
  trackingNumber: '+15125550100',
};

vi.mock('@leadlandlord/db', () => ({
  getDb: () => makeFakeDb(FAKE_SITE),
  backlinks: { __table: 'backlinks', dedupeKey: 'dedupe_key' },
  sites: { __table: 'sites', id: 'id' },
  agentRuns: {},
  agentBudgets: {},
  agentEvents: {},
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

vi.mock('@leadlandlord/db/suppression', () => ({
  isSuppressed: async () => false,
}));

vi.mock('@leadlandlord/integrations/resend', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'mock-msg-id' })),
}));

const fakeAnthropic = {
  messages: {
    create: vi.fn(async () => ({
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [
        {
          type: 'text',
          text:
            'Hi — I run a plumbing business in Austin, TX. ' +
            'Happy to share what we see day-to-day if it helps with the piece. ' +
            'Reply with REMOVE if you\'d rather not hear from me again. ' +
            'LeadLandlord, PO Box 0000, Austin, TX 78701',
        },
      ],
    })),
  },
};

vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => fakeAnthropic,
  estimateCostUsd: () => 0.001,
}));

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe('backlink-builder', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    fakeAnthropic.messages.create.mockClear();
  });

  afterEach(() => {
    delete process.env.RESEND_FROM_ADDRESS;
  });

  it('input schema validates citations mode', async () => {
    const { BacklinkBuilderInput } = await import('./index');
    expect(() =>
      BacklinkBuilderInput.parse({
        mode: 'citations',
        siteId: '11111111-1111-1111-1111-111111111111',
        businessName: 'Acme Plumbing',
        phone: '+15125550100',
        website: 'https://example.com',
        description: 'Local plumbers in Austin',
      }),
    ).not.toThrow();

    expect(() =>
      BacklinkBuilderInput.parse({
        mode: 'citations',
        siteId: 'not-uuid',
        businessName: 'Acme',
        phone: '+1',
        website: 'not-a-url',
        description: '',
      }),
    ).toThrow();
  });

  it('input schema validates haro mode', async () => {
    const { BacklinkBuilderInput } = await import('./index');
    expect(() =>
      BacklinkBuilderInput.parse({
        mode: 'haro',
        siteId: '11111111-1111-1111-1111-111111111111',
        queries: [{ id: 'q1', subject: 'plumbing tips', body: 'looking for plumbing experts' }],
      }),
    ).not.toThrow();
  });

  it('input schema validates guest_post mode', async () => {
    const { BacklinkBuilderInput } = await import('./index');
    expect(() =>
      BacklinkBuilderInput.parse({
        mode: 'guest_post',
        siteId: '11111111-1111-1111-1111-111111111111',
        targetDomain: 'example.com',
        targetEditorEmail: 'editor@example.com',
        pitchTopic: 'home maintenance tips',
      }),
    ).not.toThrow();

    expect(() =>
      BacklinkBuilderInput.parse({
        mode: 'guest_post',
        siteId: '11111111-1111-1111-1111-111111111111',
        targetDomain: 'example.com',
        targetEditorEmail: 'not-an-email',
        pitchTopic: 'x',
      }),
    ).toThrow();
  });

  it('citations directory list contains exactly 30 entries', async () => {
    const { CITATION_DIRECTORIES } = await import('./directories');
    expect(CITATION_DIRECTORIES).toHaveLength(30);
    // Spot-check critical entries
    const domains = CITATION_DIRECTORIES.map((d) => d.domain);
    expect(domains).toContain('yelp.com');
    expect(domains).toContain('google.com');
    expect(domains).toContain('bbb.org');
  });

  it('citations mode generates 30 backlink rows per site', async () => {
    const { BacklinkBuilder } = await import('./index');
    const agent = new BacklinkBuilder();
    const exec = (
      agent as unknown as {
        execute: (
          i: unknown,
          ctx: { runId: string; log: { info: () => void; warn: () => void; error: () => void }; recordUsage: () => void },
        ) => Promise<unknown>;
      }
    ).execute.bind(agent);

    const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
    const ctx = {
      runId: 'run-1',
      log: noopLog,
      recordUsage: () => {},
      progress: () => {},
      emitNextStepEvent: async () => {},
      parentRunId: null,
    };

    const result = (await exec(
      {
        mode: 'citations',
        siteId: FAKE_SITE.id,
        businessName: 'Acme Plumbing',
        phone: '+15125550100',
        website: 'https://example.com',
        description: 'Local plumbers in Austin',
      },
      ctx,
    )) as { mode: string; rowsCreated: number };

    expect(result.mode).toBe('citations');
    expect(result.rowsCreated).toBe(30);
    const backlinkInserts = insertCalls.filter((c) => c.table === 'backlinks');
    expect(backlinkInserts).toHaveLength(30);
    // Each row should carry submitUrl in metadata for operator action.
    for (const ins of backlinkInserts) {
      expect(ins.values.type).toBe('citation');
      expect(ins.values.status).toBe('pending');
      const md = ins.values.metadata as Record<string, unknown>;
      expect(typeof md.submitUrl).toBe('string');
      expect(typeof md.instructions).toBe('string');
    }
  });

  it('haro mode drafts a pitch via Claude and writes a pending backlink row', async () => {
    const { BacklinkBuilder } = await import('./index');
    const agent = new BacklinkBuilder();
    const exec = (
      agent as unknown as {
        execute: (i: unknown, ctx: unknown) => Promise<unknown>;
      }
    ).execute.bind(agent);

    const ctx = {
      runId: 'run-2',
      log: { info: () => {}, warn: () => {}, error: () => {} },
      recordUsage: () => {},
      progress: () => {},
      emitNextStepEvent: async () => {},
      parentRunId: null,
    };

    const result = (await exec(
      {
        mode: 'haro',
        siteId: FAKE_SITE.id,
        queries: [
          {
            id: 'q-99',
            subject: 'Plumbing tips for new homeowners',
            body: 'Looking for licensed plumbing experts to share advice.',
          },
        ],
      },
      ctx,
    )) as { mode: string; rowsCreated: number };

    expect(result.mode).toBe('haro');
    expect(fakeAnthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(result.rowsCreated).toBe(1);

    const backlinkInserts = insertCalls.filter((c) => c.table === 'backlinks');
    expect(backlinkInserts).toHaveLength(1);
    const row = backlinkInserts[0]!.values;
    expect(row.type).toBe('haro');
    expect(row.status).toBe('pending');
    expect(typeof row.pitchDraft).toBe('string');
    expect((row.pitchDraft as string).length).toBeGreaterThan(0);
  });

  it('haro mode skips queries that do not match the site niche', async () => {
    const { BacklinkBuilder } = await import('./index');
    const agent = new BacklinkBuilder();
    const exec = (
      agent as unknown as { execute: (i: unknown, ctx: unknown) => Promise<unknown> }
    ).execute.bind(agent);
    const ctx = {
      runId: 'run-3',
      log: { info: () => {}, warn: () => {}, error: () => {} },
      recordUsage: () => {},
      progress: () => {},
      emitNextStepEvent: async () => {},
      parentRunId: null,
    };
    const result = (await exec(
      {
        mode: 'haro',
        siteId: FAKE_SITE.id,
        queries: [{ id: 'qZ', subject: 'crypto tax advice', body: 'looking for CPAs' }],
      },
      ctx,
    )) as { rowsCreated: number };
    expect(result.rowsCreated).toBe(0);
    expect(fakeAnthropic.messages.create).not.toHaveBeenCalled();
  });
});
