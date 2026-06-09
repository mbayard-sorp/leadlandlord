import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ORCHESTRATOR_TOOLS,
  getOrchestratorTool,
  orchestratorAnthropicTools,
  isProtectedEventType,
  resolveQuestionRecipient,
  buildQuestionDeepLink,
  renderQuestionEmail,
  SELF_PROTECTED_AGENTS,
} from './tools';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

// The exact allowlist. Read tools are observation-only; write tools are the
// only mutating surface. There is NO tool that approves a niche, creates a
// site, or takes a site live — this set IS the code-layer hard-constraint.
const EXPECTED_READ = [
  'get_fleet_status',
  'get_agent_detail',
  'get_recent_runs',
  'get_budget_status',
  'get_queue_state',
  'get_schedules',
];
const EXPECTED_WRITE = [
  'enable_agent',
  'disable_agent',
  'set_agent_cap',
  'set_agent_cadence',
  'set_global_cap',
  'requeue_dead_letter',
  'raise_question_to_human',
];

describe('orchestrator tool allowlist (hard-constraint boundary)', () => {
  it('exposes exactly the allowlisted tools — no more, no less', () => {
    const names = ORCHESTRATOR_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_READ, ...EXPECTED_WRITE].sort());
  });

  it('has no tool that approves a niche, creates a site, or takes a site live', () => {
    const FORBIDDEN_NAME = /(approve_niche|create_site|build_site|promote|go_?live|publish_site|upsert_site)/i;
    for (const t of ORCHESTRATOR_TOOLS) {
      expect(t.name).not.toMatch(FORBIDDEN_NAME);
    }
  });

  it('write tools are tagged write; read tools tagged read', () => {
    for (const name of EXPECTED_WRITE) expect(getOrchestratorTool(name)?.kind).toBe('write');
    for (const name of EXPECTED_READ) expect(getOrchestratorTool(name)?.kind).toBe('read');
  });

  it('every tool carries an Anthropic-shaped schema', () => {
    const tools = orchestratorAnthropicTools();
    expect(tools.length).toBe(ORCHESTRATOR_TOOLS.length);
    for (const t of tools) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.input_schema).toHaveProperty('type', 'object');
    }
  });

  it('no orchestrator source imports a human-only site-lifecycle action', () => {
    // Belt-and-suspenders beyond __tests__/human-only-gates.test.ts: also ban
    // the site-creation / niche-approval helper symbols, scoped to this module.
    const FORBIDDEN = ['approveNiche', 'promoteSiteToLive', 'upsertSite', 'findSiteForNiche'];
    const offenders: Array<{ file: string; symbol: string }> = [];
    for (const entry of readdirSync(MODULE_DIR)) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
      const text = readFileSync(path.join(MODULE_DIR, entry), 'utf8');
      for (const sym of FORBIDDEN) if (text.includes(sym)) offenders.push({ file: entry, symbol: sym });
    }
    expect(offenders).toEqual([]);
  });
});

describe('disable_agent self-protection', () => {
  it('protects operator / orchestrator / fleet-digest', () => {
    expect([...SELF_PROTECTED_AGENTS].sort()).toEqual(
      ['fleet-digest', 'operator', 'orchestrator'].sort(),
    );
  });

  it('refuses to disable a protected agent (no DB touched)', async () => {
    const tool = getOrchestratorTool('disable_agent')!;
    for (const agent of SELF_PROTECTED_AGENTS) {
      const out = (await tool.execute(
        { agent, reason: 'test' },
        { threadId: 't', env: {} },
      )) as { error?: string };
      expect(out.error).toMatch(/refusing to disable/);
    }
  });
});

describe('isProtectedEventType (requeue guard)', () => {
  it('blocks the niche / site / domain-approval chain', () => {
    for (const t of [
      'niche.approved',
      'niche.run',
      'site.deployed',
      'site.activated',
      'sites.created',
      'domain.approval.granted',
    ]) {
      expect(isProtectedEventType(t)).toBe(true);
    }
  });

  it('allows ordinary operational events', () => {
    for (const t of [
      'seo.ingest.gsc',
      'lighthouse.run',
      'maintenance.reap',
      'call.classify',
      'network.metrics.aggregate',
      'content.idea.proposed',
    ]) {
      expect(isProtectedEventType(t)).toBe(false);
    }
  });
});

describe('resolveQuestionRecipient (skip mirrors fleet-digest)', () => {
  it('skips (null) without RESEND_API_KEY', () => {
    expect(resolveQuestionRecipient({ OPERATOR_EMAIL: 'mike@x.com' })).toBeNull();
  });
  it('skips (null) without a recipient', () => {
    expect(resolveQuestionRecipient({ RESEND_API_KEY: 're_x' })).toBeNull();
  });
  it('defaults from to Molly and uses ORCHESTRATOR_QUESTION_TO', () => {
    const r = resolveQuestionRecipient({ RESEND_API_KEY: 're_x', ORCHESTRATOR_QUESTION_TO: 'mike@me.com' });
    expect(r?.to).toBe('mike@me.com');
    expect(r?.from).toMatch(/molly@leadslandlord\.com/);
  });
  it('falls back to OPERATOR_EMAIL and honors ORCHESTRATOR_QUESTION_FROM', () => {
    const r = resolveQuestionRecipient({
      RESEND_API_KEY: 're_x',
      OPERATOR_EMAIL: 'ops@me.com',
      ORCHESTRATOR_QUESTION_FROM: 'Ops <ops@leadslandlord.com>',
    });
    expect(r?.to).toBe('ops@me.com');
    expect(r?.from).toBe('Ops <ops@leadslandlord.com>');
  });
});

describe('buildQuestionDeepLink', () => {
  it('joins a configured base with the thread path', () => {
    expect(buildQuestionDeepLink('t1', { OPERATOR_BASE_URL: 'https://ops.example.com' })).toBe(
      'https://ops.example.com/operator/orchestrator?thread=t1',
    );
  });
  it('strips a trailing slash and falls back to BASE_URL', () => {
    expect(buildQuestionDeepLink('t2', { BASE_URL: 'https://b.example.com/' })).toBe(
      'https://b.example.com/operator/orchestrator?thread=t2',
    );
  });
  it('returns a relative path when no base is set', () => {
    expect(buildQuestionDeepLink('t3', {})).toBe('/operator/orchestrator?thread=t3');
  });
});

describe('renderQuestionEmail', () => {
  it('prefixes the subject, includes the link, and escapes HTML', () => {
    const out = renderQuestionEmail({
      title: 'Auto-disabled x',
      question: 'Re-enable <competitor-analyzer> & retry?',
      link: 'https://ops.example.com/operator/orchestrator?thread=t1',
    });
    expect(out.subject).toBe('[Orchestrator] Auto-disabled x');
    expect(out.text).toContain('https://ops.example.com/operator/orchestrator?thread=t1');
    expect(out.html).not.toContain('<competitor-analyzer>');
    expect(out.html).toContain('&lt;competitor-analyzer&gt;');
    expect(out.html).toContain('href="https://ops.example.com/operator/orchestrator?thread=t1"');
  });
});
