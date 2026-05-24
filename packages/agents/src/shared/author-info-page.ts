/**
 * Single-info-page authoring helper shared by seo-operator and local-content-writer.
 *
 * Why a shared helper instead of content-engine:
 *   content-engine's tool-use schema is the full ContentBundle. Authoring just
 *   one info page through that schema would force the model to fabricate every
 *   other field. This helper uses a focused single-page tool schema so round
 *   trips stay fast and cost stays under the daily cap.
 *
 * Usage is recorded against the parent run via ctx.recordUsage so cost flows
 * up correctly regardless of which agent calls this.
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
   * to the prompt so tone matches the site's design vibe.
   */
  themeKey?: 'classic' | 'modern' | 'premium' | 'bright' | 'haul' | 'counsel';
  /** Content archetype guiding structure and intent. */
  archetype?: string;
  /** Voice seed for stylistic variance across sites. */
  voiceSeed?: string;
  /**
   * Target word count (600-1200). Defaults to 1000.
   * Injected into both the system prompt and tool schema description so
   * the model respects the target.
   */
  lengthTarget?: number;
}

export interface DraftedInfoPage {
  title: string;
  metaDescription: string;
  mdx: string;
  jsonLd: string;
  h1: string;
}

const DRAFT_TOOL_NAME = 'output_info_page';

function buildDraftToolInputSchema(lengthTarget: number) {
  return {
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
        description: `Body in Markdown/MDX, ${lengthTarget - 100}–${lengthTarget + 100} words, H2/H3 structure, includes the topic phrase 3–5 times naturally, ends with a CTA to call/contact.`,
      },
      schema_org_jsonld: {
        type: 'object',
        description:
          'Schema.org JSON-LD as a JSON object. Use Article or FAQPage for info intent, Service for service intent.',
      },
    },
  } as const;
}

function voiceInstruction(voiceSeed: string | undefined): string {
  if (!voiceSeed) return '';
  if (voiceSeed === 'voice-a') {
    return '\nVoice style: conversational and warm. Use short sentences. Speak directly to the homeowner.';
  }
  if (voiceSeed === 'voice-b') {
    return '\nVoice style: informative and structured. Use clear headers. Favor concise, factual language.';
  }
  return `\nVoice seed: ${voiceSeed}. Match the tone described.`;
}

export async function draftInfoPage(args: AuthorInfoPageArgs): Promise<DraftedInfoPage> {
  const { proposedTitle, intent, niche, city, state, ctx, themeKey, archetype, voiceSeed, lengthTarget = 1000 } = args;

  if (process.env.MOCK_AI === '1') {
    return mockDraft(args);
  }

  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

  const system = [
    `You are an expert local-SEO content writer. You write helpful, accurate, non-promotional info pages for small local businesses.`,
    `Avoid: fake reviews, made-up awards, specific license numbers, claims like "best in state". The page should educate the reader about the topic and end with an honest CTA.`,
    `CRITICAL — phone numbers: never write a literal phone number anywhere in the MDX or CTAs. Always use the placeholder token {{phone}} exactly as written (e.g. "Call us today at {{phone}}"). The site-host runtime substitutes the tenant's real tracking number at render. A literal number like (555) 123-4567 is a hard failure.`,
    `Tone: clear, neighborly, practical. Theme vibe: ${themeKey ?? 'classic'}.`,
    archetype ? `Content archetype: ${archetype}. Structure and angle the content accordingly.` : '',
    voiceInstruction(voiceSeed),
  ].filter(Boolean).join('\n');

  const userPrompt = [
    `Author a single info page for a ${niche} business serving ${city}, ${state}.`,
    `Topic: "${proposedTitle}"`,
    `Intent: ${intent}`,
    ``,
    `Requirements:`,
    `- Title ≤60 chars, includes the topic phrase naturally.`,
    `- Meta description ≤155 chars, with a CTA.`,
    `- MDX body ${lengthTarget - 100}–${lengthTarget + 100} words, structured with H2/H3.`,
    `- The topic phrase should appear 3–5 times naturally (not stuffed).`,
    `- End with a CTA inviting the reader to call or contact the business, using the {{phone}} placeholder token (never a literal number).`,
    `- JSON-LD: Article schema for info, Service for service intent.`,
    ``,
    `Call ${DRAFT_TOOL_NAME} exactly once with the result.`,
  ].join('\n');

  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    temperature: 0.65,
    system,
    tools: [
      {
        name: DRAFT_TOOL_NAME,
        description: 'Output the drafted info page.',
        input_schema: buildDraftToolInputSchema(lengthTarget) as never,
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
      `draftInfoPage: model did not invoke ${DRAFT_TOOL_NAME} (stop_reason=${resp.stop_reason})`,
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
    throw new Error('draftInfoPage: drafted page missing required fields (title or mdx)');
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
  const { proposedTitle, niche, city, state, lengthTarget = 1000, archetype, voiceSeed } = args;
  const title = clampString(`${proposedTitle} | ${niche} ${city}`, 60);
  const meta = clampString(
    `Learn about ${proposedTitle.toLowerCase()} for ${niche} in ${city}, ${state}. Call us today.`,
    155,
  );

  // Vary mock content length so tests can assert lengthTarget plumbing.
  // Each "paragraph" is ~40 words; we target lengthTarget / 40 paragraphs.
  const paragraphCount = Math.max(2, Math.round(lengthTarget / 40));
  const extraParagraphs = Array.from({ length: paragraphCount - 2 }, (_, i) => [
    ``,
    `## Section ${i + 2}: ${archetype ? `${archetype} perspective` : 'What to know'}`,
    ``,
    `Local ${niche} work in ${city} often varies by season and neighborhood. Understanding ${proposedTitle.toLowerCase()} helps homeowners make better decisions. This is mock content paragraph ${i + 1} of ${paragraphCount} targeting ~${lengthTarget} words. Voice: ${voiceSeed ?? 'default'}.`,
  ].join('\n')).join('\n');

  const mdx = [
    `# ${proposedTitle}`,
    ``,
    `If you're searching for ${proposedTitle.toLowerCase()} in ${city}, ${state}, here's what local ${niche} pros want you to know.`,
    ``,
    `## What ${proposedTitle.toLowerCase()} usually involves`,
    ``,
    `Most ${niche} jobs in ${city} share a common workflow: assessment, planning, execution, and cleanup. Knowing what to expect helps you compare quotes and avoid surprises.`,
    extraParagraphs,
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
