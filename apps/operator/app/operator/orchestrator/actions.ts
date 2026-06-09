'use server';

/**
 * Server actions for the orchestrator chat (orchestrator Phase 6). Persists the
 * human turn, runs the brain (instantiated directly — the orchestrator is
 * deliberately NOT in the cron registry, see ADR 0019), persists the reply +
 * any action rows the tools wrote, and revalidates. Every action is gated by
 * requireOperatorSession() (defense in depth on top of proxy.ts).
 */

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import {
  getDb,
  orchestratorThreads,
  orchestratorMessages,
  agentBudgets,
  eq,
  and,
  asc,
  desc,
} from '@leadlandlord/db';
import { Orchestrator } from '@leadlandlord/agents/orchestrator';
import {
  BudgetExceededError,
  GlobalBudgetExceededError,
  KillSwitchActiveError,
  AgentDisabledError,
} from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import { requireOperatorSession } from '@/lib/auth';

export interface ChatResult {
  ok: boolean;
  message?: string;
  threadId?: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  status: string;
  origin: string;
  lastMessageAt: Date;
  openQuestion: boolean;
}

export interface ThreadMessage {
  id: string;
  role: string;
  kind: string;
  body: string;
  requiresHumanResponse: boolean;
  resolved: boolean;
  createdAt: Date;
}

async function auth(): Promise<boolean> {
  try {
    await requireOperatorSession();
    return true;
  } catch {
    return false;
  }
}

/**
 * The orchestrator master switch — agent_budgets.enabled for 'orchestrator'.
 * A missing row defaults to ON. The same flag gates the chat brain (BaseAgent)
 * and the tick-driven supervisory pass, so this one toggle stops both.
 */
export async function getOrchestratorEnabled(): Promise<boolean> {
  if (!(await auth())) return true;
  try {
    const db = getDb();
    const [row] = await db
      .select({ enabled: agentBudgets.enabled })
      .from(agentBudgets)
      .where(eq(agentBudgets.agent, 'orchestrator'));
    return row ? row.enabled : true;
  } catch {
    return true;
  }
}

export async function setOrchestratorEnabled(
  enabled: boolean,
): Promise<{ ok: boolean; enabled: boolean; message?: string }> {
  if (!(await auth())) return { ok: false, enabled: true, message: 'unauthorized' };
  try {
    const db = getDb();
    await db
      .insert(agentBudgets)
      .values({ agent: 'orchestrator', enabled })
      .onConflictDoUpdate({
        target: agentBudgets.agent,
        set: { enabled, updatedAt: new Date() },
      });
    revalidatePath('/operator/orchestrator');
    return { ok: true, enabled };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'setOrchestratorEnabled failed',
    );
    return { ok: false, enabled: !enabled, message: 'could not update the orchestrator switch' };
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof KillSwitchActiveError)
    return 'The kill switch is active, so the orchestrator is paused. Disable it on the operator home page to resume.';
  if (err instanceof GlobalBudgetExceededError)
    return 'The fleet hit its global daily spend cap, so the orchestrator is paused until the cap resets (UTC midnight) or you raise it.';
  if (err instanceof BudgetExceededError)
    return 'The orchestrator reached its own daily spend cap. Raise its cap (agent_budgets) to continue today.';
  if (err instanceof AgentDisabledError)
    return 'The orchestrator is turned off. Flip it back on with the toggle at the top of this page.';
  return `The orchestrator couldn't complete that: ${err instanceof Error ? err.message : String(err)}`;
}

export async function listThreads(): Promise<ThreadSummary[]> {
  if (!(await auth())) return [];
  const db = getDb();
  try {
    const threads = await db
      .select()
      .from(orchestratorThreads)
      .orderBy(desc(orchestratorThreads.lastMessageAt))
      .limit(100);
    // Threads with an unanswered orchestrator question (both conditions at once).
    const openQ = await db
      .select({ threadId: orchestratorMessages.threadId })
      .from(orchestratorMessages)
      .where(
        and(
          eq(orchestratorMessages.requiresHumanResponse, true),
          eq(orchestratorMessages.resolved, false),
        ),
      );
    const openByThread = new Set(openQ.map((o) => o.threadId));
    return threads.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      origin: t.origin,
      lastMessageAt: t.lastMessageAt,
      openQuestion: openByThread.has(t.id),
    }));
  } catch (err) {
    // orchestrator_threads may not exist yet (migration 0039 unapplied) — render
    // an empty state rather than 500ing the page.
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'listThreads failed (0039 unapplied?)');
    return [];
  }
}

