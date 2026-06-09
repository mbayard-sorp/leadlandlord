/**
 * Orchestrator LLM brain (orchestrator Phase 6).
 *
 * `Orchestrator` is a BaseAgent subclass (registry kind 'orchestrator', $5
 * cap) so it inherits Phase 2's global + per-agent budget gating and the kill
 * switch for free — the plan caps orchestrator spend by its agent_budgets row +
 * the global cap. It is deliberately NOT registered in the agent registry
 * (registry.ts), so it can't be fired via /api/cron/agent/orchestrator; the
 * operator server action instantiates it directly in response to a human
 * message. See ADR 0019.
 *
 * The multi-turn tool-use loop lives in `runOrchestratorBrain`, a pure,
 * client-injectable function — tested with a hand-rolled fake client rather
 * than MOCK_AI (the shared mock always returns a tool_use block, which would
 * loop forever).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb, orchestratorMessages, orchestratorThreads, eq, asc } from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { BaseAgent, type AgentContext } from '../base';
import { ORCHESTRATOR_SYSTEM_PROMPT } from './prompt';
import {
  orchestratorAnthropicTools,
  getOrchestratorTool,
  type OrchestratorToolContext,
} from './tools';

/** Hard ceiling on tool-use rounds before the brain returns a graceful reply. */
export const MAX_BRAIN_TURNS = 8;

const DEFAULT_MAX_TOKENS = 2048;

// ────────────────────────────────────────────────────────────
// Minimal Anthropic shapes (decoupled from the SDK so the loop is testable)
// ────────────────────────────────────────────────────────────

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface TextBlock {
  type: 'text';
  text: string;
}
type ContentBlock = ToolUseBlock | TextBlock | { type: string; [k: string]: unknown };

export interface BrainMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface BrainUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}
interface BrainResponse {
  content: ContentBlock[];
  stop_reason: string | null;
  usage: BrainUsage;
}
export interface BrainClient {
  messages: {
    create(req: {
      model: string;
      max_tokens: number;
      system: string;
      tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
      messages: BrainMessage[];
    }): Promise<BrainResponse>;
  };
}

export interface BrainResult {
  reply: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  turns: number;
  hitCap: boolean;
}

/**
 * Resolve and run a tool by name. The default dispatch uses the REAL tool
 * executors (getOrchestratorTool) — an unknown name (e.g. a hallucinated
 * `approve_niche`) has no executor and throws here, so the brain can never
 * invoke a tool outside the allowlist. Injectable so the loop is unit-testable
 * without a database.
 */
export type ToolDispatch = (
  name: string,
  input: Record<string, unknown>,
  ctx: OrchestratorToolContext,
) => Promise<unknown>;

