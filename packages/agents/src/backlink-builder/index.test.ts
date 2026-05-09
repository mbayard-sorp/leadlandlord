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
          onConflictDoNothing: () => {
            const subChain = {
              returning: async () => {
                insertCalls.push({ table: tableName, values });
                return [{ id: `row-${insertCalls.length}` }];
              },
              then: (resolve: (v: unknown) => void) => {
                insertCalls.push({ table: tableName, values });
                resolve(undefined);
              },
            };
            return subChain;
          },
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

const sendEmailResendMock = vi.fn(async () => ({ messageId: 'mock-msg-id' }));
vi.mock('@leadlandlord/integrations/resend', () => ({
  sendEmail: sendEmailResendMock,
}));

const sendEmailZohoMock = vi.fn(async () => ({ messageId: 'zoho-mock-id' }));
vi.mock('@leadlandlord/integrations/zoho-mcp', () => ({
  sendEmail: sendEmailZohoMock,
}));

const getRemainingSendsTodayMock = vi.fn(async () => ({ remaining: 50, cap: 50, sentToday: 0 }));
const recordSendMock = vi.fn(async () => undefined);
vi.mock('@leadlandlord/db/email-throttle', () => ({
  getRemainingSendsToday: getRemainingSendsTodayMock,
  recordSend: recordSendMock,
}));

// Default Claude response shaped like a real guest_post draft (JSON contract).
// haro tests don't parse the body so a JSON string works there too — the
// pitchDraft column just stores the trimmed text.
const DEFAULT_BODY = [
  'Quick note from someone who pulls slab leaks out of 1970s Austin houses every week.',
  '',
  "I've been reading the column you run on home upkeep and wanted to pitch two angles that would actually be useful to your readers, not just SEO filler.",
  '',
  '1) "Five Slab-Leak Tells Most Austin Homeowners Miss" — a walk-through of the specific warm-spot, water-bill, and meter-spin patterns we see before a pipe under the foundation gives out, with photos from real jobs.',
  '',
  '2) "What Hard Water Actually Costs You In Year Three" — concrete numbers from customer water heaters we replace early, broken down by appliance.',
  '',
  "Open to either, or something else if a different angle fits your calendar better?",
  '',
  '— plumbing team in Austin',
  "Reply with REMOVE if you'd rather not hear from me again.",
  'LeadLandlord, [postal address not set], Austin, TX',
].join('\n');

const DEFAULT_CLAUDE_TEXT = JSON.stringify({
  subject: 'Two slab-leak angles for Austin homeowners',
  body: DEFAULT_BODY,
});

