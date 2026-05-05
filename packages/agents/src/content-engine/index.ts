import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { BaseAgent, type AgentContext } from '../base';
import { ContentEngineInput, ContentEngineOutput } from './schema';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { ContentBundle } from '@leadlandlord/shared/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, 'system.md'), 'utf-8');

/**
 * JSON Schema generated from the Zod ContentBundle. Anthropic's tool use
 * mode constrains the model to output JSON that matches this schema exactly,
 * eliminating the unparsable-JSON failures we were hitting at 30K+ token
 * outputs (unescaped quotes inside long mdx content, missing colons, etc.).
 *
 * `target: 'jsonSchema7'` produces a schema Anthropic understands. We don't
 * pass strict mode because the model needs flexibility to fill defaults.
 */
const TOOL_INPUT_SCHEMA = zodToJsonSchema(ContentBundle, {
  target: 'jsonSchema7',
  $refStrategy: 'none', // inline refs — Anthropic's tool schema doesn't follow $ref reliably
}) as Record<string, unknown>;

const OUTPUT_TOOL_NAME = 'output_content_bundle';

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

    ctx.log.info({ model, fast_mode: !!input.fast_mode }, 'requesting content bundle from claude (tool use)');

    // Tool use mode — the model is constrained to invoke output_content_bundle
    // with input matching the JSON schema. This guarantees parseable JSON
    // even at 30K+ token outputs, replacing the previous text+jsonrepair
    // approach that struggled with long mdx strings.
    //
    // Streaming so the connection stays alive through the full ~5min run;
    // intermediate proxies otherwise close idle HTTPS connections.
    const stream = client.messages.stream({
      model,
      max_tokens: 32_000,
      temperature: 0.2,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      tools: [
        {
          name: OUTPUT_TOOL_NAME,
          description:
            'Output the complete content bundle for the website. Call this exactly once with the full bundle.',
          input_schema: TOOL_INPUT_SCHEMA as never,
        },
      ],
      tool_choice: { type: 'tool', name: OUTPUT_TOOL_NAME },
      messages: [{ role: 'user', content: userPrompt }],
    });
    const response = await stream.finalMessage();

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

    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> =>
        block.type === 'tool_use' && block.name === OUTPUT_TOOL_NAME,
    );
    if (!toolUse) {
      throw new Error(
        `Content engine: model did not invoke ${OUTPUT_TOOL_NAME}. ` +
          `Stop reason: ${response.stop_reason}.`,
      );
    }

    const normalized = normalizeBundle(toolUse.input, input);
    const parsed = ContentBundle.parse(normalized);
    return parsed;
  }
}

/**
 * Defensive post-processing on the model's tool input before strict Zod
 * validation. Even with tool use, the model may omit defaultable fields or
 * occasionally emit a meta_description a few chars over 160. Rather than
 * retry the whole content gen for a trivial fix, we patch up here.
 */
function normalizeBundle(raw: unknown, input: ContentEngineInput): unknown {
  if (raw == null || typeof raw !== 'object') return raw;
  const bundle = raw as Record<string, unknown>;
  if (!bundle.generated_at) {
    bundle.generated_at = new Date().toISOString();
  }
  bundle.niche ??= input.niche;
  bundle.city ??= input.city;
  bundle.state ??= input.state.toUpperCase();
  bundle.business_name ??= input.business_name ?? `${input.city} ${input.niche} Pros`;
  // Defensive defaults: if the model omits these we still want a valid bundle.
  if (!['classic', 'modern', 'premium', 'bright'].includes(bundle.variant as string)) {
    bundle.variant = 'classic';
  }
  if (!Array.isArray(bundle.nearby_cities)) {
    bundle.nearby_cities = [];
  }
  if (!Array.isArray(bundle.trust_signals) || bundle.trust_signals.length === 0) {
    bundle.trust_signals = ['Licensed & insured', 'Free quotes', 'Same-week service'];
  }
  if (!Array.isArray(bundle.info_pages)) {
    bundle.info_pages = [];
  }

  for (const key of ['home', 'about', 'contact'] as const) {
    if (bundle[key]) bundle[key] = trimPage(bundle[key]);
  }
  for (const key of ['services', 'service_areas', 'blog_posts', 'info_pages'] as const) {
    const arr = bundle[key];
    if (Array.isArray(arr)) {
      bundle[key] = arr.map(trimPage);
    }
  }
  return bundle;
}

function trimPage(p: unknown): unknown {
  if (p == null || typeof p !== 'object') return p;
  const page = p as Record<string, unknown>;
  if (typeof page.meta_description === 'string' && page.meta_description.length > 160) {
    page.meta_description = page.meta_description.slice(0, 157).trimEnd() + '…';
  }
  if (typeof page.title === 'string' && page.title.length > 70) {
    page.title = page.title.slice(0, 67).trimEnd() + '…';
  }
  return page;
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

Invoke the ${OUTPUT_TOOL_NAME} tool exactly once with the full bundle. Do not return prose — only the tool call.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { ContentEngineInput, ContentEngineOutput } from './schema';
