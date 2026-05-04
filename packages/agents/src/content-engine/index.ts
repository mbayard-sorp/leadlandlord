import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BaseAgent, type AgentContext } from '../base';
import { ContentEngineInput, ContentEngineOutput } from './schema';
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

    ctx.log.info({ model, fast_mode: !!input.fast_mode }, 'requesting content bundle from claude (streaming)');

    // Stream the response to avoid HTTP-level timeouts on long generations.
    // The Content Engine produces ~6-10K output tokens which can take 4-8
    // minutes wall-clock; non-streaming requests get killed by intermediate
    // proxies after ~5min. Anthropic SDK aggregates the stream into a final
    // message we can use just like a non-streaming response.
    const stream = client.messages.stream({
      model,
      max_tokens: 16_000,
      temperature: 0.7,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
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

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('');

    const raw = extractJson(text);
    const normalized = normalizeBundle(raw, input);
    const parsed = ContentBundle.parse(normalized);
    return parsed;
  }
}

/**
 * Defensive post-processing on the model's JSON before strict Zod validation.
 *
 * The model is generally good but not perfect — meta_descriptions sometimes
 * run a few chars over 160, and `generated_at` is occasionally missing. Rather
 * than retry the whole content gen for a trivial fix, we patch up here.
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
  for (const key of ['services', 'service_areas', 'blog_posts'] as const) {
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

export { ContentEngineInput, ContentEngineOutput } from './schema';
