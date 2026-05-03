import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BaseAgent, type AgentContext } from '../base.js';
import { ContentEngineInput, ContentEngineOutput } from './schema.js';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { ContentBundle } from '@leadlandlord/shared/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, 'system.md'), 'utf-8');

export class ContentEngine extends BaseAgent<typeof ContentEngineInput, typeof ContentEngineOutput> {
  constructor() {
    super({
      name: 'content-engine',
      inputSchema: ContentEngineInput,
      outputSchema: ContentEngineOutput,
      dedupeKeyFn: (i) => `${i.site_id}:${i.fast_mode ? 'fast' : 'full'}`,
      defaultDailyCapUsd: 10,
    });
  }

  protected async execute(
    input: ContentEngineInput,
    ctx: AgentContext,
  ): Promise<ContentEngineOutput> {
    const client = getAnthropicClient();
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    const userPrompt = buildUserPrompt(input);

    ctx.log.info({ model, fast_mode: !!input.fast_mode }, 'requesting content bundle from claude');

    const response = await client.messages.create({
      model,
      max_tokens: 16_000,
      temperature: 0.7,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const usage = response.usage;
    const cost = estimateCostUsd(model, {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    });
    ctx.recordUsage({
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cost_usd: cost,
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('');

    const json = extractJson(text);
    const parsed = ContentBundle.parse(json);
    return parsed;
  }
}

function buildUserPrompt(input: ContentEngineInput): string {
  const businessName =
    input.business_name ?? `${capitalize(input.city)} ${capitalize(input.niche)} Pros`;
  return `Generate a complete content bundle for a local lead-gen website.

niche: ${input.niche}
city: ${input.city}
state: ${input.state}
business_name: ${businessName}
fast_mode: ${input.fast_mode ? 'true (use abbreviated page targets)' : 'false (full bundle)'}

Output ONLY the JSON object — no preamble, no commentary, no fenced code block.`;
}

function extractJson(text: string): unknown {
  // Tolerant of fenced code blocks even though we asked it not to fence.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenceMatch ? fenceMatch[1] : text;
  if (!raw) throw new Error('Content engine returned empty response');
  return JSON.parse(raw.trim());
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { ContentEngineInput, ContentEngineOutput } from './schema.js';
