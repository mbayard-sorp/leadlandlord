/**
 * Fleet digest (orchestrator Phase 5).
 *
 * A 6am-MST daily email from Molly summarizing the fleet (last 24h activity,
 * spend vs caps, dead-letters, health) and flagging what needs Mike — pending
 * niche approvals, sites awaiting go-live, credential-blocked agents,
 * over-budget agents, and agents the orchestrator auto-disabled.
 *
 * Sends via the Zoho MCP server (same path as molly-digest/outreach) from a
 * Zoho mailbox address -> the operator. Mirrors the notifyOperatorEmail
 * skip-on-missing-env pattern: no ZOHO_MCP_URL/ZOHO_ACCOUNT_ID or recipient
 * -> returns 'skipped' rather than throwing.
 */
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import {
  getDb,
  agentBudgets,
  agentHealth,
  systemState,
} from '@leadlandlord/db';
import { sendEmail } from '@leadlandlord/integrations/zoho-mcp';
import { BaseAgent, type AgentContext } from '../base';
import { MOLLY_PERSONA } from '../molly/persona';

// ────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────

export const FleetDigestInput = z.object({ date: z.string().optional() });
export type FleetDigestInput = z.infer<typeof FleetDigestInput>;

export const FleetDigestOutput = z.object({
  date: z.string(),
  delivery: z.enum(['sent', 'skipped']),
  needsAttentionCount: z.number(),
  subject: z.string(),
});
export type FleetDigestOutput = z.infer<typeof FleetDigestOutput>;

// ────────────────────────────────────────────────────────────
// Data shape
// ────────────────────────────────────────────────────────────

export interface AgentActivity {
  agent: string;
  succeeded: number;
  failed: number;
  costUsd: number;
}
export interface BudgetLine {
  agent: string;
  spentUsd: number;
  capUsd: number;
}
export interface FleetDigestData {
  date: string;
  windowHours: number;
  activity: AgentActivity[];
  globalSpentUsd: number;
  globalCapUsd: number;
  budgets: BudgetLine[];
  deadLettered: number;
  needsCreds: string[];
  notImplemented: string[];
  failing: Array<{ agent: string; consecutiveFailures: number; lastError: string | null }>;
  autoDisabled: string[];
  pendingNiches: number;
  sitesAwaitingGoLive: number;
  openQuestions: number;
}

const NEAR_BUDGET_FRACTION = 0.8;
const MAX_ACTIVITY_ROWS = 25;

/**
 * Resolve the digest sender/recipient from env, or null to skip (mirrors
 * notifyOperatorEmail): needs ZOHO_MCP_URL + ZOHO_ACCOUNT_ID + a recipient.
 * From must be a mailbox address the Zoho account can send as (Zoho rejects
 * mismatched senders): FLEET_DIGEST_FROM, else Molly's mailbox, else the
 * account default sender.
 */
export function resolveDigestRecipient(
  env: Record<string, string | undefined>,
): { to: string; from: string } | null {
  const to = env.FLEET_DIGEST_TO || env.OPERATOR_EMAIL;
  if (!env.ZOHO_MCP_URL || !env.ZOHO_ACCOUNT_ID || !to) return null;
  const from =
    env.FLEET_DIGEST_FROM || env.ZOHO_MOLLY_FROM || env.ZOHO_DEFAULT_FROM || MOLLY_PERSONA.mailbox;
  return { to, from };
}

// ────────────────────────────────────────────────────────────
// Pure: needs-attention + render
// ────────────────────────────────────────────────────────────

