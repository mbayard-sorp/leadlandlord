import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { BaseAgent, type AgentContext } from '../base';
import { ContentEngineInput, ContentEngineOutput } from './schema';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { ContentBundle, Page } from '@leadlandlord/shared/types';
import { getTrustSignals } from './trust-signal-pool';
import { getHeadlineTemplate } from './headline-templates';
import { lintBundle } from './density-lint';
import { injectInternalLinks } from './internal-linker';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, 'system.md'), 'utf-8');

/**
 * Maps theme keys to overlay markdown filenames in `niches/`. The overlay is
 * appended to the base system prompt at runtime so the model gets niche-
 * specific terminology, seasonality, regulations, pain points, and tone for
 * the chosen variant.
 */
const THEME_TO_OVERLAY: Record<string, string> = {
  classic: 'trades',
  modern: 'modern',
  premium: 'premium',
  bright: 'bright',
  haul: 'haul',
  counsel: 'counsel',
};

const overlayCache = new Map<string, string | null>();

/**
 * Synchronously read and cache the niche overlay for the given theme key.
 * Returns null when the theme key is not one of the four known variants or
 * the overlay file is missing — the caller falls back to the base prompt.
 */
export function loadNicheOverlay(themeKey: string): string | null {
  if (overlayCache.has(themeKey)) return overlayCache.get(themeKey) ?? null;
  const slug = THEME_TO_OVERLAY[themeKey];
  if (!slug) {
    overlayCache.set(themeKey, null);
    return null;
  }
  try {
    const content = readFileSync(resolve(__dirname, 'niches', `${slug}.md`), 'utf-8');
    overlayCache.set(themeKey, content);
    return content;
  } catch {
    overlayCache.set(themeKey, null);
    return null;
  }
}

/**
 * Compose the system prompt: base + (optional) overlay separated by an
 * `---` divider. Cache control on the system block still works because the
 * structure is unchanged — only the text content varies by theme.
 */