const fakeAnthropic = {
  messages: {
    create: vi.fn(async () => ({
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: 'text', text: DEFAULT_CLAUDE_TEXT }],
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
    sendEmailResendMock.mockClear();
    sendEmailZohoMock.mockClear();
    getRemainingSendsTodayMock.mockClear();
    getRemainingSendsTodayMock.mockResolvedValue({ remaining: 50, cap: 50, sentToday: 0 });
    recordSendMock.mockClear();
    delete process.env.ZOHO_MCP_ENABLED;
    delete process.env.ZOHO_DEFAULT_FROM;
    delete process.env.RESEND_FROM_ADDRESS;
  });

  afterEach(() => {
    delete process.env.ZOHO_MCP_ENABLED;
    delete process.env.ZOHO_DEFAULT_FROM;
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

  it('guest_post mode without ZOHO_MCP_ENABLED falls back to Resend', async () => {
    process.env.RESEND_FROM_ADDRESS = 'sender@example.com';
    const { BacklinkBuilder } = await import('./index');
    const agent = new BacklinkBuilder();
    const exec = (
      agent as unknown as { execute: (i: unknown, ctx: unknown) => Promise<unknown> }
    ).execute.bind(agent);
    const c = {
      runId: 'run-gp-1',
      log: { info: () => {}, warn: () => {}, error: () => {} },
      recordUsage: () => {},
      progress: () => {},
      emitNextStepEvent: async () => {},
      parentRunId: null,
    };
    const result = (await exec(
      {
        mode: 'guest_post',
        siteId: FAKE_SITE.id,
        targetDomain: 'example.com',
        targetEditorEmail: 'editor@example.com',
        pitchTopic: 'home maintenance',
      },
      c,
    )) as { rowsSent: number };

    expect(sendEmailResendMock).toHaveBeenCalledTimes(1);
    expect(sendEmailZohoMock).not.toHaveBeenCalled();
    expect(result.rowsSent).toBe(1);
    expect(recordSendMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'resend', status: 'sent' }),
    );
  });

  it('guest_post mode with ZOHO_MCP_ENABLED=true sends via Zoho', async () => {
    process.env.ZOHO_MCP_ENABLED = 'true';
    process.env.ZOHO_DEFAULT_FROM = 'kyle@leadlandlord.example';
    const { BacklinkBuilder } = await import('./index');
    const agent = new BacklinkBuilder();
    const exec = (
      agent as unknown as { execute: (i: unknown, ctx: unknown) => Promise<unknown> }
    ).execute.bind(agent);
    const c = {
      runId: 'run-gp-2',
      log: { info: () => {}, warn: () => {}, error: () => {} },
      recordUsage: () => {},
      progress: () => {},
      emitNextStepEvent: async () => {},
      parentRunId: null,
    };
    const result = (await exec(
      {
        mode: 'guest_post',
        siteId: FAKE_SITE.id,
        targetDomain: 'example.com',
        targetEditorEmail: 'editor@example.com',
        pitchTopic: 'home maintenance',
      },
      c,
    )) as { rowsSent: number };

    expect(sendEmailZohoMock).toHaveBeenCalledTimes(1);
    expect(sendEmailResendMock).not.toHaveBeenCalled();
    expect(result.rowsSent).toBe(1);
    expect(recordSendMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'zoho', status: 'sent' }),
    );
  });

  it('guest_post mode with throttle remaining=0 skips send and writes pending row', async () => {
    process.env.ZOHO_MCP_ENABLED = 'true';
    process.env.ZOHO_DEFAULT_FROM = 'kyle@leadlandlord.example';
    getRemainingSendsTodayMock.mockResolvedValueOnce({ remaining: 0, cap: 50, sentToday: 50 });

    const { BacklinkBuilder } = await import('./index');
    const agent = new BacklinkBuilder();
    const exec = (
      agent as unknown as { execute: (i: unknown, ctx: unknown) => Promise<unknown> }
    ).execute.bind(agent);
    const c = {
      runId: 'run-gp-3',
      log: { info: () => {}, warn: () => {}, error: () => {} },
      recordUsage: () => {},
      progress: () => {},
      emitNextStepEvent: async () => {},
      parentRunId: null,
    };
    const result = (await exec(
      {
        mode: 'guest_post',
        siteId: FAKE_SITE.id,
        targetDomain: 'example.com',
        targetEditorEmail: 'editor@example.com',
        pitchTopic: 'home maintenance',
      },
      c,
    )) as { rowsCreated: number; rowsSent: number };

    expect(sendEmailZohoMock).not.toHaveBeenCalled();
    expect(sendEmailResendMock).not.toHaveBeenCalled();
    expect(result.rowsSent).toBe(0);
    expect(result.rowsCreated).toBe(1);
    expect(recordSendMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'throttled' }),
    );
    const backlinkInserts = insertCalls.filter((c) => c.table === 'backlinks');
    expect(backlinkInserts).toHaveLength(1);
    expect(backlinkInserts[0]?.values.status).toBe('pending');
    const md = backlinkInserts[0]?.values.metadata as Record<string, unknown>;
    expect(md.throttled).toBe(true);
  });

  it('guest_post draft satisfies prompt contract (subject length, body shape, REMOVE + postal lines, two concrete angles)', async () => {
    process.env.RESEND_FROM_ADDRESS = 'sender@example.com';
    const { BacklinkBuilder } = await import('./index');
    const agent = new BacklinkBuilder();
    const exec = (
      agent as unknown as { execute: (i: unknown, ctx: unknown) => Promise<unknown> }
    ).execute.bind(agent);
    const c = {
      runId: 'run-gp-contract',
      log: { info: () => {}, warn: () => {}, error: () => {} },
      recordUsage: () => {},
      progress: () => {},
      emitNextStepEvent: async () => {},
      parentRunId: null,
    };
    await exec(
      {
        mode: 'guest_post',
        siteId: FAKE_SITE.id,
        targetDomain: 'austinhomesblog.com',
        targetEditorEmail: 'editor@austinhomesblog.com',
        pitchTopic: 'slab leaks in older Austin homes',
      },
      c,
    );

    // Verify the prompt that was sent to Claude carries the new constraints —
    // the parser depends on the JSON contract, and the prompt must continue
    // to demand it.
    const callArgs = fakeAnthropic.messages.create.mock.calls[0] as unknown as [
      { messages: { content: string }[] },
    ];
    const promptArg = callArgs[0].messages[0]!.content;
    expect(promptArg).toMatch(/Return strictly JSON/);
    expect(promptArg).toMatch(/35.{0,3}60 characters/);
    expect(promptArg).toMatch(/exactly two article angles/i);
    expect(promptArg).toMatch(/Reply with REMOVE/);
    // Prompt should forbid the literal phrase "guest post" in subject lines.
    expect(promptArg).toMatch(/Do not use the literal phrase "guest post"/);

    // Now verify the recorded response (treated as a representative model
    // output) round-trips through the parser and lands on the backlink row
    // with the expected shape.
    const inserted = insertCalls.find((ic) => ic.table === 'backlinks');
    expect(inserted).toBeDefined();
    const subject = inserted!.values.subjectLine as string;
    const body = inserted!.values.pitchDraft as string;

    expect(subject.length).toBeLessThanOrEqual(60);
    expect(subject.length).toBeGreaterThanOrEqual(20);
    expect(subject.toLowerCase()).not.toContain('guest post');
    expect(subject).not.toContain('austinhomesblog.com');

    // Body word count in the prompt's stated range (allow slack on either side).
    const wordCount = body.trim().split(/\s+/).length;
    expect(wordCount).toBeGreaterThanOrEqual(80);
    expect(wordCount).toBeLessThanOrEqual(180);

    // CAN-SPAM compliance lines.
    expect(body).toContain("Reply with REMOVE if you'd rather not hear from me again.");
    expect(body).toMatch(/LeadLandlord,.*Austin, TX/);

    // Two enumerated, concrete angles (each starts with "1)" / "2)").
    expect(body).toMatch(/(^|\n)1\)/);
    expect(body).toMatch(/(^|\n)2\)/);

    // Sign-off.
    expect(body).toMatch(/—\s*plumbing team in Austin/);

    // Boilerplate openers we explicitly told the model not to use.
    expect(body).not.toMatch(/I hope this email finds you well/i);
    expect(body).not.toMatch(/^I run a plumbing business in Austin/m);
  });

  it('guest_post throws when Claude response is not valid JSON', async () => {
    process.env.RESEND_FROM_ADDRESS = 'sender@example.com';
    fakeAnthropic.messages.create.mockResolvedValueOnce({
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'sorry, I cannot do that' }],
    } as never);

    const { BacklinkBuilder } = await import('./index');
    const agent = new BacklinkBuilder();
    const exec = (
      agent as unknown as { execute: (i: unknown, ctx: unknown) => Promise<unknown> }
    ).execute.bind(agent);
    const c = {
      runId: 'run-gp-bad-json',
      log: { info: () => {}, warn: () => {}, error: () => {} },
      recordUsage: () => {},
      progress: () => {},
      emitNextStepEvent: async () => {},
      parentRunId: null,
    };

    await expect(
      exec(
        {
          mode: 'guest_post',
          siteId: FAKE_SITE.id,
          targetDomain: 'example.com',
          targetEditorEmail: 'editor@example.com',
          pitchTopic: 'home maintenance',
        },
        c,
      ),
    ).rejects.toThrow(/not valid JSON/);
    expect(sendEmailResendMock).not.toHaveBeenCalled();
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