/** The "needs your attention" bullet list — the part Mike must act on. */
export function computeNeedsAttention(data: FleetDigestData): string[] {
  const items: string[] = [];
  if (data.pendingNiches > 0) items.push(`${data.pendingNiches} niche(s) awaiting your approval`);
  if (data.sitesAwaitingGoLive > 0)
    items.push(`${data.sitesAwaitingGoLive} site(s) built and awaiting go-live`);
  if (data.needsCreds.length > 0)
    items.push(`${data.needsCreds.length} agent(s) blocked on credentials: ${data.needsCreds.join(', ')}`);

  const overBudget = data.budgets.filter((b) => b.capUsd > 0 && b.spentUsd >= b.capUsd).map((b) => b.agent);
  const nearBudget = data.budgets
    .filter((b) => b.capUsd > 0 && b.spentUsd >= NEAR_BUDGET_FRACTION * b.capUsd && b.spentUsd < b.capUsd)
    .map((b) => b.agent);
  if (overBudget.length > 0) items.push(`${overBudget.length} agent(s) over daily cap: ${overBudget.join(', ')}`);
  if (nearBudget.length > 0) items.push(`${nearBudget.length} agent(s) near daily cap: ${nearBudget.join(', ')}`);
  if (data.globalCapUsd > 0 && data.globalSpentUsd >= data.globalCapUsd)
    items.push(
      `Portfolio daily cap reached ($${data.globalSpentUsd.toFixed(2)} / $${data.globalCapUsd.toFixed(2)})`,
    );
  if (data.autoDisabled.length > 0)
    items.push(`${data.autoDisabled.length} agent(s) auto-disabled: ${data.autoDisabled.join(', ')}`);
  if (data.deadLettered > 0) items.push(`${data.deadLettered} event(s) dead-lettered in the last 24h`);
  if (data.openQuestions > 0) items.push(`${data.openQuestions} open orchestrator question(s)`);
  return items;
}

export interface RenderedDigest {
  subject: string;
  text: string;
  html: string;
}

export function renderFleetDigest(data: FleetDigestData): RenderedDigest {
  const attention = computeNeedsAttention(data);
  const subject = `Fleet digest — ${data.date} — ${
    attention.length > 0 ? `${attention.length} need attention` : 'all clear'
  }`;

  const activityRows = data.activity.slice(0, MAX_ACTIVITY_ROWS);
  const truncated = data.activity.length - activityRows.length;

  // ── plain text ──
  const t: string[] = [];
  t.push(`LeadLandlord fleet digest — ${data.date} (last ${data.windowHours}h)`);
  t.push('');
  t.push('NEEDS YOUR ATTENTION');
  if (attention.length === 0) t.push('  All clear.');
  else for (const a of attention) t.push(`  - ${a}`);
  t.push('');
  t.push(`SPEND: portfolio $${data.globalSpentUsd.toFixed(2)} / $${data.globalCapUsd.toFixed(2)} today`);
  t.push('');
  t.push('FLEET ACTIVITY (24h: agent — ok/fail — cost)');
  if (activityRows.length === 0) t.push('  No runs in the window.');
  else
    for (const r of activityRows) {
      t.push(`  ${r.agent} — ${r.succeeded} ok / ${r.failed} fail — $${r.costUsd.toFixed(2)}`);
    }
  if (truncated > 0) t.push(`  …and ${truncated} more agent(s) (truncated)`);
  t.push('');
  t.push(`HEALTH: ${data.needsCreds.length} need creds, ${data.notImplemented.length} not implemented, ${data.failing.length} failing, ${data.deadLettered} dead-lettered (24h)`);
  if (data.failing.length > 0) {
    for (const f of data.failing) {
      t.push(`  ${f.agent}: ${f.consecutiveFailures} consecutive failure(s)${f.lastError ? ` — ${f.lastError.slice(0, 100)}` : ''}`);
    }
  }
  const text = t.join('\n');

  // ── HTML ──
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const h: string[] = [];
  h.push(`<h2 style="margin:0 0 4px">LeadLandlord fleet digest</h2>`);
  h.push(`<p style="color:#666;margin:0 0 16px">${esc(data.date)} · last ${data.windowHours}h</p>`);
  h.push(`<h3 style="margin:16px 0 4px">Needs your attention</h3>`);
  if (attention.length === 0) h.push(`<p style="color:#2a7">All clear.</p>`);
  else h.push(`<ul>${attention.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`);
  h.push(
    `<h3 style="margin:16px 0 4px">Spend</h3><p>Portfolio <b>$${data.globalSpentUsd.toFixed(2)}</b> / $${data.globalCapUsd.toFixed(2)} today</p>`,
  );
  h.push(`<h3 style="margin:16px 0 4px">Fleet activity (24h)</h3>`);
  if (activityRows.length === 0) h.push(`<p style="color:#666">No runs in the window.</p>`);
  else {
    h.push(
      `<table cellpadding="4" style="border-collapse:collapse"><tr><th align="left">Agent</th><th align="right">OK</th><th align="right">Fail</th><th align="right">Cost</th></tr>` +
        activityRows
          .map(
            (r) =>
              `<tr><td>${esc(r.agent)}</td><td align="right">${r.succeeded}</td><td align="right" style="color:${r.failed > 0 ? '#c33' : '#666'}">${r.failed}</td><td align="right">$${r.costUsd.toFixed(2)}</td></tr>`,
          )
          .join('') +
        `</table>`,
    );
    if (truncated > 0) h.push(`<p style="color:#666">…and ${truncated} more (truncated)</p>`);
  }
  h.push(
    `<h3 style="margin:16px 0 4px">Health</h3><p>${data.needsCreds.length} need creds · ${data.notImplemented.length} not implemented · ${data.failing.length} failing · ${data.deadLettered} dead-lettered (24h)</p>`,
  );
  const html = h.join('\n');

  return { subject, text, html };
}