export function composeSystemPrompt(themeKey: string | undefined): string {
  if (!themeKey) return SYSTEM_PROMPT;
  const overlay = loadNicheOverlay(themeKey);
  if (!overlay) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\n---\n\n${overlay}`;
}

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

/**
 * Recursively walk a JSON Schema object and inject `enum: clusterSlugs` on
 * every string property named `cluster_key`. Used to constrain Claude's
 * tool-use output so it can only emit cluster_key values that exist in the
 * runtime input table — closing the paraphrasing gap that historically
 * caused cluster-coverage rejections (see docs/cluster-coverage-fix-plan.md
 * Fix 1). Pure / mutates the schema object in place.
 *
 * No-op when `clusterSlugs` is empty (an empty `enum` is invalid JSON Schema
 * and the niche may legitimately have zero clusters in legacy flows).
 */
export function decorateSchemaWithClusterEnum(
  schema: unknown,
  clusterSlugs: readonly string[],
): void {
  if (clusterSlugs.length === 0) return;
  if (schema == null || typeof schema !== 'object') return;
  if (Array.isArray(schema)) {
    for (const item of schema) decorateSchemaWithClusterEnum(item, clusterSlugs);
    return;
  }
  const obj = schema as Record<string, unknown>;
  const properties = obj.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    const props = properties as Record<string, unknown>;
    const ck = props.cluster_key;
    if (ck && typeof ck === 'object' && !Array.isArray(ck)) {
      const ckObj = ck as Record<string, unknown>;
      if (ckObj.type === 'string') {
        ckObj.enum = [...clusterSlugs];
      }
    }
  }
  // Recurse into every value so we hit nested objects, items, anyOf/oneOf,
  // additionalProperties, etc. without enumerating JSON Schema keywords.
  for (const value of Object.values(obj)) {
    decorateSchemaWithClusterEnum(value, clusterSlugs);
  }
}

const OUTPUT_TOOL_NAME = 'output_content_bundle';

/**
 * Flat per-stream ceiling used when running off-lambda (e.g. scripts/finish-site.ts)
 * where the Vercel 800s worker ceiling does NOT apply. Explicitly setting this
 * env var disables the shared deadline logic so large bundles can run initial +
 * retry to completion uncapped.
 *
 * When the env var is NOT set (the normal on-lambda path), the shared deadline
 * governs instead and STREAM_TIMEOUT_MS acts as an upper bound per stream
 * within whatever budget remains.
 *
 * Default: 600s, which still fits a single stream on lambda with ~200s of
 * headroom before the 800s Vercel ceiling.
 */
const STREAM_TIMEOUT_MS = Number(process.env.CONTENT_ENGINE_STREAM_TIMEOUT_MS) || 600_000;

/**
 * Whether we are running under an explicit off-lambda override. When true the
 * shared deadline is disabled and every stream gets the flat STREAM_TIMEOUT_MS.
 */
const OFF_LAMBDA_OVERRIDE = process.env.CONTENT_ENGINE_STREAM_TIMEOUT_MS !== undefined;

/**
 * Shared build deadline for on-lambda runs.
 *
 * Budget math (all times in ms):
 *   Vercel maxDuration:          800 000  (apps/operator/app/api/cron/agent/[name]/route.ts:16)
 *   Overhead (lint + normalise
 *   + Sanity persist + setup):  -  60 000
 *   Available for streams:       740 000
 *
 * With a 30s floor check before each stream start, two back-to-back streams of
 * up to ~355s each fit inside the 740s envelope with room to spare. The flat
 * STREAM_TIMEOUT_MS=600s cap further limits any single stream, so the worst
 * realistic path is initial(600) + retry is blocked by deadline check ~= safe.
 *
 * Initialised once per module load. Each execute() call reads the same epoch
 * value so multiple concurrent runs on the same lambda instance share the same
 * wall-clock deadline — acceptable because Vercel kills the whole instance at
 * maxDuration regardless of which run is "in progress".
 *
 * Off-lambda: set to Infinity so min(STREAM_TIMEOUT_MS, Infinity - now) always
 * resolves to STREAM_TIMEOUT_MS (the flat cap).
 */
let _buildDeadlineAt: number = OFF_LAMBDA_OVERRIDE ? Infinity : Date.now() + 740_000;

/**
 * Reset the shared deadline at the start of each execute() call. Necessary
 * because the module may be reused across warm lambda invocations — each new
 * agent run must get a fresh 740s window anchored to its own start time.
 * No-op when OFF_LAMBDA_OVERRIDE is true (deadline stays Infinity).
 */
function resetBuildDeadline(): void {
  if (!OFF_LAMBDA_OVERRIDE) {
    _buildDeadlineAt = Date.now() + 740_000;
  }
}

/**
 * Race `p` against a timeout computed from whichever is tighter:
 *   - the flat STREAM_TIMEOUT_MS ceiling, or
 *   - the remaining time before the shared build deadline minus a 30s buffer.
 *
 * If the remaining budget is already below 30s, throws immediately with a
 * clear "insufficient time budget" message so the run fails cleanly instead
 * of starting a stream that the Vercel ceiling will kill mid-way.
 *
 * When OFF_LAMBDA_OVERRIDE is true (explicit env var set), `deadlineAt` is
 * Infinity and the flat STREAM_TIMEOUT_MS applies without modification.
 *
 * @param p          - The promise to race (a stream.finalMessage() call).
 * @param phase      - Label used in timeout error messages.
 * @param deadlineAt - Optional override epoch ms; when omitted (undefined)
 *                     defaults to the module-level _buildDeadlineAt (the shared
 *                     on-lambda budget). Pass Infinity to opt OUT of the shared
 *                     deadline for standalone one-shot calls (longform), where
 *                     the stale module-level anchor would otherwise apply.
 */
async function withStreamTimeout<T>(
  p: Promise<T>,
  phase: string,
  deadlineAt?: number,
): Promise<T> {
  const deadline = deadlineAt ?? _buildDeadlineAt;
  const FLOOR_MS = 30_000; // minimum budget required to even attempt a stream
  const remaining = deadline - Date.now();

  if (remaining < FLOOR_MS) {
    throw new Error(
      `content-engine ${phase} stream aborted: insufficient time budget remaining ` +
        `(${Math.round(remaining / 1000)}s < ${FLOOR_MS / 1000}s floor)`,
    );
  }

  const effectiveTimeout = Math.min(STREAM_TIMEOUT_MS, remaining - FLOOR_MS);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `content-engine ${phase} stream timed out after ${Math.round(effectiveTimeout / 1000)}s`,
          ),
        ),
      effectiveTimeout,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
    // Anchor the shared build deadline to this run's start time. Must be the
    // very first statement so all withStreamTimeout calls below see a fresh
    // 740s window regardless of lambda warm-reuse.
    resetBuildDeadline();

    const client = getAnthropicClient();
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    // Pre-select hygiene pool values so Claude works within chosen templates
    const trustSignals = getTrustSignals(input.site_id, input.theme ?? 'classic', 4);
    const headlineTemplate = getHeadlineTemplate(input.site_id, input.theme ?? 'classic');

    const userPrompt = buildUserPrompt(input, { trustSignals, headlineTemplate });
    const systemPrompt = composeSystemPrompt(input.theme);

    // Per-call clone of the tool schema with cluster_key enum constraints
    // injected. Anthropic enforces enum on string fields server-side, so a
    // paraphrased slug like `blog-foundation-repair` (when the input had
    // `blog-foundation-repair-cost-austin`) will be rejected before the
    // tool_use block is even emitted — the model is forced to pick from the
    // input list. Deep-clone the prebuilt base schema so we don't mutate the
    // module-level constant across calls.
    const clusterSlugs = (input.keyword_clusters ?? []).map((c) => c.cluster_key);
    const toolInputSchema = JSON.parse(JSON.stringify(TOOL_INPUT_SCHEMA)) as Record<string, unknown>;
    decorateSchemaWithClusterEnum(toolInputSchema, clusterSlugs);

    ctx.log.info(
      { model, fast_mode: !!input.fast_mode, theme: input.theme ?? null, overlay: input.theme ? !!loadNicheOverlay(input.theme) : false },
      'requesting content bundle from claude (tool use)',
    );
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
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      tools: [
        {
          name: OUTPUT_TOOL_NAME,
          description:
            'Output the complete content bundle for the website. Call this exactly once with the full bundle.',
          input_schema: toolInputSchema as never,
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
    const response = await withStreamTimeout(stream.finalMessage(), 'initial');
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
    let parsed = ContentBundle.parse(normalized);

    // Neighborhoods expansion: the LLM emits neighborhood names in thin mode.
    // Post-LLM we wrap each name in a Google Maps search URL.
    if (input.site_mode === 'thin' && Array.isArray((normalized as Record<string, unknown>).neighborhood_names)) {
      const names = (normalized as Record<string, unknown>).neighborhood_names as string[];
      parsed = {
        ...parsed,
        neighborhoods: names.map((name) => ({
          name,
          google_maps_url: `https://www.google.com/maps/search/${encodeURIComponent(`${name} ${input.city} ${input.state}`)}`,
        })),
      };
    } else if (parsed.neighborhoods.length > 0 && parsed.neighborhoods[0]?.google_maps_url === '') {
      // Defensive: if model emitted neighborhood objects without URLs, backfill
      parsed = {
        ...parsed,
        neighborhoods: parsed.neighborhoods.map((n) => ({
          ...n,
          google_maps_url: n.google_maps_url || `https://www.google.com/maps/search/${encodeURIComponent(`${n.name} ${input.city} ${input.state}`)}`,
        })),
      };
    }

    // Density lint — check all pages. On error violations, retry once.
    const primaryKeyword = input.keyword_clusters[0]?.primary_keyword ?? input.niche;
    ctx.progress({ label: 'running density lint' });
    let lintResults = lintBundle(parsed, { primaryKeyword, clusters: input.keyword_clusters });
    const errorPages = lintResults.filter((r) => r.violations.some((v) => v.severity === 'error'));
    if (errorPages.length > 0) {
      ctx.log.warn(
        { errorPages: errorPages.map((r) => ({ slug: r.pageSlug, count: r.violations.filter((v) => v.severity === 'error').length })) },
        'density lint errors detected — retrying LLM once',
      );
      // Build violation annotation for retry
      const violationSummary = errorPages
        .map((r) => `Page ${r.pageSlug}:\n${r.violations.filter((v) => v.severity === 'error').map((v) => `  [${v.rule}] ${v.detail}`).join('\n')}`)
        .join('\n\n');

      const retryUserPrompt = `${buildUserPrompt(input, { trustSignals, headlineTemplate })}

## DENSITY LINT VIOLATIONS FROM PREVIOUS ATTEMPT — FIX THESE:
${violationSummary}

Re-generate the full bundle fixing all listed violations.

CRITICAL — DO NOT DROP CLUSTER ASSIGNMENTS:
Every cluster_key listed in the keyword clusters table above must still be targeted by exactly one page in your retry output. Each page that targeted a cluster previously must keep its cluster_key and primary_keyword fields. Fix violations by rewriting content, not by removing pages or stripping cluster targeting.

Invoke ${OUTPUT_TOOL_NAME} exactly once.`;

      ctx.progress({ label: 'retrying content generation (density lint fix)' });
      // Reset streamedChars so the retry KB metric reflects only the retry,
      // not initial+retry combined.
      streamedChars = 0;
      const retryStream = client.messages.stream({
        model,
        // Bumped from 32k → 48k: the retry prompt appends violation context on
        // top of the original, so the model needs headroom to emit the full
        // bundle without hitting the cap. Sonnet 4.x supports up to 64k output.
        max_tokens: 48_000,
        temperature: 0.2,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        tools: [
          {
            name: OUTPUT_TOOL_NAME,
            description: 'Output the complete content bundle for the website. Call this exactly once with the full bundle.',
            input_schema: toolInputSchema as never,
          },
        ],
        tool_choice: { type: 'tool', name: OUTPUT_TOOL_NAME },
        messages: [{ role: 'user', content: retryUserPrompt }],
      });
      retryStream.on('inputJson', (partialJson: string) => {
        streamedChars += partialJson.length;
        ctx.progress({ label: `retry: receiving content from Claude (${Math.round(streamedChars / 1024)} KB)` });
      });
      const retryResponse = await withStreamTimeout(retryStream.finalMessage(), 'density-lint-retry');
      const retryUsage = retryResponse.usage;
      ctx.recordUsage({
        model,
        input_tokens: retryUsage.input_tokens,
        output_tokens: retryUsage.output_tokens,
        cache_read_input_tokens: retryUsage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: retryUsage.cache_creation_input_tokens ?? 0,
        cost_usd: estimateCostUsd(model, {
          input_tokens: retryUsage.input_tokens,
          output_tokens: retryUsage.output_tokens,
          cache_read_input_tokens: retryUsage.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: retryUsage.cache_creation_input_tokens ?? 0,
        }),
      });
      const retryToolUse = retryResponse.content.find(
        (block): block is Extract<typeof block, { type: 'tool_use' }> =>
          block.type === 'tool_use' && block.name === OUTPUT_TOOL_NAME,
      );
      if (!retryToolUse) {
        throw new Error(`density lint retry: model did not invoke ${OUTPUT_TOOL_NAME}. Stop: ${retryResponse.stop_reason}`);
      }
      const retryNormalized = normalizeBundle(retryToolUse.input, input);
      parsed = ContentBundle.parse(retryNormalized);
      lintResults = lintBundle(parsed, { primaryKeyword });
      const retryErrors = lintResults.filter((r) => r.violations.some((v) => v.severity === 'error'));
      if (retryErrors.length > 0) {
        throw new Error(
          `density lint failed after retry. Violations:\n${retryErrors.map((r) => `${r.pageSlug}: ${r.violations.map((v) => v.detail).join('; ')}`).join('\n')}`,
        );
      }
    }

    // Internal linker — inject deterministic cross-page links.
    ctx.progress({ label: 'injecting internal links' });
    parsed = injectInternalLinks(parsed);

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
        ctx.log.warn(
          {
            rejectedBundle: parsed,
            missing: coverage.missing,
            covered: coverage.covered.length,
            total: input.keyword_clusters.length,
          },
          'cluster coverage rejection — bundle persisted to log',
        );
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
  for (const arr of [bundle.services, bundle.service_areas, bundle.blog_posts, bundle.info_pages, bundle.faq_pages]) {
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
  if (!Array.isArray(bundle.faq_pages)) {
    bundle.faq_pages = [];
  }
  if (!Array.isArray(bundle.neighborhoods)) {
    bundle.neighborhoods = [];
  }
  // Stamp when the long-form intro was produced so the operator + render layer
  // can show freshness without re-deriving it.
  if (
    typeof bundle.longform_body === 'string' &&
    bundle.longform_body.trim().length > 0 &&
    !bundle.longform_generated_at
  ) {
    bundle.longform_generated_at = new Date().toISOString();
  }

  // Defensive parse for page arrays. Claude occasionally serializes one of
  // services/service_areas/blog_posts/info_pages as a JSON-encoded string
  // (esp. on long content bundles). JSON.parse first, fall back to empty
  // array. Hit 2026-05-08 on foundation repair build: blog_posts came back
  // as a string and zod rejected the bundle, costing $0.51 per failed
  // content-engine retry.
  for (const key of ['services', 'service_areas', 'blog_posts', 'info_pages', 'faq_pages'] as const) {
    const v = bundle[key];
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        bundle[key] = Array.isArray(parsed) ? parsed : [];
      } catch {
        bundle[key] = [];
      }
    } else if (!Array.isArray(v)) {
      bundle[key] = [];
    }
  }

  // Coerce stringized Page fields back into Page objects. Observed in prod:
  // model occasionally emits e.g. `contact` as a markdown string rather than
  // the full Page shape. Zod then throws path:["contact"] expected object,
  // which the dispatcher classifies as terminal validation_error → dead-letter
  // on first attempt with no retry. Hit on site 11995865 (deck building /
  // Medford, OR). Independent of cluster count; can recur on any build.
  const singletonKindMap = { home: 'home', about: 'about', contact: 'contact' } as const;
  for (const key of ['home', 'about', 'contact'] as const) {
    bundle[key] = coercePage(bundle[key], { kind: singletonKindMap[key], slug: key });
  }
  const arrayKindMap = {
    services: 'service',
    service_areas: 'service_area',
    blog_posts: 'blog',
    info_pages: 'info',
    faq_pages: 'faq',
  } as const;
  for (const key of ['services', 'service_areas', 'blog_posts', 'info_pages', 'faq_pages'] as const) {
    const arr = bundle[key];
    if (Array.isArray(arr)) {
      bundle[key] = arr.map((el, idx) =>
        coercePage(el, { kind: arrayKindMap[key], slug: `${arrayKindMap[key]}-${idx + 1}` }),
      );
    }
  }

  for (const key of ['home', 'about', 'contact'] as const) {
    if (bundle[key]) bundle[key] = trimPage(bundle[key]);
  }
  for (const key of ['services', 'service_areas', 'blog_posts', 'info_pages', 'faq_pages'] as const) {
    const arr = bundle[key];
    if (Array.isArray(arr)) {
      bundle[key] = arr.map(trimPage);
    }
  }
  return bundle;
}

