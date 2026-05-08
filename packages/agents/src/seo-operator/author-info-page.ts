/**
 * Single-info-page authoring helper for the SEO Operator's apply pass.
 *
 * Why a local helper instead of a content-engine sub-agent:
 *   content-engine's tool-use schema is the *full* ContentBundle (home + about
 *   + contact + N services + N service_areas + …). Authoring just one info
 *   page through that schema would force the model to fabricate every other
 *   field. This helper uses a focused single-page tool schema (~4 fields) so
 *   the apply-pass cost stays under the SEO Operator's daily cap and round
 *   trips quickly.
 *
 * The helper is internal to seo-operator — registry.ts does not register it
 * as an agent. Its Anthropic usage is recorded against the parent run via
 * ctx.recordUsage so cost flows up to the apply-run row.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import type { AgentContext } from '../base';

export interface AuthorInfoPageArgs {
  siteId: string;
  proposedSlug: string;
  proposedTitle: string;
  intent: 'info' | 'service' | 'comparison';
  niche: string;
  city: string;
  state: string;
  ctx: AgentContext;
  /**
   * Theme key from the Sanity site doc. Currently informational only — passed
   * to the prompt so tone matches the site's design vibe (e.g. "premium" =
   * more formal). Page docs don't carry a theme reference directly.
   */
  themeKey?: 'classic' | 'modern' | 'premium' | 'bright';
}

export interface DraftedInfoPage {
  title: string;
  metaDescription: string;
  mdx: string;
  jsonLd: string;
  h1: string;
}

const DRAFT_TOOL_NAME = 'output_info_page';

/**
 * The narrow single-page tool schema. Mirrors the Sanity page doc fields the
 * SEO Operator can write today: title, meta_description, mdx body, JSON-LD,
 * and an h1 we use to verify the body matches the title.
 */
const DRAFT_TOOL_INPUT_SCHEMA = {
  type: 'object',
  required: ['title', 'meta_description', 'mdx', 'h1', 'schema_org_jsonld'],
  properties: {
    title: {
      type: 'string',
      description: 'Page title, ≤60 chars, includes the topic phrase naturally.',
    },
    meta_description: {
      type: 'string',
      description: 'Meta description, ≤155 chars, with a clear call to action.',
    },
    h1: {
      type: 'string',
      description: 'H1 heading rendered at the top of the page body.',
    },
    mdx: {
      type: 'string',
      description:
        'Body in Markdown/MDX, 800–1200 words, H2/H3 structure, includes the topic phrase 3–5 times naturally, ends with a CTA to call/contact.',
    },
    schema_org_jsonld: {
      type: 'object',
      description:
        'Schema.org JSON-LD as a JSON object. Use Article or FAQPage for info intent, Service for service intent.',
    },
  },
} as const;

/**
 * Author a single info page via Claude tool-use, then return the drafted
 * fields. The caller is responsible for compliance-guard + Sanity persistence
 * — this helper does no I/O beyond the Anthropic call.
 */
export async function draftInfoPage(args: AuthorInfoPageArgs): Promise<DraftedInfoPage> {
  const { proposedTitle, intent, niche, city, state, ctx, themeKey } = args;

  // Mock path keeps unit tests + offline dev runs deterministic.
  if (process.env.MOCK_AI === '1') {
    return mockDraft(args);
  }

  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

  const system = [
    `You are an expert local-SEO content writer. You write helpful, accurate, non-promotional info pages for small local businesses.`,
    `Avoid: fake reviews, made-up awards, specific license numbers, claims like "best in state". The page should educate the reader about the topic and end with an honest CTA.`,
    `Tone: clear, neighborly, practical. Theme vibe: ${themeKey ?? 'classic'}.`,
  ].join('\n');

  const userPrompt = [
    `Author a single info page for a ${niche} business serving ${city}, ${state}.`,
    `Topic: "${proposedTitle}"`,
    `Intent: ${intent}`,
    ``,
    `Requirements:`,
    `- Title ≤60 chars, includes the topic phrase naturally.`,
    `- Meta description ≤155 chars, with a CTA.`,
    `- MDX body 800–1200 words, structured with H2/H3.`,
    `- The topic phrase should appear 3–5 times naturally (not stuffed).`,
    `- End with a CTA inviting the reader to call or contact the business.`,
    `- JSON-LD: Article schema for info, Service for service intent.`,
    ``,
    `Call ${DRAFT_TOOL_NAME} exactly once with the result.`,
  ].join('\n');

  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    temperature: 0.4,
    system,
    tools: [
      {
        name: DRAFT_TOOL_NAME,
        description: 'Output the drafted info page.',
        input_schema: DRAFT_TOOL_INPUT_SCHEMA as never,
      },
    ],
    tool_choice: { type: 'tool', name: DRAFT_TOOL_NAME },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const usage = resp.usage;
  ctx.recordUsage({
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cost_usd: estimateCostUsd(model, {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    }),
  });

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === DRAFT_TOOL_NAME,
  );
  if (!toolUse) {
    throw new Error(
      `authorInfoPage: model did not invoke ${DRAFT_TOOL_NAME} (stop_reason=${resp.stop_reason})`,
    );
  }
  const out = toolUse.input as Record<string, unknown>;
  const drafted: DraftedInfoPage = {
    title: clampString(asString(out.title), 60),
    metaDescription: clampString(asString(out.meta_description), 155),
    h1: asString(out.h1) || asString(out.title),
    mdx: asString(out.mdx),
    jsonLd: JSON.stringify(out.schema_org_jsonld ?? {}),
  };
  if (!drafted.title || !drafted.mdx) {
    throw new Error('authorInfoPage: drafted page missing required fields (title or mdx)');
  }
  return drafted;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function clampString(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function mockDraft(args: AuthorInfoPageArgs): DraftedInfoPage {
  const { proposedTitle, niche, city, state } = args;
  const title = clampString(`${proposedTitle} | ${niche} ${city}`, 60);
  const meta = clampString(
    `Learn about ${proposedTitle.toLowerCase()} for ${niche} in ${city}, ${state}. Call us today.`,
    155,
  );
  const mdx = [
    `# ${proposedTitle}`,
    ``,
    `If you're searching for ${proposedTitle.toLowerCase()} in ${city}, ${state}, here's what local ${niche} pros want you to know.`,
    ``,
    `## What ${proposedTitle.toLowerCase()} usually involves`,
    ``,
    `Most ${niche} jobs in ${city} share a common workflow: assessment, planning, execution, and cleanup. Knowing what to expect helps you compare quotes and avoid surprises.`,
    ``,
    `## When to call a local ${niche} pro`,
    ``,
    `If the work touches structural, electrical, or plumbing systems — or you simply don't have the time — a local pro is usually the safer bet. ${proposedTitle} questions are common, and a quick phone call can clarify scope.`,
    ``,
    `### Cost factors`,
    ``,
    `Materials, access, time of year, and the size of the job all affect price. Get at least two quotes for ${proposedTitle.toLowerCase()} so you have something to compare.`,
    ``,
    `## Ready to talk it through?`,
    ``,
    `Give us a call or send a message and we'll walk through your specific situation. ${proposedTitle} doesn't have to be complicated.`,
  ].join('\n');
  return {
    title,
    metaDescription: meta,
    h1: proposedTitle,
    mdx,
    jsonLd: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      about: proposedTitle,
      areaServed: `${city}, ${state}`,
    }),
  };
}