export async function getThread(
  id: string,
): Promise<{ thread: ThreadSummary; messages: ThreadMessage[] } | null> {
  if (!(await auth())) return null;
  const db = getDb();
  let thread: typeof orchestratorThreads.$inferSelect | undefined;
  try {
    [thread] = await db.select().from(orchestratorThreads).where(eq(orchestratorThreads.id, id));
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'getThread failed (0039 unapplied?)');
    return null;
  }
  if (!thread) return null;
  const messages = await db
    .select()
    .from(orchestratorMessages)
    .where(eq(orchestratorMessages.threadId, id))
    .orderBy(asc(orchestratorMessages.createdAt));
  const openQuestion = messages.some((m) => m.requiresHumanResponse && !m.resolved);
  return {
    thread: {
      id: thread.id,
      title: thread.title,
      status: thread.status,
      origin: thread.origin,
      lastMessageAt: thread.lastMessageAt,
      openQuestion,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      kind: m.kind,
      body: m.body,
      requiresHumanResponse: m.requiresHumanResponse,
      resolved: m.resolved,
      createdAt: m.createdAt,
    })),
  };
}

async function runBrain(threadId: string, triggerMessageId: string): Promise<void> {
  const db = getDb();
  try {
    await new Orchestrator().run({ threadId, triggerMessageId });
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err), threadId }, 'orchestrator brain failed');
    // Surface the reason in-thread so the chat isn't silently empty.
    await db.insert(orchestratorMessages).values({
      id: randomUUID(),
      threadId,
      role: 'system',
      kind: 'message',
      body: friendlyError(err),
    });
    await db
      .update(orchestratorThreads)
      .set({ lastMessageAt: new Date() })
      .where(eq(orchestratorThreads.id, threadId));
  }
}

export async function postOrchestratorMessage(
  threadId: string | null,
  body: string,
): Promise<ChatResult> {
  if (!(await auth())) return { ok: false, message: 'unauthorized' };
  const text = body.trim();
  if (!text) return { ok: false, message: 'message is empty' };

  const db = getDb();
  let tid = threadId;
  try {
    if (!tid) {
      tid = randomUUID();
      await db.insert(orchestratorThreads).values({
        id: tid,
        title: text.slice(0, 80),
        origin: 'chat',
        status: 'open',
      });
    }
    const humanId = randomUUID();
    await db.insert(orchestratorMessages).values({
      id: humanId,
      threadId: tid,
      role: 'human',
      kind: 'message',
      body: text,
    });
    await db
      .update(orchestratorThreads)
      .set({ lastMessageAt: new Date() })
      .where(eq(orchestratorThreads.id, tid));

    await runBrain(tid, humanId);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'postOrchestratorMessage failed');
    return {
      ok: false,
      message:
        'Could not reach the orchestrator store. If this just shipped, apply migration 0039 (orchestrator_chat) and try again.',
    };
  }
  revalidatePath('/operator/orchestrator');
  return { ok: true, threadId: tid };
}

/**
 * Mike answers an orchestrator-raised question. Posts his answer as a human
 * turn in the question's thread, marks the question resolved, and runs the
 * brain so it consumes the answer immediately (v1: answers route through chat).
 */
export async function resolveQuestion(messageId: string, answer: string): Promise<ChatResult> {
  if (!(await auth())) return { ok: false, message: 'unauthorized' };
  const text = answer.trim();
  if (!text) return { ok: false, message: 'answer is empty' };

  const db = getDb();
  try {
    const [question] = await db
      .select({ id: orchestratorMessages.id, threadId: orchestratorMessages.threadId })
      .from(orchestratorMessages)
      .where(eq(orchestratorMessages.id, messageId));
    if (!question) return { ok: false, message: 'question not found' };

    const humanId = randomUUID();
    await db.insert(orchestratorMessages).values({
      id: humanId,
      threadId: question.threadId,
      role: 'human',
      kind: 'message',
      body: text,
    });
    await db
      .update(orchestratorMessages)
      .set({ resolved: true })
      .where(eq(orchestratorMessages.id, messageId));
    await db
      .update(orchestratorThreads)
      .set({ lastMessageAt: new Date() })
      .where(eq(orchestratorThreads.id, question.threadId));

    await runBrain(question.threadId, humanId);
    revalidatePath('/operator/orchestrator');
    return { ok: true, threadId: question.threadId };
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'resolveQuestion failed');
    return { ok: false, message: 'Could not record the answer. Apply migration 0039 if it is not yet live.' };
  }
}