/**
 * If the model emitted a Page-typed field as a string (or other non-object),
 * coerce it into a minimum-viable Page so ContentBundle.parse doesn't throw a
 * terminal validation_error. Strings are treated as the page body (mdx);
 * required Page fields are backfilled with sensible defaults. If the value is
 * already an object, pass it through untouched (later validation handles it).
 */
function coercePage(
  value: unknown,
  defaults: { kind: 'home' | 'about' | 'contact' | 'service' | 'service_area' | 'blog' | 'info' | 'faq'; slug: string },
): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const mdx = typeof value === 'string' ? value : '';
  const title = defaults.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    kind: defaults.kind,
    slug: defaults.slug,
    title,
    meta_description: title.slice(0, 160),
    mdx,
    targeted_keywords: [],
    faqs: [],
  };
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
  if (typeof page.mdx === 'string') {
    page.mdx = sanitizePhoneLiterals(page.mdx);
  }
  return page;
}

/**
 * Scrub any literal phone-number patterns from MDX and replace with the
 * `{{phone}}` placeholder that the site-host renderer substitutes per-tenant.
 * The system prompt instructs the model to use `{{phone}}` directly, but
 * Sonnet still hallucinates fake numbers in body copy (most often
 * `(555) NNN-NNNN` or `NNN-NNN-NNNN`). Catching this at normalize time —
 * before density-lint, before Sanity persist — keeps fake numbers off
 * production sites without forcing a content-engine retry.
 *
 * Patterns matched (anchored to word boundaries to avoid eating
 * unrelated digits like prices or ZIPs):
 *   - `+1 NNN NNN NNNN` / `+1 (NNN) NNN-NNNN`
 *   - `(NNN) NNN-NNNN`
 *   - `NNN-NNN-NNNN` / `NNN.NNN.NNNN` / `NNN NNN NNNN`
 *   - Markdown `[label](tel:+...)` links — collapsed to just `{{phone}}`.
 */