// ────────────────────────────────────────────────────────────
// Gather (DB; defensive per-section)
// ────────────────────────────────────────────────────────────

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray((r as any)?.rows)) return (r as any).rows as T[];
  return [];
}

async function safe<T>(fn: () => Promise<T>, fallback: T, ctx: AgentContext, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    ctx.log.warn({ err: err instanceof Error ? err.message : err, section: label }, 'fleet-digest: section query failed');
    return fallback;
  }
}

export async function gatherFleetDigestData(
  ctx: AgentContext,
  date: string,
  windowHours = 24,
): Promise<FleetDigestData> {
  const db = getDb();

  const activity = await safe<AgentActivity[]>(
    async () =>
      rowsOf<{ agent: string; succeeded: number; failed: number; cost: number }>(
        await db.execute(sql`
          SELECT agent,
            SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END)::int AS succeeded,
            SUM(CASE WHEN status IN ('failed', 'budget_exceeded', 'not_implemented') THEN 1 ELSE 0 END)::int AS failed,
            COALESCE(SUM(cost_usd), 0)::float AS cost
          FROM agent_runs
          WHERE started_at >= NOW() - (${windowHours} || ' hours')::interval
          GROUP BY agent
          ORDER BY cost DESC, failed DESC
        `),
      ).map((r) => ({ agent: r.agent, succeeded: r.succeeded, failed: r.failed, costUsd: Number(r.cost) })),
    [],
    ctx,
    'activity',
  );

  const budgets = await safe<BudgetLine[]>(
    async () =>
      (await db
        .select({
          agent: agentBudgets.agent,
          spent: agentBudgets.spentTodayUsd,
          cap: agentBudgets.dailyCostCapUsd,
          enabled: agentBudgets.enabled,
        })
        .from(agentBudgets)).map((b) => ({ agent: b.agent, spentUsd: Number(b.spent), capUsd: Number(b.cap) })),
    [],
    ctx,
    'budgets',
  );

  const global = await safe(
    async () => {
      const [g] = await db
        .select({ spent: systemState.globalSpentTodayUsd, cap: systemState.globalDailyCostCapUsd })
        .from(systemState)
        .where(sql`${systemState.id} = 'global'`)
        .limit(1);
      return { spent: Number(g?.spent ?? 0), cap: Number(g?.cap ?? 0) };
    },
    { spent: 0, cap: 0 },
    ctx,
    'global',
  );

  const health = await safe<
    Array<{ agent: string; auditStatus: string; consecutiveFailures: number; lastError: string | null; enabled: boolean }>
  >(
    async () => {
      const rows = await db
        .select({
          agent: agentHealth.agent,
          auditStatus: agentHealth.auditStatus,
          consecutiveFailures: agentHealth.consecutiveFailures,
          lastError: agentHealth.lastError,
        })
        .from(agentHealth);
      const disabledSet = new Set(
        (
          await db
            .select({ agent: agentBudgets.agent })
            .from(agentBudgets)
            .where(sql`${agentBudgets.enabled} = false`)
        ).map((r) => r.agent),
      );
      return rows.map((r) => ({
        agent: r.agent,
        auditStatus: r.auditStatus,
        consecutiveFailures: r.consecutiveFailures,
        lastError: r.lastError,
        enabled: !disabledSet.has(r.agent),
      }));
    },
    [],
    ctx,
    'health',
  );

  const deadLettered = await safe<number>(
    async () => {
      const r = rowsOf<{ c: number }>(
        await db.execute(sql`
          SELECT COUNT(*)::int AS c FROM agent_events
          WHERE dead_lettered_at >= NOW() - (${windowHours} || ' hours')::interval
        `),
      );
      return r[0]?.c ?? 0;
    },
    0,
    ctx,
    'deadLettered',
  );

  const pendingNiches = await safe<number>(
    async () => {
      const r = rowsOf<{ c: number }>(
        await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM niches WHERE decision = 'pending'`,
        ),
      );
      return r[0]?.c ?? 0;
    },
    0,
    ctx,
    'pendingNiches',
  );

  const sitesAwaitingGoLive = await safe<number>(
    async () => {
      const r = rowsOf<{ c: number }>(
        await db.execute(sql`SELECT COUNT(*)::int AS c FROM sites WHERE status = 'warming'`),
      );
      return r[0]?.c ?? 0;
    },
    0,
    ctx,
    'sitesAwaitingGoLive',
  );

  // Open orchestrator questions awaiting Mike (Phase 6). Defensive: the table
  // may not exist yet (0039 unapplied) -> safe() falls back to 0.
  const openQuestions = await safe<number>(
    async () => {
      const r = rowsOf<{ c: number }>(
        await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM orchestrator_messages WHERE requires_human_response = true AND resolved = false`,
        ),
      );
      return r[0]?.c ?? 0;
    },
    0,
    ctx,
    'openQuestions',
  );

  return {
    date,
    windowHours,
    activity,
    globalSpentUsd: global.spent,
    globalCapUsd: global.cap,
    budgets,
    deadLettered,
    needsCreds: health.filter((h) => h.auditStatus === 'needs_creds').map((h) => h.agent),
    notImplemented: health.filter((h) => h.auditStatus === 'not_implemented').map((h) => h.agent),
    failing: health
      .filter((h) => h.consecutiveFailures > 0)
      .map((h) => ({ agent: h.agent, consecutiveFailures: h.consecutiveFailures, lastError: h.lastError })),
    autoDisabled: health.filter((h) => !h.enabled && h.consecutiveFailures >= 3).map((h) => h.agent),
    pendingNiches,
    sitesAwaitingGoLive,
    openQuestions,
  };
}

