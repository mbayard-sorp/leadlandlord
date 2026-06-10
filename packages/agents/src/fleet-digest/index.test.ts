import { describe, it, expect } from 'vitest';
import {
  FleetDigestOutput,
  computeNeedsAttention,
  renderFleetDigest,
  resolveDigestRecipient,
  type FleetDigestData,
} from './index';

function data(partial: Partial<FleetDigestData> = {}): FleetDigestData {
  return {
    date: '2026-06-09',
    windowHours: 24,
    activity: [],
    globalSpentUsd: 0,
    globalCapUsd: 40,
    budgets: [],
    deadLettered: 0,
    needsCreds: [],
    notImplemented: [],
    failing: [],
    autoDisabled: [],
    pendingNiches: 0,
    sitesAwaitingGoLive: 0,
    openQuestions: 0,
    ...partial,
  };
}

describe('computeNeedsAttention', () => {
  it('is empty when all clear', () => {
    expect(computeNeedsAttention(data())).toEqual([]);
  });

  it('lists a pending niche + a needs_creds agent (acceptance scenario)', () => {
    const items = computeNeedsAttention(
      data({ pendingNiches: 2, needsCreds: ['outreach-agent', 'billing-dunning'] }),
    );
    expect(items.some((i) => /2 niche\(s\) awaiting your approval/.test(i))).toBe(true);
    expect(items.some((i) => /blocked on credentials.*outreach-agent/.test(i))).toBe(true);
  });

  it('flags over- and near-budget agents and the global cap', () => {
    const items = computeNeedsAttention(
      data({
        budgets: [
          { agent: 'content-engine', spentUsd: 8, capUsd: 8 }, // over
          { agent: 'seo-operator', spentUsd: 3.5, capUsd: 4 }, // near (>=80%)
          { agent: 'maintenance', spentUsd: 0.1, capUsd: 2 }, // fine
        ],
        globalSpentUsd: 40,
        globalCapUsd: 40,
      }),
    );
    expect(items.some((i) => /over daily cap: content-engine/.test(i))).toBe(true);
    expect(items.some((i) => /near daily cap: seo-operator/.test(i))).toBe(true);
    expect(items.some((i) => /Portfolio daily cap reached/.test(i))).toBe(true);
  });

  it('flags auto-disabled agents, dead-letters, and sites awaiting go-live', () => {
    const items = computeNeedsAttention(
      data({ autoDisabled: ['competitor-analyzer'], deadLettered: 3, sitesAwaitingGoLive: 1 }),
    );
    expect(items.some((i) => /auto-disabled: competitor-analyzer/.test(i))).toBe(true);
    expect(items.some((i) => /3 event\(s\) dead-lettered/.test(i))).toBe(true);
    expect(items.some((i) => /1 site\(s\) built and awaiting go-live/.test(i))).toBe(true);
  });
});

describe('renderFleetDigest', () => {
  it('renders every section and a valid output subject', () => {
    const rendered = renderFleetDigest(
      data({
        pendingNiches: 1,
        needsCreds: ['outreach-agent'],
        activity: [{ agent: 'content-engine', succeeded: 4, failed: 1, costUsd: 2.5 }],
        globalSpentUsd: 5.25,
        failing: [{ agent: 'lighthouse-audit', consecutiveFailures: 2, lastError: 'PageSpeed 500' }],
      }),
    );
    expect(rendered.subject).toContain('2026-06-09');
    expect(rendered.subject).toMatch(/need attention/);
    for (const section of ['Needs your attention', 'Spend', 'Fleet activity', 'Health']) {
      expect(rendered.html).toContain(section);
    }
    expect(rendered.text).toContain('NEEDS YOUR ATTENTION');
    expect(rendered.text).toContain('content-engine');
    expect(rendered.text).toContain('lighthouse-audit');
  });

  it('says "all clear" when nothing needs attention', () => {
    expect(renderFleetDigest(data()).subject).toMatch(/all clear/);
  });

  it('escapes HTML in agent-derived strings', () => {
    const rendered = renderFleetDigest(data({ needsCreds: ['<script>'] }));
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });
});

describe('resolveDigestRecipient (send skip mirrors notifyOperatorEmail)', () => {
  const mcpEnv = { ZOHO_MCP_URL: 'https://mcp.zoho.example/abc', ZOHO_ACCOUNT_ID: '12345' };

  it('skips (null) when ZOHO_MCP_URL is missing', () => {
    expect(
      resolveDigestRecipient({ ZOHO_ACCOUNT_ID: '12345', OPERATOR_EMAIL: 'mike@x.com' }),
    ).toBeNull();
  });
  it('skips (null) when ZOHO_ACCOUNT_ID is missing', () => {
    expect(
      resolveDigestRecipient({ ZOHO_MCP_URL: 'https://mcp.zoho.example/abc', OPERATOR_EMAIL: 'mike@x.com' }),
    ).toBeNull();
  });
  it('skips (null) when no recipient is set', () => {
    expect(resolveDigestRecipient(mcpEnv)).toBeNull();
  });
  it('defaults from to Molly mailbox and uses FLEET_DIGEST_TO', () => {
    const r = resolveDigestRecipient({
      ...mcpEnv,
      ZOHO_MOLLY_FROM: 'molly@leadslandlord.com',
      FLEET_DIGEST_TO: 'mike@me.com',
    });
    expect(r).not.toBeNull();
    expect(r!.to).toBe('mike@me.com');
    expect(r!.from).toBe('molly@leadslandlord.com');
  });
  it('falls back from ZOHO_MOLLY_FROM to ZOHO_DEFAULT_FROM', () => {
    const r = resolveDigestRecipient({
      ...mcpEnv,
      ZOHO_DEFAULT_FROM: 'hello@leadslandlord.com',
      OPERATOR_EMAIL: 'mike@x.com',
    });
    expect(r!.from).toBe('hello@leadslandlord.com');
  });
  it('falls back to OPERATOR_EMAIL and honors FLEET_DIGEST_FROM', () => {
    const r = resolveDigestRecipient({
      ...mcpEnv,
      OPERATOR_EMAIL: 'ops@me.com',
      FLEET_DIGEST_FROM: 'ops@leadslandlord.com',
    });
    expect(r!.to).toBe('ops@me.com');
    expect(r!.from).toBe('ops@leadslandlord.com');
  });
});

describe('FleetDigestOutput schema', () => {
  it('accepts a well-formed output', () => {
    expect(() =>
      FleetDigestOutput.parse({ date: '2026-06-09', delivery: 'skipped', needsAttentionCount: 0, subject: 's' }),
    ).not.toThrow();
  });
  it('rejects an unknown delivery value', () => {
    expect(() =>
      FleetDigestOutput.parse({ date: 'x', delivery: 'mailed', needsAttentionCount: 0, subject: 's' }),
    ).toThrow();
  });
});