export function sanitizePhoneLiterals(mdx: string): string {
  // 1. Markdown tel: links → `{{phone}}` (keep the surrounding label only if
  //    it isn't itself a phone number; otherwise drop entirely).
  let out = mdx.replace(/\[([^\]]*)\]\(tel:[^)]+\)/gi, (_match, label: string) => {
    if (PHONE_RE.test(label)) return '{{phone}}';
    return label.trim().length > 0 ? `${label} (call {{phone}})` : '{{phone}}';
  });
  // 2. Bare literal phone patterns.
  out = out.replace(PHONE_RE, '{{phone}}');
  // 3. Collapse accidental duplicates from steps 1/2 colliding.
  out = out.replace(/(\{\{phone\}\})(\s*\1)+/g, '{{phone}}');
  return out;
}

// Match common US phone formats. Anchored to a non-digit boundary on each
// side so we don't chew through price strings ("$1,234,567") or long ID
// numbers. Allows optional leading `+1` and various separator forms.
const PHONE_RE = /(?<![\d])(?:\+?1[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d])/g;

interface HygienePools {
  trustSignals: string[];
  headlineTemplate: string;
}

export function buildUserPrompt(input: ContentEngineInput, pools: HygienePools): string {
  const businessName =
    input.business_name ?? `${capitalize(input.city)} ${capitalize(input.niche)} Pros`;
  const clusterTable = renderClusterTable(input.keyword_clusters);
  const clusterSection = clusterTable
    ? `\n\nKEYWORD CLUSTERS — TARGETING REQUIREMENT:\nYou are given ${input.keyword_clusters.length} pre-planned keyword clusters from real search-volume data. EACH CLUSTER MUST BE TARGETED BY EXACTLY ONE PAGE. The page's H1, slug, meta_description, and first 100 words of body must include the cluster's primary_keyword verbatim. Each page must declare \`cluster_key\`, \`primary_keyword\`, and \`targeted_keywords\` fields. Match cluster.page_kind to the page kind you choose.\n\n${clusterTable}`
    : '\n\nNo pre-planned keyword clusters. Generate copy using best-practice local SEO patterns for the niche × city.';

  const brief = input.competitor_brief;
  const competitorSection = brief
    ? (() => {
        const bar = brief.structural_bar;
        const barParts: string[] = [`min_word_count=${bar.median_word_count}`];
        if (bar.has_faq) barParts.push('include FAQ section');
        if (bar.has_pricing) barParts.push('include pricing section');
        if (bar.has_reviews) barParts.push('include reviews section');

        const topicLines = brief.topic_coverage
          .sort((a, b) => b.prevalence - a.prevalence)
          .map((t) => `  - ${t.topic} (${Math.round(t.prevalence * 100)}% of competitors)`)
          .join('\n');

        const gapLines = brief.content_gaps.map((g) => `  - ${g}`).join('\n');

        const kwLines = brief.keyword_opportunities
          .slice(0, 10)
          .map((k) => `  - "${k.keyword}" vol=${k.volume} ranked_by=${k.ranked_by_competitors}`)
          .join('\n');

        const schemaLine = brief.schema_types.join(', ');
        const pageInvLine = brief.page_inventory.join(', ');

        return (
          `\n\nCOMPETITOR BRIEF - CLEAR THE INCUMBENTS' BAR:\n` +
          `Structural bar: ${barParts.join('; ')}\n` +
          `Topic coverage (must address all):\n${topicLines}\n` +
          `Content gaps (prioritize these, incumbents cover them poorly):\n${gapLines}\n` +
          `Keyword opportunities (work into copy naturally):\n${kwLines}\n` +
          `Schema types incumbents emit: ${schemaLine}\n` +
          `Page patterns incumbents use: ${pageInvLine}`
        );
      })()
    : '';

  const siteModeSection = input.site_mode === 'thin'
    ? `\nSITE MODE: thin. Generate ONLY: 1 home page (1,500-2,200 words), 1 services index, 4-6 service pages, 1 contact page, 3-5 FAQ blog posts. NO service-area pages. NO info pages. About page omitted unless business_name strongly suggests a specific identity.`
    : `\nSITE MODE: content_rich. Generate the full ~28-page bundle as specified in the system prompt.`;

  const hygiene = `\n\n## Chosen for this site (use these; do not substitute your own)
trust_signals: ${JSON.stringify(pools.trustSignals)}
h1_template: "${pools.headlineTemplate}" (fill {service}, {city}, {trust_signal} placeholders)`;

  return `Generate a complete content bundle for a local lead-gen website.

niche: ${input.niche}
city: ${input.city}
state: ${input.state}
business_name: ${businessName}
fast_mode: ${input.fast_mode ? 'true (use abbreviated page targets)' : 'false (full bundle)'}${siteModeSection}${hygiene}${clusterSection}${competitorSection}

Invoke the ${OUTPUT_TOOL_NAME} tool exactly once with the full bundle. Do not return prose — only the tool call.`;
}