// ────────────────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────────────────

function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export class FleetDigest extends BaseAgent<typeof FleetDigestInput, typeof FleetDigestOutput> {
  constructor() {
    super({
      name: 'fleet-digest',
      inputSchema: FleetDigestInput,
      outputSchema: FleetDigestOutput,
      defaultDailyCapUsd: 1,
      dedupeKeyFn: () => `fleet-digest:${utcDate()}`,
    });
  }

  protected async execute(input: FleetDigestInput, ctx: AgentContext): Promise<FleetDigestOutput> {
    const date = input.date ?? utcDate();
    const data = await gatherFleetDigestData(ctx, date);
    const { subject, text, html } = renderFleetDigest(data);
    const needsAttentionCount = computeNeedsAttention(data).length;

    const recipient = resolveDigestRecipient(process.env);
    if (!recipient) {
      ctx.log.info(
        {
          hasMcpUrl: !!process.env.ZOHO_MCP_URL,
          hasAccountId: !!process.env.ZOHO_ACCOUNT_ID,
          hasRecipient: !!(process.env.FLEET_DIGEST_TO || process.env.OPERATOR_EMAIL),
        },
        'fleet-digest: send skipped (missing ZOHO_MCP_URL/ZOHO_ACCOUNT_ID or recipient)',
      );
      return { date, delivery: 'skipped', needsAttentionCount, subject };
    }

    await sendEmail({
      to: recipient.to,
      from: recipient.from,
      subject,
      text,
      html,
    });
    ctx.log.info({ to: recipient.to, needsAttentionCount }, 'fleet-digest: sent');
    return { date, delivery: 'sent', needsAttentionCount, subject };
  }
}
