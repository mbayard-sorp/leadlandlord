import { describe, it, expect } from 'vitest';
import {
  runOrchestratorBrain,
  toBrainMessages,
  dispatchOrchestratorTool,
  type BrainClient,
  type BrainMessage,
} from './brain';

const USAGE = { input_tokens: 10, output_tokens: 5 };

/** A fake client that replays a fixed list of responses, one per create() call. */
function fakeClient(responses: Array<{ content: unknown[]; stop_reason: string }>): {
  client: BrainClient;
  calls: () => number;
  lastMessages: () => BrainMessage[];
} {
  let i = 0;
  let last: BrainMessage[] = [];
  const client: BrainClient = {
    messages: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async (req: any) => {
        last = req.messages;
        const r = responses[Math.min(i, responses.length - 1)]!;
        i++;
        return { content: r.content as never, stop_reason: r.stop_reason, usage: USAGE };
      },
    },
  };
  return { client, calls: () => i, lastMessages: () => last };
}

const toolCtx = { threadId: 'thread-1', env: {} };

describe('toBrainMessages', () => {
  it('maps human->user, orchestrator->assistant', () => {
    expect(
      toBrainMessages([
        { role: 'human', kind: 'message', body: 'hi' },
        { role: 'orchestrator', kind: 'message', body: 'hello' },
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('drops audit (action) rows', () => {
    expect(
      toBrainMessages([
        { role: 'orchestrator', kind: 'action', body: 'disabled x' },
        { role: 'human', kind: 'message', body: 'why?' },
      ]),
    ).toEqual([{ role: 'user', content: 'why?' }]);
  });

  it('merges consecutive same-role turns', () => {
    expect(
      toBrainMessages([
        { role: 'human', kind: 'message', body: 'a' },
        { role: 'human', kind: 'message', body: 'b' },
      ]),
    ).toEqual([{ role: 'user', content: 'a\n\nb' }]);
  });

  it('prepends a synthetic user turn when a question thread leads with assistant', () => {
    const out = toBrainMessages([
      { role: 'orchestrator', kind: 'question', body: 'Re-enable x?' },
      { role: 'human', kind: 'message', body: 'yes' },
    ]);
    expect(out[0]!.role).toBe('user');
    expect(out[1]).toEqual({ role: 'assistant', content: 'Re-enable x?' });
    expect(out[2]).toEqual({ role: 'user', content: 'yes' });
  });
});

describe('runOrchestratorBrain', () => {
  it('runs a tool then returns the final text (multi-turn)', async () => {
    const { client, calls } = fakeClient([
      {
        content: [{ type: 'tool_use', id: 'tu1', name: 'get_fleet_status', input: {} }],
        stop_reason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'Fleet is healthy.' }], stop_reason: 'end_turn' },
    ]);
    const usages: number[] = [];
    const result = await runOrchestratorBrain({
      client,
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: "what's the fleet status?" }],
      toolCtx,
      dispatch: async () => ({ ok: true, agents: [] }),
      onUsage: () => usages.push(1),
    });
    expect(result.reply).toBe('Fleet is healthy.');
    expect(result.turns).toBe(2);
    expect(result.hitCap).toBe(false);
    expect(result.toolCalls.map((t) => t.name)).toEqual(['get_fleet_status']);
    expect(calls()).toBe(2);
    expect(usages.length).toBe(2); // recorded per turn
  });

  it('returns immediately when the model answers without tools', async () => {
    const { client } = fakeClient([
      { content: [{ type: 'text', text: 'Hello.' }], stop_reason: 'end_turn' },
    ]);
    const result = await runOrchestratorBrain({
      client,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      toolCtx,
    });
    expect(result.reply).toBe('Hello.');
    expect(result.turns).toBe(1);
    expect(result.hitCap).toBe(false);
  });

  it('a tool error becomes an is_error tool_result and the loop continues (no throw)', async () => {
    const { client } = fakeClient([
      {
        content: [{ type: 'tool_use', id: 'tu1', name: 'disable_agent', input: { agent: 'x' } }],
        stop_reason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'Could not disable; surfaced the error.' }], stop_reason: 'end_turn' },
    ]);
    const result = await runOrchestratorBrain({
      client,
      model: 'm',
      messages: [{ role: 'user', content: 'disable x' }],
      toolCtx,
      dispatch: async () => {
        throw new Error('db down');
      },
    });
    expect(result.reply).toContain('surfaced');
    expect(result.hitCap).toBe(false);
  });

  it('hits the turn cap gracefully (never throws) when the model never stops', async () => {
    const { client, calls } = fakeClient([
      {
        content: [{ type: 'tool_use', id: 'tu', name: 'get_fleet_status', input: {} }],
        stop_reason: 'tool_use',
      },
    ]);
    const result = await runOrchestratorBrain({
      client,
      model: 'm',
      messages: [{ role: 'user', content: 'loop forever' }],
      toolCtx,
      maxTurns: 3,
      dispatch: async () => ({ ok: true }),
    });
    expect(result.hitCap).toBe(true);
    expect(result.turns).toBe(3);
    expect(result.reply).toMatch(/step limit/i);
    expect(calls()).toBe(3);
  });

  it('cannot invoke a tool outside the allowlist (hallucinated approve_niche errors out)', async () => {
    const { client } = fakeClient([
      {
        content: [{ type: 'tool_use', id: 'tu', name: 'approve_niche', input: { id: '1' } }],
        stop_reason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'I cannot approve niches.' }], stop_reason: 'end_turn' },
    ]);
    // Uses the REAL default dispatch — approve_niche has no executor, so it throws.
    const result = await runOrchestratorBrain({
      client,
      model: 'm',
      messages: [{ role: 'user', content: 'approve niche 1' }],
      toolCtx: { threadId: 't', env: {} },
    });
    expect(result.reply).toBe('I cannot approve niches.');
  });
});

describe('dispatchOrchestratorTool', () => {
  it('throws for a name with no executor (the allowlist is the boundary)', async () => {
    await expect(
      dispatchOrchestratorTool('promote_site_to_live', {}, { threadId: 't', env: {} }),
    ).rejects.toThrow(/unknown tool/);
  });
});