// --- Long-form-only path ----------------------------------------------------
//
// Backfill / regenerate just the keyword-rich home intro without paying for a
// full 32K-token bundle generation. Used by the Site Builder's `longform_only`
// mode (operator "Generate long-form intro" button). Reuses the same Anthropic
// client + cost estimator + theme overlay composition as the full path.

const LONGFORM_TOOL_NAME = 'output_longform_intro';

const LONGFORM_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    longform_body: {
      type: 'string',
      description:
        'Keyword-rich markdown home intro (400–700 words). Subset: ##, ###, - bullets, **bold**, [text](url). No # H1, tables, images, or raw HTML.',
    },
  },
  required: ['longform_body'],
} as const;

export interface GenerateLongformInput {
  niche: string;
  city: string;
  state: string;
  business_name?: string;
  /** Theme key — selects the niche overlay appended to the system prompt. */
  theme?: string;
  keyword_clusters?: ContentEngineInput['keyword_clusters'];
}

export interface GenerateLongformResult {
  longform_body: string;
  generated_at: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  cost_usd: number;
}

export async function generateLongformBody(
  input: GenerateLongformInput,
): Promise<GenerateLongformResult> {
  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const businessName =
    input.business_name ?? `${capitalize(input.city)} ${capitalize(input.niche)} Pros`;
  const systemPrompt = composeSystemPrompt(input.theme);

  const homeCluster = (input.keyword_clusters ?? []).find((c) => c.page_kind === 'home');
  const clusterTable = renderClusterTable(input.keyword_clusters ?? []);
  const clusterSection = homeCluster
    ? `\n\nHOME KEYWORD CLUSTER (anchor the intro on this):\n- primary="${homeCluster.primary_keyword}" supporting=[${(homeCluster.supporting_keywords ?? []).slice(0, 8).join(', ')}]\n\nAll clusters for context:\n${clusterTable}`
    : '\n\nNo keyword clusters available — use best-practice local SEO phrasing for the niche × city.';

  const userPrompt = `Write ONLY the long-form home intro (\`longform_body\`) for a local lead-gen website. Follow the "Long-form home intro" section of your instructions exactly.

niche: ${input.niche}
city: ${input.city}
state: ${input.state}
business_name: ${businessName}${clusterSection}

Invoke the ${LONGFORM_TOOL_NAME} tool exactly once. Do not return prose.`;

  // Pass deadlineAt=Infinity: generateLongformBody runs as a standalone
  // one-shot call (e.g. SiteBuilder.runLongformOnly), NOT through
  // ContentEngine.execute(), so resetBuildDeadline() never re-anchors the
  // module-level _buildDeadlineAt. On a warm lambda that anchor is stale (set
  // at module load), so falling through to it via `undefined` would trip the
  // 30s floor with a wildly negative budget. Infinity opts out entirely; the
  // flat STREAM_TIMEOUT_MS still caps the single call.
  const response = await withStreamTimeout(
    client.messages.create({
      model,
      max_tokens: 3_000,
      temperature: 0.3,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: LONGFORM_TOOL_NAME,
          description: 'Output the keyword-rich long-form home intro. Call exactly once.',
          input_schema: LONGFORM_TOOL_SCHEMA as never,
        },
      ],
      tool_choice: { type: 'tool', name: LONGFORM_TOOL_NAME },
      messages: [{ role: 'user', content: userPrompt }],
    }),
    'longform',
    Infinity, // bypass the shared build deadline — standalone one-shot call
  );

  const toolUse = response.content.find(
    (block): block is Extract<typeof block, { type: 'tool_use' }> =>
      block.type === 'tool_use' && block.name === LONGFORM_TOOL_NAME,
  );
  const body =
    toolUse && typeof (toolUse.input as { longform_body?: unknown }).longform_body === 'string'
      ? ((toolUse.input as { longform_body: string }).longform_body).trim()
      : '';
  if (!body) {
    throw new Error(
      `Long-form generation: model did not return longform_body. Stop reason: ${response.stop_reason}.`,
    );
  }

  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
  };
  const cost_usd = estimateCostUsd(model, usage);

  return {
    longform_body: body,
    generated_at: new Date().toISOString(),
    model,
    usage,
    cost_usd,
  };
}

