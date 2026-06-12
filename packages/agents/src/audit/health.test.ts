import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../registry';
import {
  AGENT_REQUIRED_ENV,
  DEFERRED_STUBS,
  buildAuditRows,
  summarizeAudit,
  summarizeRunHistory,
  type AgentHealthRow,
  type RunRecord,
} from './health';

const NOW = new Date('2026-06-08T12:00:00Z');
const REGISTRY_KEYS = Object.keys(agentRegistry);

function rowFor(rows: AgentHealthRow[], agent: string): AgentHealthRow {
  const row = rows.find((r) => r.agent === agent);
  if (!row) throw new Error(`no row for ${agent}`);
  return row;
}

describe('AGENT_REQUIRED_ENV ↔ registry sync', () => {
  it('has exactly one entry per registry key (no missing, no extras)', () => {
    const mapKeys = new Set(Object.keys(AGENT_REQUIRED_ENV));
    const regKeys = new Set(REGISTRY_KEYS);
    const missing = [...regKeys].filter((k) => !mapKeys.has(k));
    const extra = [...mapKeys].filter((k) => !regKeys.has(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
});

describe('buildAuditRows', () => {
  it('emits one row per registry key plus one per deferred stub', () => {
    const rows = buildAuditRows({ registryKeys: REGISTRY_KEYS, env: {}, now: NOW });
    expect(rows).toHaveLength(REGISTRY_KEYS.length + DEFERRED_STUBS.length);
    // No duplicates.
    expect(new Set(rows.map((r) => r.agent)).size).toBe(rows.length);
  });

  it('owned-asset agents pass with no env', () => {
    const rows = buildAuditRows({ registryKeys: REGISTRY_KEYS, env: {}, now: NOW });
    for (const agent of ['operator', 'content-engine', 'network-metrics-aggregator', 'geo-aeo-auditor']) {
      expect(rowFor(rows, agent).auditStatus).toBe('pass');
    }
  });

  it('flags the known credential-blocked agents as needs_creds (empty env)', () => {
    const rows = buildAuditRows({ registryKeys: REGISTRY_KEYS, env: {}, now: NOW });
    for (const agent of [
      'keyword-planner',
      'competitor-analyzer',
      'tenant-prospector',
      'billing-dunning',
      'outreach-agent',
      'niche-scout',
      'niche-validator',
      'niche-keyword-refresher',
      'local-content-scout',
    ]) {
      expect(rowFor(rows, agent).auditStatus).toBe('needs_creds');
    }
    expect(rowFor(rows, 'billing-dunning').requiredEnv).toContain('STRIPE_SECRET_KEY');
    expect(rowFor(rows, 'outreach-agent').requiredEnv).toContain('TWILIO_FROM_NUMBER');
    expect(rowFor(rows, 'outreach-agent').requiredEnv).toContain('RESEND_FROM_ADDRESS');
    expect(rowFor(rows, 'keyword-planner').notes).toMatch(/DATAFORSEO_AUTH/);
  });

  it('marks deferred stubs not_implemented', () => {
    const rows = buildAuditRows({ registryKeys: REGISTRY_KEYS, env: {}, now: NOW });
    for (const agent of DEFERRED_STUBS) {
      expect(rowFor(rows, agent).auditStatus).toBe('not_implemented');
    }
  });

  it('treats any-of credential alternatives as satisfied', () => {
    const rows = buildAuditRows({
      registryKeys: REGISTRY_KEYS,
      env: {
        STRIPE_SECRET_KEY_TEST: 'sk_test_x', // closer-agent alt for STRIPE_SECRET_KEY
        GOOGLE_SERVICE_ACCOUNT_KEY_PATH: '/keys/svc.json', // gsc/ga4 alt for _JSON
      },
      now: NOW,
    });
    expect(rowFor(rows, 'closer-agent').auditStatus).toBe('pass');
    expect(rowFor(rows, 'seo-ingest-gsc').auditStatus).toBe('pass');
    expect(rowFor(rows, 'seo-ingest-ga4').auditStatus).toBe('pass');
    expect(rowFor(rows, 'wave-launcher').auditStatus).toBe('pass');
  });

  it('blank-string env does not count as present', () => {
    const rows = buildAuditRows({
      registryKeys: REGISTRY_KEYS,
      env: { DATAFORSEO_AUTH: '   ' },
      now: NOW,
    });
    expect(rowFor(rows, 'keyword-planner').auditStatus).toBe('needs_creds');
  });

  it('wires per-agent run history into the row', () => {
    const rows = buildAuditRows({
      registryKeys: REGISTRY_KEYS,
      env: {},
      now: NOW,
      history: {
        operator: {
          lastRunAt: NOW,
          lastSuccessAt: null,
          lastFailureAt: NOW,
          consecutiveFailures: 4,
          lastError: 'boom',
        },
      },
    });
    const op = rowFor(rows, 'operator');
    expect(op.consecutiveFailures).toBe(4);
    expect(op.lastError).toBe('boom');
    expect(op.lastFailureAt).toEqual(NOW);
  });
});

describe('summarizeRunHistory', () => {
  const d = (iso: string) => new Date(iso);
  const hist = (runs: RunRecord[], agent: string) => {
    const h = summarizeRunHistory(runs)[agent];
    if (!h) throw new Error(`no history for ${agent}`);
    return h;
  };

  it('counts leading failures before the most recent success', () => {
    const runs: RunRecord[] = [
      { agent: 'x', status: 'failed', startedAt: d('2026-06-08T05:00:00Z'), error: 'e3' },
      { agent: 'x', status: 'failed', startedAt: d('2026-06-08T04:00:00Z'), error: 'e2' },
      { agent: 'x', status: 'succeeded', startedAt: d('2026-06-08T03:00:00Z'), error: null },
      { agent: 'x', status: 'failed', startedAt: d('2026-06-08T02:00:00Z'), error: 'e1' },
    ];
    const h = hist(runs, 'x');
    expect(h.consecutiveFailures).toBe(2);
    expect(h.lastRunAt).toEqual(d('2026-06-08T05:00:00Z'));
    expect(h.lastFailureAt).toEqual(d('2026-06-08T05:00:00Z'));
    expect(h.lastError).toBe('e3');
    expect(h.lastSuccessAt).toEqual(d('2026-06-08T03:00:00Z'));
  });

  it('ignores in-flight (pending/running) rows for the streak', () => {
    const runs: RunRecord[] = [
      { agent: 'y', status: 'running', startedAt: d('2026-06-08T06:00:00Z'), error: null },
      { agent: 'y', status: 'failed', startedAt: d('2026-06-08T05:00:00Z'), error: 'oops' },
    ];
    const h = hist(runs, 'y');
    expect(h.consecutiveFailures).toBe(1);
    expect(h.lastRunAt).toEqual(d('2026-06-08T06:00:00Z'));
  });

  it('treats budget_exceeded and not_implemented as failures', () => {
    const runs: RunRecord[] = [
      { agent: 'z', status: 'budget_exceeded', startedAt: d('2026-06-08T05:00:00Z'), error: 'cap' },
      { agent: 'z', status: 'not_implemented', startedAt: d('2026-06-08T04:00:00Z'), error: 'stub' },
    ];
    const h = hist(runs, 'z');
    expect(h.consecutiveFailures).toBe(2);
  });
});

describe('summarizeAudit', () => {
  it('tallies by status and the counts sum to total', () => {
    const rows = buildAuditRows({ registryKeys: REGISTRY_KEYS, env: {}, now: NOW });
    const s = summarizeAudit(rows);
    const sum = Object.values(s.byStatus).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.total);
    expect(s.total).toBe(rows.length);
    expect(s.lines).toHaveLength(rows.length);
    expect(s.byStatus.not_implemented).toBe(DEFERRED_STUBS.length);
  });
});
