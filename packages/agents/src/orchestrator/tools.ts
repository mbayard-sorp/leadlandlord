/**
 * Orchestrator tool allowlist (orchestrator Phase 6).
 *
 * The shared read/write tool layer the chat brain (brain.ts) uses, plus the
 * `raiseQuestion` helper the supervisory pass (supervisor.ts) calls directly.
 *
 * THIS ARRAY IS THE CODE-LAYER ENFORCEMENT OF THE THREE HARD CONSTRAINTS
 * (docs/orchestrator-plan.md §0.1): there is NO tool that approves a niche,
 * creates a site, or takes a site live. None of these executors import the
 * niche-approval, site-creation, or go-live helpers. A test asserts both (the
 * forbidden symbol names are listed only in tools.test.ts, never here).
 *
 * Every WRITE executor records an orchestrator_messages(kind='action') audit
 * row BEFORE it mutates, so a mutation that succeeds always has a trail (and a
 * mutation that fails after the row is written is correctly recorded as
 * attempted). See the architect review (ADR 0019).
 */
import { randomUUID } from 'node:crypto';
import {
  getDb,
  getSystemState,
  setGlobalDailyCostCap,
  requeueDeadLetter,
  agentBudgets,
  agentRuns,
  agentEvents,
  agentSchedules,
  agentHealth,
  orchestratorThreads,
  orchestratorMessages,
  eq,
  and,
  desc,
  isNull,
  isNotNull,
} from '@leadlandlord/db';
import { sendEmail } from '@leadlandlord/integrations/resend';
import { MOLLY_PERSONA } from '../molly/persona';
import { compileCron } from '../scheduler/cron';

// ────────────────────────────────────────────────────────────
// Hard-constraint guard: events the orchestrator may never requeue
// ────────────────────────────────────────────────────────────

/**
 * Requeuing one of these dead-lettered events would (directly or via the
 * pipeline it kicks off) approve a niche, create a site, or take a site live —
 * the three human-only actions. The orchestrator must not be able to do that
 * indirectly through the requeue tool, so these are blocked. Prefix-based so
 * future `niche.*` / `site.*` trigger types stay covered without a code change.
 */
export const PROTECTED_REQUEUE_EVENT_PREFIXES = ['niche.', 'site.', 'sites.'] as const;
export const PROTECTED_REQUEUE_EVENT_TYPES = new Set<string>(['domain.approval.granted']);

export function isProtectedEventType(type: string): boolean {
  if (PROTECTED_REQUEUE_EVENT_TYPES.has(type)) return true;
  return PROTECTED_REQUEUE_EVENT_PREFIXES.some((p) => type.startsWith(p));
}

/**
 * Agents the chat brain must not disable via the disable_agent tool: itself and
 * the operator (it runs supervision) and the digest (must keep reporting). Mirror
 * of supervisor.NEVER_AUTO_DISABLE; kept local to avoid a tools<->supervisor
 * import cycle. Mike's /operator/orchestrator toggle bypasses the tool layer and
 * can still turn the orchestrator off.
 */
export const SELF_PROTECTED_AGENTS: ReadonlySet<string> = new Set([
  'operator',
  'orchestrator',
  'fleet-digest',
]);

// ────────────────────────────────────────────────────────────
// Outbound question email (pure pieces are unit-tested)
// ────────────────────────────────────────────────────────────

/**
 * Mirror fleet-digest's skip-on-missing-env contract: no RESEND_API_KEY or no
 * recipient -> return null (the caller skips the send, no throw). From defaults
 * to Molly, override via ORCHESTRATOR_QUESTION_FROM.
 */
export function resolveQuestionRecipient(
  env: Record<string, string | undefined>,
): { to: string; from: string } | null {
  const to = env.ORCHESTRATOR_QUESTION_TO || env.OPERATOR_EMAIL;
  if (!env.RESEND_API_KEY || !to) return null;
  const from =
    env.ORCHESTRATOR_QUESTION_FROM || `${MOLLY_PERSONA.displayName} <${MOLLY_PERSONA.mailbox}>`;
  return { to, from };
}