// --- FAQ-pages-only path ----------------------------------------------------
//
// Generate ONLY the standalone `faq_pages` for a site without paying for a full
// bundle generation. Used by `scripts/backfill-faq.ts` to retrofit FAQ pages
// onto sites built before the FAQ kind shipped, and reusable by any future
// "faq_only" site-builder mode. Reuses the same Anthropic client + cost
// estimator + theme overlay as the full path, so the model follows the
// "FAQ pages" section of system.md exactly.

const FAQ_TOOL_NAME = 'output_faq_pages';

const FAQ_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    faq_pages: {
      type: 'array',
      description: 'Standalone FAQ pages — ONE question per page. Title and slug ARE the question.',
      items: {
        type: 'object',
        properties: {
          slug: {
            type: 'string',
            description:
              'URL path starting with /faq/ — the question as a slug (e.g. /faq/how-much-does-roof-repair-cost-in-owensboro).',
          },
          title: {
            type: 'string',
            description: 'The question, phrased exactly as a person types it into Google (include city/niche where natural).',
          },
          meta_description: { type: 'string', description: '<=160 char distillation of the direct answer.' },
          mdx: {
            type: 'string',
            description:
              '120–300 word answer. Lead with a direct 1–2 sentence answer, then local detail. Markdown subset: ##, - bullets, **bold**, [text](url). No # H1, tables, images, or raw HTML.',
          },
        },
        required: ['slug', 'title', 'meta_description', 'mdx'],
      },
    },
  },
  required: ['faq_pages'],
} as const;

