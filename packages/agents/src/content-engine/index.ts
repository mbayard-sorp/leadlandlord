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
    const clusterCount = input.keyword_clusters?.length ?? 0;
    ctx.progress({
      label: `sending prompt to Claude (${clusterCount} clusters, ${input.fast_mode ? 'fast' : 'full'} mode)`,
    });

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

    // Tap the stream for token-level progress. Tool-use mode emits
    // inputJson deltas (not text deltas) — count chars off the partial_json
    // fragment. The throttle in BaseAgent collapses these into ~1 update per
    // second regardless of stream rate.
    let streamedChars = 0;
    stream.on('inputJson', (partialJson: string) => {
      streamedChars += partialJson.length;
      ctx.progress({
        label: `receiving content from Claude (${Math.round(streamedChars / 1024)} KB streamed)`,
      });
    });
    const response = await stream.finalMessage();
    ctx.progress({ label: 'validating content bundle' });

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

    // Coverage check — every input cluster must be claimed by some page.
    const coverage = checkClusterCoverage(parsed, input.keyword_clusters ?? []);
    if (coverage.missing.length > 0) {
      const missRate = coverage.missing.length / input.keyword_clusters.length;
      ctx.log.warn(
        {
          total: input.keyword_clusters.length,
          missing: coverage.missing.length,
          missRate: Number(missRate.toFixed(2)),
          missingKeys: coverage.missing.slice(0, 10),
        },
        'cluster coverage gaps detected',
      );
      // Hard fail when miss rate is too high — Claude likely misunderstood
      // the contract; retry-with-context would help, deferred to Phase 2.
      if (missRate > 0.2) {
        throw new Error(
          `cluster coverage too low: ${coverage.missing.length}/${input.keyword_clusters.length} clusters not covered. Missing: ${coverage.missing.slice(0, 5).join(', ')}`,
        );
      }
    }
    return parsed;
  }
}

interface CoverageReport {
  covered: string[];
  missing: string[];
}

function checkClusterCoverage(
  bundle: ContentBundle,
  clusters: ContentEngineInput['keyword_clusters'],
): CoverageReport {
  if (!clusters || clusters.length === 0) {
    return { covered: [], missing: [] };
  }
  const allPages = collectAllPages(bundle);
  const claimed = new Set<string>();
  for (const p of allPages) {
    if (p.cluster_key) claimed.add(p.cluster_key);
  }
  const covered: string[] = [];
  const missing: string[] = [];
  for (const c of clusters) {
    if (claimed.has(c.cluster_key)) covered.push(c.cluster_key);
    else missing.push(c.cluster_key);
  }
  return { covered, missing };
}

function collectAllPages(bundle: ContentBundle): ContentBundle['home'][] {
  const pages: ContentBundle['home'][] = [];
  if (bundle.home) pages.push(bundle.home);
  if (bundle.about) pages.push(bundle.about);
  if (bundle.contact) pages.push(bundle.contact);
  for (const arr of [bundle.services, bundle.service_areas, bundle.blog_posts, bundle.info_pages]) {
    if (Array.isArray(arr)) pages.push(...arr);
  }
  return pages;
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
  const clusterTable = renderClusterTable(input.keyword_clusters);
  const clusterSection = clusterTable
    ? `\n\nKEYWORD CLUSTERS — TARGETING REQUIREMENT:\nYou are given ${input.keyword_clusters.length} pre-planned keyword clusters from real search-volume data. EACH CLUSTER MUST BE TARGETED BY EXACTLY ONE PAGE. The page's H1, slug, meta_description, and first 100 words of body must include the cluster's primary_keyword verbatim. Each page must declare \`cluster_key\`, \`primary_keyword\`, and \`targeted_keywords\` fields. Match cluster.page_kind to the page kind you choose.\n\n${clusterTable}`
    : '\n\nNo pre-planned keyword clusters. Generate copy using best-practice local SEO patterns for the niche × city.';
  return `Generate a complete content bundle for a local lead-gen website.

niche: ${input.niche}
city: ${input.city}
state: ${input.state}
business_name: ${businessName}
fast_mode: ${input.fast_mode ? 'true (use abbreviated page targets)' : 'false (full bundle)'}${clusterSection}

Invoke the ${OUTPUT_TOOL_NAME} tool exactly once with the full bundle. Do not return prose — only the tool call.`;
}

function renderClusterTable(clusters: ContentEngineInput['keyword_clusters']): string {
  if (!clusters || clusters.length === 0) return '';
  const lines = clusters.map(
    (c) =>
      `- cluster_key="${c.cluster_key}" page_kind=${c.page_kind} intent=${c.intent} primary="${c.primary_keyword}" supporting=[${(c.supporting_keywords ?? []).slice(0, 6).join(', ')}] vol=${c.search_volume}`,
  );
  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { ContentEngineInput, ContentEngineOutput } from './schema';
