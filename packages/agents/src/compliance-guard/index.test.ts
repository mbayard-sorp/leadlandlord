import { describe, expect, it, vi } from 'vitest';

// Mock @leadlandlord/db/suppression so we don't need a real DB. All Phase E
// scopes are pure-text checks anyway — only the existing outreach scopes hit
// suppression.
vi.mock('@leadlandlord/db/suppression', () => ({
  isSuppressed: async () => false,
}));

import { ComplianceGuard } from './index';

// Pull the protected execute() out so we can drive it without spinning up
// BaseAgent.run() (which would need the db + agent_runs row). Same pattern as
// lighthouse-audit/index.test.ts.
type Exec = (
  input: {
    scope: string;
    text: string;
    recipient?: string;
    metadata?: Record<string, unknown>;
  },
  ctx: { log: { info: () => void; warn: () => void; error: () => void } },
) => Promise<{ ok: boolean; violations: Array<{ rule: string; severity: string; details?: string[] }> }>;

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

function run(input: Parameters<Exec>[0]) {
  const agent = new ComplianceGuard();
  const exec = (agent as unknown as { execute: Exec }).execute.bind(agent);
  return exec(input, { log: noopLog });
}

describe('compliance-guard: voice_transcript', () => {
  it('blocks when first 10s lacks AI disclosure', async () => {
    const result = await run({
      scope: 'voice_transcript',
      text: 'Hi, this is Sarah from ABC Plumbing — got a minute to talk about your drain?',
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === 'tcpa_no_ai_disclosure')).toBe(true);
  });

  it('warns nothing when AI disclosure is present in first window', async () => {
    const result = await run({
      scope: 'voice_transcript',
      text: 'Hi, this is an AI assistant calling on behalf of ABC Plumbing. Got a minute?',
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('respects metadata.firstSeconds when caller passes timestamped window', async () => {
    const result = await run({
      scope: 'voice_transcript',
      text: 'rest of transcript without disclosure',
      metadata: { firstSeconds: 'I am an automated assistant calling about your appointment.' },
    });
    expect(result.ok).toBe(true);
  });
});

describe('compliance-guard: outreach_email scope (Phase E body checks)', () => {
  it('blocks when unsubscribe is missing', async () => {
    const result = await run({
      scope: 'outreach_email',
      text: 'Hi there — quick question about your roofing business. 90210',
      recipient: 'owner@example.com',
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === 'can_spam_no_unsubscribe')).toBe(true);
  });

  it('warns (not blocks) when zip is missing but unsubscribe present', async () => {
    const result = await run({
      scope: 'outreach_email',
      text: 'Hi — interested in your services. Reply STOP to unsubscribe.',
      recipient: 'owner@example.com',
    });
    expect(result.ok).toBe(true);
    expect(result.violations.some((v) => v.rule === 'can_spam_no_address' && v.severity === 'warning')).toBe(true);
  });

  it('passes when unsubscribe + physical address are both present', async () => {
    const result = await run({
      scope: 'outreach_email',
      text: 'Hi! Reply unsubscribe to opt out. Sent from 123 Main St, Tucson, AZ 85701.',
      recipient: 'owner@example.com',
    });
    expect(result.ok).toBe(true);
    expect(result.violations.filter((v) => v.severity === 'blocker')).toHaveLength(0);
  });
});

describe('compliance-guard: site_publish', () => {
  it('blocks fabricated #1-in-city and award claims without citations', async () => {
    const result = await run({
      scope: 'site_publish',
      text: '# Welcome\n\nWe are #1 in Tucson and an award-winning plumbing company.\n',
    });
    expect(result.ok).toBe(false);
    const rules = result.violations.map((v) => v.rule);
    expect(rules).toContain('fabricated_rank');
    expect(rules).toContain('fabricated_award');
  });

  it('blocks license number without state qualifier', async () => {
    const result = await run({
      scope: 'site_publish',
      text: 'Trusted local pro since 1999. License #ROC-12345.\n',
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === 'fabricated_license')).toBe(true);
  });

  it('passes clean MDX with no fabrications', async () => {
    const result = await run({
      scope: 'site_publish',
      text: '# Tree Removal in Tucson\n\nSame-day service, free quotes, family-owned since 1999.\n',
    });
    expect(result.ok).toBe(true);
    expect(result.violations.filter((v) => v.severity === 'blocker')).toHaveLength(0);
  });

  it('downgrades to warning when allowSoftClaims is set', async () => {
    const result = await run({
      scope: 'site_publish',
      text: 'We are an award-winning plumbing company in Tucson.\n',
      metadata: { allowSoftClaims: true },
    });
    expect(result.ok).toBe(true); // no blockers
    expect(result.violations.some((v) => v.severity === 'warning')).toBe(true);
  });
});