export interface GenerateFaqPagesInput {
  niche: string;
  city: string;
  state: string;
  business_name?: string;
  /** Theme key — selects the niche overlay appended to the system prompt. */
  theme?: string;
  /** How many FAQ pages to produce (clamped 1–8). Default 5. */
  count?: number;
  /** Existing FAQ question titles to avoid duplicating on a re-run/overwrite. */
  existing_questions?: string[];
}

export interface GenerateFaqPagesResult {
  faq_pages: Page[];
  generated_at: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  cost_usd: number;
}

export async function generateFaqPages(
  input: GenerateFaqPagesInput,
): Promise<GenerateFaqPagesResult> {
  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const businessName =
    input.business_name ?? `${capitalize(input.city)} ${capitalize(input.niche)} Pros`;
  const systemPrompt = composeSystemPrompt(input.theme);
  const count = Math.min(Math.max(input.count ?? 5, 1), 8);
  const avoid =
    input.existing_questions && input.existing_questions.length > 0
      ? `\n\nDo NOT repeat or paraphrase any of these existing questions:\n${input.existing_questions
          .map((q) => `- ${q}`)
          .join('\n')}`
      : '';

  const userPrompt = `Write ONLY standalone FAQ pages (\`faq_pages\`) for a local lead-gen website. Follow the "FAQ pages — \`faq_pages\` array" section of your instructions exactly: one question per page, the title and slug ARE the question, 120–300 word locally-specific answers.

niche: ${input.niche}
city: ${input.city}
state: ${input.state}
business_name: ${businessName}

Produce exactly ${count} FAQ pages. Source questions from real local demand (cost, timing, permits, insurance, "do you serve <area>", warning signs, DIY-vs-pro, seasonal concerns). Every answer MUST reference something concrete to ${input.city}, ${input.state} or this niche — a generic answer that would read identically on any site is wrong.${avoid}

Invoke the ${FAQ_TOOL_NAME} tool exactly once. Do not return prose.`;

  const response = await withStreamTimeout(
    client.messages.create({
      model,
      max_tokens: 4_000,
      temperature: 0.5,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: FAQ_TOOL_NAME,
          description: 'Output the standalone FAQ pages. Call exactly once.',
          input_schema: FAQ_TOOL_SCHEMA as never,
        },
      ],
      tool_choice: { type: 'tool', name: FAQ_TOOL_NAME },
      messages: [{ role: 'user', content: userPrompt }],
    }),
    'faq',
  );

  const toolUse = response.content.find(
    (block): block is Extract<typeof block, { type: 'tool_use' }> =>
      block.type === 'tool_use' && block.name === FAQ_TOOL_NAME,
  );
  const raw = toolUse ? (toolUse.input as { faq_pages?: unknown }).faq_pages : undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `FAQ generation: model did not return faq_pages. Stop reason: ${response.stop_reason}.`,
    );
  }

  // Normalize + validate each entry into a Page. Slugs are forced under /faq/
  // and de-duplicated so two questions never collide on the same URL (which
  // would also collide their deterministic Sanity doc id).
  const seen = new Set<string>();
  const faq_pages: Page[] = raw.map((entry, i) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : `Question ${i + 1}`;
    let slug = normalizeFaqSlug(
      typeof o.slug === 'string' && o.slug.trim() ? o.slug : slugifyQuestion(title),
    );
    while (seen.has(slug)) slug = `${slug}-${i + 1}`;
    seen.add(slug);
    const meta =
      typeof o.meta_description === 'string' && o.meta_description.trim()
        ? o.meta_description.trim().slice(0, 160)
        : title.slice(0, 160);
    const mdx = typeof o.mdx === 'string' ? o.mdx.trim() : '';
    return Page.parse({
      kind: 'faq',
      slug,
      title,
      meta_description: meta,
      mdx,
      targeted_keywords: [],
      faqs: [],
    });
  });

  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
  };
  const cost_usd = estimateCostUsd(model, usage);

  return {
    faq_pages,
    generated_at: new Date().toISOString(),
    model,
    usage,
    cost_usd,
  };
}

/** Slugify a question title into a hyphenated path segment (no /faq/ prefix). */
function slugifyQuestion(title: string): string {
  return title
    .toLowerCase()
    .replace(/[?'".,!:;()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Force a slug under the /faq/ namespace, lowercased and trimmed. */
function normalizeFaqSlug(slug: string): string {
  let s = slug.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (s.startsWith('faq/')) s = s.slice(4);
  s = s.toLowerCase().replace(/[^a-z0-9/]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) s = 'question';
  return `/faq/${s}`;
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
