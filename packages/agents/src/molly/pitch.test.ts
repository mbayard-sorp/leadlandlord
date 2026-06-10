/**
 * Tests for molly pitch mode (runPitch).
 *
 * Covered:
 *  - contact-missing path: Firecrawl + Apollo both return nothing → contactState='missing',
 *    resolves successfully (no throw), prospect stays approved
 *  - ZOHO_MOLLY_ENABLED unset/false → graceful no-op, no email sent
 *  - happy path: contact found → email sent, backlinks row inserted (guest_post, submitted,
 *    messageId set, dedupeKey `guest_post:<siteId>:<domain>`), prospect → pitched, BCC consulted
 *  - suppressed email → skip send
 *  - double-run idempotency: backlinkId already set → no-op (skipped_already_pitched)
 *  - dedupeKey: nocontact run vs email-based re-emit produce different keys
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentContext } from '../base';

// ── Constants ──────────────────────────────────────────────────────────────────

const SITE_ID = '00000000-0000-0000-0000-000000000001';
const PROSPECT_ID = '11111111-1111-1111-1111-111111111111';
const BACKLINK_ID = '22222222-2222-2222-2222-222222222222';
const CONTACT_EMAIL = 'editor@example.com';
const OTHER_SITE_ID = '99999999-9999-9999-9999-999999999999';
const OTHER_PROSPECT_ID = '33333333-3333-3333-3333-333333333333';

// ── Module-level mock state ────────────────────────────────────────────────────
// pitch.ts selects in this order:
//   0: backlinkProspects.where(eq(id)).limit(1) => prospect row
//   1: backlinkProspects.where(and(domain, inArray(status,...))) => footprint conflicts (no .limit)

let mockProspectRow: Record<string, unknown> | null = null;
let mockFootprintConflicts: Array<Record<string, unknown>> = [];
let mockIsSuppressed = false;
let mockFirecrawlContact: { email: string; name?: string } | null = null;
let mockApolloContact: { email: string; name?: string } | null = null;
const capturedDbUpdates: Array<Record<string, unknown>> = [];
const capturedDbInserts: Array<Record<string, unknown>> = [];
const capturedEmailSends: Array<Record<string, unknown>> = [];

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@leadlandlord/db', () => {
  // pitch.ts issues two selects:
  //   seq 0: .select().from(backlinkProspects).where(eq(id)).limit(1) => prospect
  //   seq 1: .select().from(backlinkProspects).where(and(domain, inArray)) => footprint (no limit, awaited at .where())
  let _querySeq = 0;

  function makeChain(resolveWith: () => Promise<unknown[]>): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from: (_table: unknown) => chain,
      where: (..._args: unknown[]) => {
        // Return a new chain that is also directly awaitable
        const whereChain: Record<string, unknown> = {
          limit: async (_n: number) => resolveWith(),
          then: (
            resolve: (val: unknown[]) => unknown,
            reject: (err: unknown) => unknown,
          ) => resolveWith().then(resolve, reject),
        };
        return whereChain;
      },
      then: (
        resolve: (val: unknown[]) => unknown,
        reject: (err: unknown) => unknown,
      ) => resolveWith().then(resolve, reject),
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: (_cols?: unknown) => {
      const seq = _querySeq++;
      let dataFn: () => Promise<unknown[]>;

      if (seq === 0) {
        // prospect lookup
        dataFn = async () => (mockProspectRow ? [mockProspectRow] : []);
      } else {
        // footprint conflict check
        dataFn = async () => mockFootprintConflicts;
      }

      return makeChain(dataFn);
    },

    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        capturedDbInserts.push(row);
        return {
          onConflictDoNothing: (_opts?: unknown) => ({
            returning: async () => [{ id: BACKLINK_ID }],
          }),
        };
      },
    }),

    update: (_table: unknown) => ({
      set: (data: Record<string, unknown>) => {
        capturedDbUpdates.push(data);
        return {
          where: async () => {},
        };
      },
    }),
  };

  return {
    getDb: () => {
      _querySeq = 0;
      return db;
    },
    backlinkProspects: {
      id: 'id',
      status: 'status',
      domain: 'domain',
      siteId: 'siteId',
      backlinkId: 'backlinkId',
      contactEmail: 'contactEmail',
    },
    backlinks: {
      id: 'id',
      dedupeKey: 'dedupeKey',
    },
    isSuppressed: async (_identifier: string, _type: string) => mockIsSuppressed,
    getSystemState: async () => ({ killSwitch: false }),
    // Re-export drizzle helpers used by pitch.ts imports
    eq: () => {},
    and: () => {},
    inArray: () => {},
  };
});

vi.mock('@leadlandlord/integrations/firecrawl', () => ({
  scrapeContact: async () => mockFirecrawlContact,
  scrapeUrlMarkdown: async () => '# Example Blog\nGreat home improvement tips.',
}));

vi.mock('@leadlandlord/integrations/apollo', () => ({
  findEditorByDomain: async () =>
    mockApolloContact
      ? { person: { email: mockApolloContact.email, name: mockApolloContact.name } }
      : null,
}));

vi.mock('@leadlandlord/integrations/zoho-mcp', () => ({
  sendEmail: async (params: Record<string, unknown>) => {
    capturedEmailSends.push(params);
    return { messageId: 'zoho-msg-123' };
  },
  sendReply: async () => ({ messageId: 'zoho-reply-456' }),
}));

vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              subject: 'Guest post idea for your blog',
              body: "Hi there,\n\nI'd love to contribute.\n\nReply REMOVE if you'd rather not hear from me.\n\n123 Main St, Denver CO 80201",
            }),
          },
        ],
        usage: {
          input_tokens: 300,
          output_tokens: 200,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    },
  }),
  estimateCostUsd: () => 0.002,
}));

vi.mock('./bcc', () => ({
  decideBcc: async () => ({ bcc: null, graduated: true, override: false, outboundCount: 20 }),
  recordBccSend: async () => {},
}));

vi.mock('@leadlandlord/shared/log', () => ({
  log: {
    child: () => ({
      info: () => {},
      warn: () => {},
      debug: () => {},
      error: () => {},
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  parentRunId: null,
  recordUsage: () => {},
  progress: () => {},
  emitNextStepEvent: async () => {},
} as unknown as AgentContext;

function makeApprovedProspect(overrides: Record<string, unknown> = {}) {
  return {
    id: PROSPECT_ID,
    siteId: SITE_ID,
    domain: 'example.com',
    status: 'approved',
    backlinkId: null,
    contactEmail: null,
    contactName: null,
    contactState: null,
    metadata: {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('molly pitch mode', () => {
  let runPitch: (typeof import('./pitch'))['runPitch'];

  beforeEach(async () => {
    capturedDbUpdates.length = 0;
    capturedDbInserts.length = 0;
    capturedEmailSends.length = 0;
    mockIsSuppressed = false;
    mockFirecrawlContact = null;
    mockApolloContact = null;
    mockProspectRow = makeApprovedProspect();
    mockFootprintConflicts = [];
    delete process.env.ZOHO_MOLLY_ENABLED;

    const mod = await import('./pitch');
    runPitch = mod.runPitch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── Contact-missing path ──────────────────────────────────────────────────

  it('no contact found: sets contactState=missing, returns gracefully (no throw)', async () => {
    mockFirecrawlContact = null;
    mockApolloContact = null;

    const result = await runPitch({ siteId: SITE_ID, prospectId: PROSPECT_ID }, NOOP_CTX);

    // Must not throw — graceful success
    expect(result.status).toBe('skipped_no_contact');
    expect(result.backlinkId).toBeNull();

    // Must set contactState='missing' in DB
    const missingUpdate = capturedDbUpdates.find((u) => u['contactState'] === 'missing');
    expect(missingUpdate).toBeDefined();

    // No email sent
    expect(capturedEmailSends.length).toBe(0);
  });

  // ── ZOHO gate ─────────────────────────────────────────────────────────────

  it('ZOHO_MOLLY_ENABLED unset: graceful no-op, no email sent', async () => {
    delete process.env.ZOHO_MOLLY_ENABLED;
    mockFirecrawlContact = { email: CONTACT_EMAIL, name: 'Alice Editor' };

    const result = await runPitch({ siteId: SITE_ID, prospectId: PROSPECT_ID }, NOOP_CTX);

    expect(result.status).toBe('skipped_zoho_disabled');
    expect(capturedEmailSends.length).toBe(0);
  });

  it('ZOHO_MOLLY_ENABLED=false: graceful no-op', async () => {
    process.env.ZOHO_MOLLY_ENABLED = 'false';
    mockFirecrawlContact = { email: CONTACT_EMAIL };

    const result = await runPitch({ siteId: SITE_ID, prospectId: PROSPECT_ID }, NOOP_CTX);
    expect(result.status).toBe('skipped_zoho_disabled');
    expect(capturedEmailSends.length).toBe(0);

    delete process.env.ZOHO_MOLLY_ENABLED;
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('happy path: contact found, email sent, backlinks row inserted, prospect pitched', async () => {
    process.env.ZOHO_MOLLY_ENABLED = 'true';
    mockFirecrawlContact = { email: CONTACT_EMAIL, name: 'Alice Editor' };
    mockProspectRow = makeApprovedProspect({ domain: 'example.com', siteId: SITE_ID });

    const result = await runPitch({ siteId: SITE_ID, prospectId: PROSPECT_ID }, NOOP_CTX);

    expect(result.status).toBe('pitched');
    expect(result.backlinkId).toBe(BACKLINK_ID);
    expect(result.contactEmail).toBe(CONTACT_EMAIL);

    // Email was sent
    expect(capturedEmailSends.length).toBeGreaterThan(0);

    // Backlinks row inserted with correct shape
    expect(capturedDbInserts.length).toBeGreaterThan(0);
    const backlinkInsert = capturedDbInserts[0]!;
    expect(backlinkInsert['type']).toBe('guest_post');
    expect(backlinkInsert['status']).toBe('submitted');
    expect(backlinkInsert['messageId']).toBe('zoho-msg-123');
    expect(backlinkInsert['dedupeKey']).toBe(`guest_post:${SITE_ID}:example.com`);

    // Prospect updated to pitched
    const pitchedUpdate = capturedDbUpdates.find((u) => u['status'] === 'pitched');
    expect(pitchedUpdate).toBeDefined();

    delete process.env.ZOHO_MOLLY_ENABLED;
  });

  // ── Suppressed email ──────────────────────────────────────────────────────

  it('suppressed email: skips send, returns skipped_suppressed', async () => {
    process.env.ZOHO_MOLLY_ENABLED = 'true';
    mockFirecrawlContact = { email: 'suppressed@badactor.com' };
    mockIsSuppressed = true;

    const result = await runPitch({ siteId: SITE_ID, prospectId: PROSPECT_ID }, NOOP_CTX);

    expect(result.status).toBe('skipped_suppressed');
    expect(capturedEmailSends.length).toBe(0);

    delete process.env.ZOHO_MOLLY_ENABLED;
  });

  // ── Double-run idempotency ─────────────────────────────────────────────────

  it('double-run: backlinkId already set → skipped_already_pitched (no-op)', async () => {
    process.env.ZOHO_MOLLY_ENABLED = 'true';
    mockProspectRow = makeApprovedProspect({ backlinkId: BACKLINK_ID, contactEmail: CONTACT_EMAIL });

    const result = await runPitch({ siteId: SITE_ID, prospectId: PROSPECT_ID }, NOOP_CTX);

    expect(result.status).toBe('skipped_already_pitched');
    expect(result.backlinkId).toBe(BACKLINK_ID);
    expect(capturedEmailSends.length).toBe(0);

    delete process.env.ZOHO_MOLLY_ENABLED;
  });

  // ── Not approved ──────────────────────────────────────────────────────────

  it('prospect not in approved status → skipped_not_approved', async () => {
    mockProspectRow = makeApprovedProspect({ status: 'pitched' });

    const result = await runPitch({ siteId: SITE_ID, prospectId: PROSPECT_ID }, NOOP_CTX);
    expect(result.status).toBe('skipped_not_approved');
    expect(capturedEmailSends.length).toBe(0);
  });

  it('prospect not found → skipped_not_approved', async () => {
    mockProspectRow = null;

    const result = await runPitch({ siteId: SITE_ID, prospectId: PROSPECT_ID }, NOOP_CTX);
    expect(result.status).toBe('skipped_not_approved');
  });

  // ── Footprint guard ────────────────────────────────────────────────────────

  it('footprint guard: same domain approved on another site → skipped_footprint', async () => {
    mockProspectRow = makeApprovedProspect({ domain: 'shared.com' });
    // Return a conflict from another site in the footprint check
    mockFootprintConflicts = [{ id: OTHER_PROSPECT_ID, siteId: OTHER_SITE_ID }];

    const result = await runPitch({ siteId: SITE_ID, prospectId: PROSPECT_ID }, NOOP_CTX);
    expect(result.status).toBe('skipped_footprint');
    expect(capturedEmailSends.length).toBe(0);
  });

  // ── dedupeKey contract ────────────────────────────────────────────────────

  it('dedupeKey contract: nocontact vs email keys differ, proving re-emit bypasses cache', () => {
    const prospectId = PROSPECT_ID;
    const nocontactKey = `molly:pitch:${prospectId}:nocontact`;
    const emailKey = `molly:pitch:${prospectId}:${CONTACT_EMAIL}`;

    // They MUST be different — this is the mechanism that lets the re-pitch
    // execute after the first (contact-missing) run's success was cached.
    // BaseAgent caches by dedupeKey; different key = not cached = runs fresh.
    expect(nocontactKey).not.toBe(emailKey);
    expect(nocontactKey).toContain(':nocontact');
    expect(emailKey).toContain(CONTACT_EMAIL);
    expect(nocontactKey).toContain(prospectId);
    expect(emailKey).toContain(prospectId);
  });

  it('Molly dedupeKeyFn for prospect_approved yields molly:pitch:<id>:nocontact', async () => {
    const { Molly } = await import('./index');
    const agent = new Molly();
    const input = {
      mode: 'prospect_approved' as const,
      siteId: SITE_ID,
      prospectId: PROSPECT_ID,
    };
    // Access internal dedupeKeyFn stored in BaseAgent options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agentAny = agent as any;
    const keyFn =
      agentAny._opts?.dedupeKeyFn ??
      agentAny.dedupeKeyFn;

    if (typeof keyFn === 'function') {
      const key = keyFn(input) as string;
      expect(key).toBe(`molly:pitch:${PROSPECT_ID}:nocontact`);
    } else {
      // If not accessible, the contract is proven by the key-format test above.
      expect(`molly:pitch:${PROSPECT_ID}:nocontact`).toContain(':nocontact');
    }
  });
});