export const dispatchOrchestratorTool: ToolDispatch = async (name, input, ctx) => {
  const tool = getOrchestratorTool(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.execute(input, ctx);
};

function isToolUse(b: ContentBlock): b is ToolUseBlock {
  return b.type === 'tool_use';
}
function isText(b: ContentBlock): b is TextBlock {
  return b.type === 'text';
}
function joinText(blocks: ContentBlock[]): string {
  return blocks
    .filter(isText)
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Run the tool-use loop: call the model, execute any tools it requests, feed
 * the results back, repeat until it stops requesting tools or hits MAX turns.
 * On cap-hit it returns a graceful reply (never throws) so the server action
 * doesn't surface a generic error to the chat.
 */
export async function runOrchestratorBrain(opts: {
  client: BrainClient;
  model: string;
  system?: string;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  messages: BrainMessage[];
  toolCtx: OrchestratorToolContext;
  maxTurns?: number;
  maxTokens?: number;
  onUsage?: (usage: BrainUsage) => void;
  /** Override tool execution (tests). Defaults to the real allowlisted executors. */
  dispatch?: ToolDispatch;
}): Promise<BrainResult> {
  const system = opts.system ?? ORCHESTRATOR_SYSTEM_PROMPT;
  const tools = opts.tools ?? orchestratorAnthropicTools();
  const maxTurns = opts.maxTurns ?? MAX_BRAIN_TURNS;
  const dispatch = opts.dispatch ?? dispatchOrchestratorTool;
  const convo: BrainMessage[] = [...opts.messages];
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  let lastText = '';
  let turns = 0;

  while (turns < maxTurns) {
    turns++;
    const resp = await opts.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      tools,
      messages: convo,
    });
    if (opts.onUsage) opts.onUsage(resp.usage);

    const text = joinText(resp.content);
    if (text) lastText = text;
    const toolUses = resp.content.filter(isToolUse);

    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return { reply: text || lastText, toolCalls, turns, hitCap: false };
    }

    // Echo the assistant turn (with its tool_use blocks) back into the convo.
    convo.push({ role: 'assistant', content: resp.content });

    const results: ContentBlock[] = [];
    for (const tu of toolUses) {
      toolCalls.push({ name: tu.name, input: tu.input });
      let content: string;
      let isError = false;
      try {
        content = JSON.stringify(await dispatch(tu.name, tu.input, opts.toolCtx));
      } catch (err) {
        content = `error: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content, is_error: isError });
    }
    convo.push({ role: 'user', content: results });
  }

  return {
    reply:
      (lastText ? `${lastText}\n\n` : '') +
      'I reached my step limit before finishing. Ask me to continue and I’ll pick up from here.',
    toolCalls,
    turns,
    hitCap: true,
  };
}

// ────────────────────────────────────────────────────────────
// Thread history -> Anthropic messages
// ────────────────────────────────────────────────────────────

interface HistoryRow {
  role: string;
  kind: string;
  body: string;
}

/**
 * Map persisted thread rows to a clean alternating message list. Audit
 * (kind='action') rows are dropped — they're a human audit trail, and the
 * brain re-derives live state via tools each turn. Consecutive same-role turns
 * are merged, and a leading assistant turn (an orchestrator-initiated question
 * thread) gets a synthetic user preface so messages[0] is always a user turn.
 */
export function toBrainMessages(rows: HistoryRow[]): BrainMessage[] {
  const mapped: BrainMessage[] = [];
  for (const r of rows) {
    if (r.kind === 'action') continue;
    const role: 'user' | 'assistant' = r.role === 'human' ? 'user' : 'assistant';
    const prev = mapped[mapped.length - 1];
    if (prev && prev.role === role && typeof prev.content === 'string') {
      prev.content = `${prev.content}\n\n${r.body}`;
    } else {
      mapped.push({ role, content: r.body });
    }
  }
  if (mapped.length > 0 && mapped[0]!.role === 'assistant') {
    mapped.unshift({ role: 'user', content: '(You opened this thread. Continue below.)' });
  }
  return mapped;
}

// ────────────────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────────────────

export const OrchestratorInput = z.object({
  threadId: z.string(),
  /** The human message id this run is responding to (the dedupe anchor). */
  triggerMessageId: z.string(),
});
export type OrchestratorInput = z.infer<typeof OrchestratorInput>;

export const OrchestratorOutput = z.object({
  threadId: z.string(),
  reply: z.string(),
  turns: z.number(),
  hitCap: z.boolean(),
  toolCalls: z.array(z.string()),
  writeActions: z.number(),
});
export type OrchestratorOutput = z.infer<typeof OrchestratorOutput>;

/** Keep the LLM context bounded; tools re-fetch live state regardless. */
const MAX_HISTORY_ROWS = 30;

export class Orchestrator extends BaseAgent<typeof OrchestratorInput, typeof OrchestratorOutput> {
  constructor() {
    super({
      name: 'orchestrator',
      inputSchema: OrchestratorInput,
      outputSchema: OrchestratorOutput,
      defaultDailyCapUsd: 5,
      // Dedupe on the triggering human message: a retry reuses the prior reply,
      // but each distinct message is its own non-idempotent turn.
      dedupeKeyFn: (input) => `orchestrator:${input.triggerMessageId}`,
    });
  }

  protected async execute(
    input: OrchestratorInput,
    ctx: AgentContext,
  ): Promise<OrchestratorOutput> {
    const db = getDb();
    const rows = await db
      .select({
        role: orchestratorMessages.role,
        kind: orchestratorMessages.kind,
        body: orchestratorMessages.body,
      })
      .from(orchestratorMessages)
      .where(eq(orchestratorMessages.threadId, input.threadId))
      .orderBy(asc(orchestratorMessages.createdAt));

    const recent = rows.slice(-MAX_HISTORY_ROWS);
    const messages = toBrainMessages(recent);
    if (messages.length === 0) {
      messages.push({ role: 'user', content: '(empty thread)' });
    }

    const model = process.env.ORCHESTRATOR_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    const client = getAnthropicClient() as unknown as BrainClient;

    const result = await runOrchestratorBrain({
      client,
      model,
      messages,
      toolCtx: { threadId: input.threadId, env: process.env },
      maxTurns: MAX_BRAIN_TURNS,
      onUsage: (usage) => {
        const u = {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens ?? undefined,
          cache_creation_input_tokens: usage.cache_creation_input_tokens ?? undefined,
        };
        ctx.recordUsage({ model, ...u, cost_usd: estimateCostUsd(model, u) });
      },
    });

    await db.insert(orchestratorMessages).values({
      id: randomUUID(),
      threadId: input.threadId,
      role: 'orchestrator',
      kind: 'message',
      body: result.reply,
      metadata: { turns: result.turns, hitCap: result.hitCap, toolCalls: result.toolCalls.map((t) => t.name) },
    });
    await db
      .update(orchestratorThreads)
      .set({ lastMessageAt: new Date() })
      .where(eq(orchestratorThreads.id, input.threadId));

    const writeActions = result.toolCalls.filter(
      (t) => getOrchestratorTool(t.name)?.kind === 'write',
    ).length;

    return {
      threadId: input.threadId,
      reply: result.reply,
      turns: result.turns,
      hitCap: result.hitCap,
      toolCalls: result.toolCalls.map((t) => t.name),
      writeActions,
    };
  }
}