/** Deep link Mike clicks in the email to land on the question thread. */
export function buildQuestionDeepLink(
  threadId: string,
  env: Record<string, string | undefined>,
): string {
  const base = (env.OPERATOR_BASE_URL || env.BASE_URL || '').replace(/\/+$/, '');
  const path = `/operator/orchestrator?thread=${threadId}`;
  return base ? `${base}${path}` : path;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderQuestionEmail(args: { title: string; question: string; link: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `[Orchestrator] ${args.title}`;
  const text = `${args.question}\n\nAnswer in the chat: ${args.link}\n\n— ${MOLLY_PERSONA.signatureLine ?? MOLLY_PERSONA.displayName}`;
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5">
  <p style="white-space:pre-wrap">${escapeHtml(args.question)}</p>
  <p><a href="${escapeHtml(args.link)}">Answer in the orchestrator chat &rarr;</a></p>
  <p style="color:#666;font-size:13px">${escapeHtml(MOLLY_PERSONA.signatureLine ?? MOLLY_PERSONA.displayName)}</p>
</div>`;
  return { subject, text, html };
}

// ────────────────────────────────────────────────────────────
// DB helpers
// ────────────────────────────────────────────────────────────

async function touchThread(threadId: string): Promise<void> {
  const db = getDb();
  await db
    .update(orchestratorThreads)
    .set({ lastMessageAt: new Date() })
    .where(eq(orchestratorThreads.id, threadId));
}

/**
 * Record a kind='action' audit row. Called by every write executor BEFORE the
 * mutation it describes (untracked-mutation safety, per the architect review).
 */
export async function recordAction(
  threadId: string,
  summary: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  await db.insert(orchestratorMessages).values({
    id,
    threadId,
    role: 'orchestrator',
    kind: 'action',
    body: summary,
    metadata,
  });
  await touchThread(threadId);
  return id;
}

/**
 * Open a question thread (origin='orchestrator_question'), optionally record
 * the action(s) that prompted it, write the question message, and email Mike a
 * deep link. Used by the brain's raise_question_to_human tool AND directly by
 * the supervisory pass when it auto-disables an agent. Skips the email cleanly
 * when RESEND/recipient env is unset (the thread + question still persist so
 * the digest surfaces it).
 */
export async function raiseQuestion(args: {
  title: string;
  question: string;
  context?: string;
  /** Action rows to record in the new thread (e.g. the auto-disable that triggered it). */
  actions?: Array<{ summary: string; metadata: Record<string, unknown> }>;
  env?: Record<string, string | undefined>;
}): Promise<{ threadId: string; messageId: string; emailed: boolean }> {
  const env = args.env ?? process.env;
  const db = getDb();
  const threadId = randomUUID();
  await db.insert(orchestratorThreads).values({
    id: threadId,
    title: args.title.slice(0, 200),
    origin: 'orchestrator_question',
    status: 'open',
  });
  for (const a of args.actions ?? []) {
    await db.insert(orchestratorMessages).values({
      id: randomUUID(),
      threadId,
      role: 'orchestrator',
      kind: 'action',
      body: a.summary,
      metadata: a.metadata,
    });
  }
  const messageId = randomUUID();
  const body = args.context ? `${args.question}\n\n${args.context}` : args.question;
  await db.insert(orchestratorMessages).values({
    id: messageId,
    threadId,
    role: 'orchestrator',
    kind: 'question',
    body,
    requiresHumanResponse: true,
  });
  await touchThread(threadId);

  let emailed = false;
  const recipient = resolveQuestionRecipient(env);
  if (recipient) {
    const link = buildQuestionDeepLink(threadId, env);
    const { subject, text, html } = renderQuestionEmail({ title: args.title, question: body, link });
    await sendEmail({
      to: recipient.to,
      from: recipient.from,
      subject,
      text,
      html,
      tags: [{ name: 'kind', value: 'orchestrator-question' }],
    });
    emailed = true;
  }
  return { threadId, messageId, emailed };
}

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────

export interface OrchestratorToolContext {
  /**
   * The chat thread write actions attach their audit row to. Required for
   * write tools (except raise_question_to_human, which opens its own thread).
   */
  threadId: string | null;
  env?: Record<string, string | undefined>;
}

export interface OrchestratorTool {
  name: string;
  description: string;
  kind: 'read' | 'write';
  /** JSON Schema for the Anthropic tools API. */
  input_schema: Record<string, unknown>;
  execute(input: Record<string, unknown>, ctx: OrchestratorToolContext): Promise<unknown>;
}

function n(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0);
}

function requireThread(ctx: OrchestratorToolContext): string {
  if (!ctx.threadId) {
    throw new Error('this action requires an active chat thread');
  }
  return ctx.threadId;
}

// ---- Read tools ----

const getFleetStatus: OrchestratorTool = {
  name: 'get_fleet_status',
  description:
    'One-glance fleet summary: per-agent enabled state + health, global spend vs cap, queue depth, dead-letter count, and open orchestrator questions.',
  kind: 'read',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  async execute() {
    const db = getDb();
    const [budgets, health, sys, queued, dead, openQs] = await Promise.all([
      db.select().from(agentBudgets),
      db.select().from(agentHealth),
      getSystemState(),
      db.select({ id: agentEvents.id }).from(agentEvents).where(isNull(agentEvents.processedAt)),
      db.select({ id: agentEvents.id }).from(agentEvents).where(isNotNull(agentEvents.deadLetteredAt)),
      db
        .select({ id: orchestratorMessages.id })
        .from(orchestratorMessages)
        .where(
          and(
            eq(orchestratorMessages.requiresHumanResponse, true),
            eq(orchestratorMessages.resolved, false),
          ),
        ),
    ]);
    const healthByAgent = new Map(health.map((h) => [h.agent, h]));
    return {
      globalSpentTodayUsd: n(sys.globalSpentTodayUsd),
      globalDailyCostCapUsd: n(sys.globalDailyCostCapUsd),
      killSwitch: sys.killSwitch,
      operatorMode: sys.operatorMode,
      queueDepth: queued.length,
      deadLetters: dead.length,
      openQuestions: openQs.length,
      agents: budgets.map((b) => {
        const h = healthByAgent.get(b.agent);
        return {
          agent: b.agent,
          enabled: b.enabled,
          dailyCapUsd: n(b.dailyCostCapUsd),
          spentTodayUsd: n(b.spentTodayUsd),
          auditStatus: h?.auditStatus ?? 'unknown',
          consecutiveFailures: h?.consecutiveFailures ?? 0,
        };
      }),
    };
  },
};

const getAgentDetail: OrchestratorTool = {
  name: 'get_agent_detail',
  description: 'Budget, health, recent runs, and schedule for one agent.',
  kind: 'read',
  input_schema: {
    type: 'object',
    properties: { agent: { type: 'string' } },
    required: ['agent'],
    additionalProperties: false,
  },
  async execute(input) {
    const agent = String(input.agent);
    const db = getDb();
    const [budget] = await db.select().from(agentBudgets).where(eq(agentBudgets.agent, agent));
    const [health] = await db.select().from(agentHealth).where(eq(agentHealth.agent, agent));
    const runs = await db
      .select({
        id: agentRuns.id,
        status: agentRuns.status,
        costUsd: agentRuns.costUsd,
        error: agentRuns.error,
        startedAt: agentRuns.startedAt,
      })
      .from(agentRuns)
      .where(eq(agentRuns.agent, agent))
      .orderBy(desc(agentRuns.startedAt))
      .limit(10);
    const schedules = await db
      .select()
      .from(agentSchedules)
      .where(eq(agentSchedules.targetAgent, agent));
    return {
      agent,
      budget: budget
        ? {
            enabled: budget.enabled,
            dailyCapUsd: n(budget.dailyCostCapUsd),
            monthlyCapUsd: n(budget.monthlyCostCapUsd),
            spentTodayUsd: n(budget.spentTodayUsd),
            spentThisMonthUsd: n(budget.spentThisMonthUsd),
          }
        : null,
      health: health
        ? {
            auditStatus: health.auditStatus,
            consecutiveFailures: health.consecutiveFailures,
            lastError: health.lastError,
          }
        : null,
      recentRuns: runs.map((r) => ({
        status: r.status,
        costUsd: n(r.costUsd),
        error: r.error,
        startedAt: r.startedAt,
      })),
      schedules: schedules.map((s) => ({
        schedulerName: s.schedulerName,
        cadenceKind: s.cadenceKind,
        cronExpr: s.cronExpr,
        intervalMinutes: s.intervalMinutes,
        paused: s.paused,
      })),
    };
  },
};

const getRecentRuns: OrchestratorTool = {
  name: 'get_recent_runs',
  description: 'Recent agent runs across the fleet, or filtered to one agent.',
  kind: 'read',
  input_schema: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'optional agent kind to filter by' },
      limit: { type: 'number', description: 'max rows (default 20, capped at 50)' },
    },
    additionalProperties: false,
  },
  async execute(input) {
    const db = getDb();
    const limit = Math.min(50, Math.max(1, n(input.limit) || 20));
    const base = db
      .select({
        agent: agentRuns.agent,
        status: agentRuns.status,
        costUsd: agentRuns.costUsd,
        error: agentRuns.error,
        startedAt: agentRuns.startedAt,
      })
      .from(agentRuns);
    const rows = input.agent
      ? await base.where(eq(agentRuns.agent, String(input.agent))).orderBy(desc(agentRuns.startedAt)).limit(limit)
      : await base.orderBy(desc(agentRuns.startedAt)).limit(limit);
    return rows.map((r) => ({ ...r, costUsd: n(r.costUsd) }));
  },
};

const getBudgetStatus: OrchestratorTool = {
  name: 'get_budget_status',
  description: 'Every agent daily/monthly spend vs cap, plus the global daily cap and today spend.',
  kind: 'read',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  async execute() {
    const db = getDb();
    const [budgets, sys] = await Promise.all([db.select().from(agentBudgets), getSystemState()]);
    return {
      global: {
        spentTodayUsd: n(sys.globalSpentTodayUsd),
        dailyCapUsd: n(sys.globalDailyCostCapUsd),
      },
      agents: budgets.map((b) => ({
        agent: b.agent,
        enabled: b.enabled,
        dailyCapUsd: n(b.dailyCostCapUsd),
        spentTodayUsd: n(b.spentTodayUsd),
        monthlyCapUsd: n(b.monthlyCostCapUsd),
        spentThisMonthUsd: n(b.spentThisMonthUsd),
      })),
    };
  },
};

const getQueueState: OrchestratorTool = {
  name: 'get_queue_state',
  description: 'Queued and in-flight event counts plus the dead-letter list (id, type, error).',
  kind: 'read',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  async execute() {
    const db = getDb();
    const [queued, inflight, dead] = await Promise.all([
      db.select({ id: agentEvents.id }).from(agentEvents).where(
        and(isNull(agentEvents.processedAt), isNull(agentEvents.processingAt), isNull(agentEvents.deadLetteredAt)),
      ),
      db.select({ id: agentEvents.id }).from(agentEvents).where(
        and(isNotNull(agentEvents.processingAt), isNull(agentEvents.processedAt)),
      ),
      db
        .select({
          id: agentEvents.id,
          type: agentEvents.type,
          targetAgent: agentEvents.targetAgent,
          failureKind: agentEvents.failureKind,
          error: agentEvents.error,
        })
        .from(agentEvents)
        .where(isNotNull(agentEvents.deadLetteredAt))
        .limit(50),
    ]);
    return {
      queued: queued.length,
      inFlight: inflight.length,
      deadLetterCount: dead.length,
      deadLetters: dead.map((d) => ({
        id: d.id,
        type: d.type,
        targetAgent: d.targetAgent,
        failureKind: d.failureKind,
        error: d.error,
        requeueable: !isProtectedEventType(d.type),
      })),
    };
  },
};

const getSchedules: OrchestratorTool = {
  name: 'get_schedules',
  description: 'The agent_schedules cadence rows that drive the tick.',
  kind: 'read',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  async execute() {
    const db = getDb();
    return db.select().from(agentSchedules).orderBy(agentSchedules.schedulerName);
  },
};

// ---- Write tools (audit row BEFORE mutation) ----

async function upsertEnabled(agent: string, enabled: boolean): Promise<void> {
  const db = getDb();
  await db
    .insert(agentBudgets)
    .values({ agent, enabled })
    .onConflictDoUpdate({
      target: agentBudgets.agent,
      set: { enabled, updatedAt: new Date() },
    });
}

const enableAgent: OrchestratorTool = {
  name: 'enable_agent',
  description: 'Set an agent’s enabled flag to true so it can run again.',
  kind: 'write',
  input_schema: {
    type: 'object',
    properties: { agent: { type: 'string' }, reason: { type: 'string' } },
    required: ['agent'],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const threadId = requireThread(ctx);
    const agent = String(input.agent);
    const db = getDb();
    const [before] = await db.select({ enabled: agentBudgets.enabled }).from(agentBudgets).where(eq(agentBudgets.agent, agent));
    await recordAction(threadId, `Enabled agent ${agent}`, {
      tool: 'enable_agent',
      agent,
      before: { enabled: before?.enabled ?? null },
      after: { enabled: true },
      reason: input.reason ?? null,
    });
    await upsertEnabled(agent, true);
    return { agent, enabled: true };
  },
};

const disableAgent: OrchestratorTool = {
  name: 'disable_agent',
  description:
    'Set an agent’s enabled flag to false (it stops running) and pause its cadence rows. Use for a flapping or runaway agent.',
  kind: 'write',
  input_schema: {
    type: 'object',
    properties: { agent: { type: 'string' }, reason: { type: 'string' } },
    required: ['agent', 'reason'],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const threadId = requireThread(ctx);
    const agent = String(input.agent);
    const reason = String(input.reason);
    if (SELF_PROTECTED_AGENTS.has(agent)) {
      return {
        error: `refusing to disable "${agent}" — it is protected (operator/orchestrator/fleet-digest). The human can toggle the orchestrator off from /operator/orchestrator.`,
      };
    }
    const db = getDb();
    const [before] = await db.select({ enabled: agentBudgets.enabled }).from(agentBudgets).where(eq(agentBudgets.agent, agent));
    await recordAction(threadId, `Disabled agent ${agent}: ${reason}`, {
      tool: 'disable_agent',
      agent,
      before: { enabled: before?.enabled ?? null },
      after: { enabled: false },
      reason,
    });
    await upsertEnabled(agent, false);
    await db
      .update(agentSchedules)
      .set({ paused: true, managedBy: 'orchestrator', notes: reason, updatedAt: new Date() })
      .where(eq(agentSchedules.targetAgent, agent));
    return { agent, enabled: false };
  },
};

const setAgentCap: OrchestratorTool = {
  name: 'set_agent_cap',
  description: 'Change an agent’s daily cost cap in USD.',
  kind: 'write',
  input_schema: {
    type: 'object',
    properties: { agent: { type: 'string' }, dailyCapUsd: { type: 'number' } },
    required: ['agent', 'dailyCapUsd'],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const threadId = requireThread(ctx);
    const agent = String(input.agent);
    const cap = Math.max(0, n(input.dailyCapUsd));
    const db = getDb();
    const [before] = await db.select({ cap: agentBudgets.dailyCostCapUsd }).from(agentBudgets).where(eq(agentBudgets.agent, agent));
    await recordAction(threadId, `Set ${agent} daily cap to $${cap.toFixed(2)}`, {
      tool: 'set_agent_cap',
      agent,
      before: { dailyCapUsd: before ? n(before.cap) : null },
      after: { dailyCapUsd: cap },
    });
    await db
      .insert(agentBudgets)
      .values({ agent, dailyCostCapUsd: cap.toFixed(2) })
      .onConflictDoUpdate({
        target: agentBudgets.agent,
        set: { dailyCostCapUsd: cap.toFixed(2), updatedAt: new Date() },
      });
    return { agent, dailyCapUsd: cap };
  },
};

const setAgentCadence: OrchestratorTool = {
  name: 'set_agent_cadence',
  description:
    'Pause/resume an agent’s schedule or change its cron/interval. Pass paused, or a cronExpr (5-field UTC), or intervalMinutes.',
  kind: 'write',
  input_schema: {
    type: 'object',
    properties: {
      agent: { type: 'string' },
      paused: { type: 'boolean' },
      cronExpr: { type: 'string', description: '5-field UTC cron' },
      intervalMinutes: { type: 'number' },
    },
    required: ['agent'],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const threadId = requireThread(ctx);
    const agent = String(input.agent);
    const db = getDb();
    const existing = await db.select().from(agentSchedules).where(eq(agentSchedules.targetAgent, agent));
    if (existing.length === 0) {
      return { error: `no schedule rows target agent "${agent}" (it may be event/manual only)` };
    }
    const patch: Record<string, unknown> = { managedBy: 'orchestrator', updatedAt: new Date() };
    if (typeof input.paused === 'boolean') patch.paused = input.paused;
    if (typeof input.cronExpr === 'string') {
      try {
        compileCron(input.cronExpr);
      } catch (err) {
        return { error: `invalid cronExpr: ${err instanceof Error ? err.message : String(err)}` };
      }
      patch.cronExpr = input.cronExpr;
      patch.cadenceKind = 'cron';
    }
    if (typeof input.intervalMinutes === 'number') {
      patch.intervalMinutes = Math.max(1, Math.round(input.intervalMinutes));
    }
    await recordAction(threadId, `Updated cadence for ${agent}`, {
      tool: 'set_agent_cadence',
      agent,
      before: existing.map((e) => ({ scheduler: e.schedulerName, paused: e.paused, cronExpr: e.cronExpr })),
      after: patch,
    });
    await db.update(agentSchedules).set(patch).where(eq(agentSchedules.targetAgent, agent));
    return { agent, updated: existing.length };
  },
};

const setGlobalCap: OrchestratorTool = {
  name: 'set_global_cap',
  description: 'Change the portfolio-wide daily spend cap in USD. 0 disables the ceiling.',
  kind: 'write',
  input_schema: {
    type: 'object',
    properties: { dailyCapUsd: { type: 'number' } },
    required: ['dailyCapUsd'],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const threadId = requireThread(ctx);
    const cap = Math.max(0, n(input.dailyCapUsd));
    const before = n((await getSystemState()).globalDailyCostCapUsd);
    await recordAction(threadId, `Set global daily cap to $${cap.toFixed(2)}`, {
      tool: 'set_global_cap',
      before: { globalDailyCapUsd: before },
      after: { globalDailyCapUsd: cap },
    });
    await setGlobalDailyCostCap(cap);
    return { globalDailyCapUsd: cap };
  },
};

const requeueDeadLetterTool: OrchestratorTool = {
  name: 'requeue_dead_letter',
  description:
    'Re-queue a dead-lettered event for another attempt. Events in the niche-approval / site-creation / go-live chain are blocked and cannot be requeued.',
  kind: 'write',
  input_schema: {
    type: 'object',
    properties: { eventId: { type: 'string' } },
    required: ['eventId'],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const threadId = requireThread(ctx);
    const eventId = String(input.eventId);
    const db = getDb();
    const [event] = await db
      .select({ id: agentEvents.id, type: agentEvents.type, deadLetteredAt: agentEvents.deadLetteredAt })
      .from(agentEvents)
      .where(eq(agentEvents.id, eventId));
    if (!event) return { error: `event ${eventId} not found` };
    if (!event.deadLetteredAt) return { error: `event ${eventId} is not dead-lettered` };
    if (isProtectedEventType(event.type)) {
      return {
        error: `refusing to requeue protected event type "${event.type}" — it could trigger niche approval, site creation, or go-live, which are human-only`,
      };
    }
    await recordAction(threadId, `Requeued dead-lettered event ${eventId} (${event.type})`, {
      tool: 'requeue_dead_letter',
      eventId,
      eventType: event.type,
    });
    await requeueDeadLetter(eventId);
    return { eventId, requeued: true };
  },
};

const raiseQuestionTool: OrchestratorTool = {
  name: 'raise_question_to_human',
  description:
    'Open a question thread and email Mike when you need a decision you can’t make in-bounds (a repeated ambiguous failure, spend nearing the cap, a cadence trade-off, or a pending niche/go-live you cannot act on). Mike answers in the chat.',
  kind: 'write',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'short subject line' },
      question: { type: 'string' },
      context: { type: 'string', description: 'optional supporting detail' },
    },
    required: ['title', 'question'],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const { threadId, emailed } = await raiseQuestion({
      title: String(input.title),
      question: String(input.question),
      context: input.context ? String(input.context) : undefined,
      env: ctx.env,
    });
    return { threadId, emailed, note: 'Question raised; Mike will answer in the chat.' };
  },
};

export const ORCHESTRATOR_TOOLS: OrchestratorTool[] = [
  getFleetStatus,
  getAgentDetail,
  getRecentRuns,
  getBudgetStatus,
  getQueueState,
  getSchedules,
  enableAgent,
  disableAgent,
  setAgentCap,
  setAgentCadence,
  setGlobalCap,
  requeueDeadLetterTool,
  raiseQuestionTool,
];

export function getOrchestratorTool(name: string): OrchestratorTool | undefined {
  return ORCHESTRATOR_TOOLS.find((t) => t.name === name);
}

/** The tool list shaped for the Anthropic messages API. */
export function orchestratorAnthropicTools(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return ORCHESTRATOR_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}
