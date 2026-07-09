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

/** Factual skeleton for a job-story post (mirrors the scout's StoryScaffold). */
export interface StoryScaffoldInput {
  presentingSymptom: string;
  rootCause: string;
  resolution: string;
  preventionTakeaway: string;
  settingHint: string;
}

/**
 * Verbatim grounded facts for the four original_* archetypes. The seeds/metric
 * come straight from siteOriginalDataInputs / siteNetworkMetrics rows — the
 * anti-fabrication contract is that these are the ONLY specific claims the
 * drafted page may cite.
 */
export interface GroundedFactsInput {
  /** Where the facts came from, e.g. 'caseStudyInputs' | 'siteNetworkMetrics'. */
  source: string;
  /** Operator- or scaffolder-seeded fact objects (case studies, firsthand notes, takes). */
  seeds?: Array<Record<string, unknown>> | null;
  /** Verbatim computed metric for data studies — value + sampleSize, no derived stats. */
  metric?: { metricKind: string; value: Record<string, unknown>; sampleSize: number } | null;
  /**
   * True when any seed is scaffolder-generated (illustrative: true) rather than
   * operator-vouched. Forces composite/illustrative framing + a disclosure line,
   * mirroring the job-story rules.
   */
  illustrative: boolean;
}

/** E-E-A-T author attribution from siteOriginalDataInputs.expertiseProfile. */
export interface AuthorProfileInput {
  authorName?: string;
  authorTitle?: string;
  authorBio?: string;
}

export interface AuthorInfoPageArgs {
  siteId: string;
  proposedSlug: string;
  proposedTitle: string;
  intent: 'info' | 'service' | 'comparison' | 'story';
  niche: string;
  city: string;
  state: string;
  ctx: AgentContext;
  /**
   * Job-story scaffold. Required-ish for `intent: 'story'`: when present the
   * writer dramatizes this factual skeleton (fictional, unnamed customer)
   * instead of writing generic prose.
   */
  storyScaffold?: StoryScaffoldInput | null;
  /**
   * Niche-knowledge block (terminology + common pain points + regulations) used
   * to keep job-story technique factually accurate. Ignored for non-story intent.
   */
  nicheKnowledge?: string | null;
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
  /**
   * Grounded facts for original_* archetypes. When present, the model is bound
   * to a hard grounding contract: cite ONLY these facts, invent nothing.
   */
  groundedFacts?: GroundedFactsInput | null;
  /**
   * Author attribution (byline + JSON-LD author). Only rendered when
   * authorName is present; credentials are never invented beyond what's given.
   */
  authorProfile?: AuthorProfileInput | null;
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

/** Tool schema for job-story posts — Article JSON-LD with a Case Study section. */
function buildStoryToolInputSchema(lengthTarget: number) {
  return {
    type: 'object',
    required: ['title', 'meta_description', 'mdx', 'h1', 'schema_org_jsonld'],
    properties: {
      title: {
        type: 'string',
        description: 'Page title, ≤60 chars, framed as a job/use-case and including the target keyword naturally.',
      },
      meta_description: {
        type: 'string',
        description: 'Meta description, ≤155 chars, hinting at the problem solved, with a CTA.',
      },
      h1: {
        type: 'string',
        description: 'H1 heading rendered at the top of the page body.',
      },
      mdx: {
        type: 'string',
        description: `Narrative body in Markdown/MDX, ${lengthTarget - 100}–${lengthTarget + 100} words. Tell the job as a story with H2 sections: the call/symptom, what we found on site, how we fixed it, and what to watch for. The customer is fictional and unnamed (composite). Weave the target keyword 3–5 times naturally. End with a short italic line noting the example is illustrative, then a CTA using {{phone}}.`,
      },
      schema_org_jsonld: {
        type: 'object',
        description:
          'Schema.org JSON-LD as a JSON object. Use type "Article" with "articleSection": "Case Study", a descriptive "headline", and an "about" naming the problem. Do NOT include Review, Rating, or a named Person — these are illustrative composite stories, not testimonials.',
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
  if (voiceSeed === 'voice-c') {
    return '\nVoice style: anecdotal and grounded. Lead with concrete scene-setting detail, then explain plainly. Good for storytelling.';
  }
  return `\nVoice seed: ${voiceSeed}. Match the tone described.`;
}

/**
 * System-prompt lines enforcing the grounding contract + author attribution.
 * Shared by the story and info variants so original_* archetypes are bound the
 * same way regardless of intent.
 */
function groundingSystemLines(
  groundedFacts: GroundedFactsInput | null | undefined,
  authorProfile: AuthorProfileInput | null | undefined,
): string[] {
  const lines: string[] = [];
  if (groundedFacts) {
    lines.push(
      `GROUNDING CONTRACT: the task includes a "Grounded facts" block. Those are the ONLY specific facts, numbers, jobs, experiences, or claims you may cite. Do NOT invent statistics, named clients, dates, credentials, awards, or outcomes beyond that block. If a detail is missing, write around it in general terms instead of fabricating it.`,
    );
    lines.push(
      groundedFacts.illustrative
        ? `The seeds are marked ILLUSTRATIVE — composite scenarios, not verified client engagements. Frame them as typical/illustrative ("a job like this usually…"), never as a specific real customer story, and end the body with a short italic line noting the examples are illustrative.`
        : `The grounded facts are real, operator-vouched inputs. Present them accurately, without exaggeration or embellishment.`,
    );
  }
  if (authorProfile?.authorName) {
    lines.push(
      `BYLINE: attribute the page to ${authorProfile.authorName}${authorProfile.authorTitle ? ` (${authorProfile.authorTitle})` : ''}. Add an italic byline line directly under the H1, and set the JSON-LD "author" to this name — @type "Organization" for a team/business name, "Person" only for a clearly personal name. Never invent credentials beyond what is given.`,
    );
  }
  return lines;
}

/** User-prompt lines carrying the verbatim grounded facts + author bio. */
function groundingPromptLines(
  groundedFacts: GroundedFactsInput | null | undefined,
  authorProfile: AuthorProfileInput | null | undefined,
): string[] {
  const lines: string[] = [];
  if (groundedFacts) {
    lines.push(
      ``,
      `Grounded facts (source: ${groundedFacts.source}) — the ONLY specific claims you may cite:`,
      '```json',
      JSON.stringify(
        {
          ...(groundedFacts.seeds && groundedFacts.seeds.length > 0 ? { seeds: groundedFacts.seeds } : {}),
          ...(groundedFacts.metric ? { metric: groundedFacts.metric } : {}),
        },
        null,
        2,
      ),
      '```',
    );
    if (groundedFacts.metric) {
      lines.push(
        `Cite the metric numbers VERBATIM (you may round for readability but never extrapolate) and mention the sample size (${groundedFacts.metric.sampleSize} observations) so readers can judge the data.`,
      );
    }
  }
  if (authorProfile?.authorBio) {
    lines.push(``, `Author bio (context for tone/expertise; do not add claims beyond it): ${authorProfile.authorBio}`);
  }
  return lines;
}

export async function draftInfoPage(args: AuthorInfoPageArgs): Promise<DraftedInfoPage> {
  const { proposedTitle, intent, niche, city, state, ctx, themeKey, archetype, voiceSeed, storyScaffold, nicheKnowledge, lengthTarget = 1000, groundedFacts, authorProfile } = args;

  if (process.env.MOCK_AI === '1') {
    return mockDraft(args);
  }

  const isStory = intent === 'story' && !!storyScaffold;

  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

  const system = isStory
    ? [
        `You are an expert local-SEO content writer. You write helpful, accurate job-story posts for small local businesses: short narratives about a real job, centered on a problem that was DISCOVERED and RESOLVED.`,
        `The customer is FICTIONAL and UNNAMED — write in composite/illustrative framing ("A homeowner in <area> called about…"). Never present a named individual as a verified customer, and never imply a review, rating, or testimonial.`,
        `Factual integrity: the problem and the fix must be accurate, common scenarios for this niche. Do not invent technique. Use correct trade terminology.`,
        `CRITICAL — phone numbers: never write a literal phone number anywhere in the MDX or CTAs. Always use the placeholder token {{phone}} exactly as written. A literal number like (555) 123-4567 is a hard failure.`,
        `Avoid: fake reviews, made-up awards, specific license numbers, claims like "best in state".`,
        `Tone: clear, neighborly, practical. Theme vibe: ${themeKey ?? 'classic'}.`,
        archetype ? `Content archetype: ${archetype}. Shape the narrative arc accordingly.` : '',
        ...groundingSystemLines(groundedFacts, authorProfile),
        voiceInstruction(voiceSeed),
      ].filter(Boolean).join('\n')
    : [
        `You are an expert local-SEO content writer. You write helpful, accurate, non-promotional info pages for small local businesses.`,
        `Avoid: fake reviews, made-up awards, specific license numbers, claims like "best in state". The page should educate the reader about the topic and end with an honest CTA.`,
        `CRITICAL — phone numbers: never write a literal phone number anywhere in the MDX or CTAs. Always use the placeholder token {{phone}} exactly as written (e.g. "Call us today at {{phone}}"). The site-host runtime substitutes the tenant's real tracking number at render. A literal number like (555) 123-4567 is a hard failure.`,
        `Tone: clear, neighborly, practical. Theme vibe: ${themeKey ?? 'classic'}.`,
        archetype ? `Content archetype: ${archetype}. Structure and angle the content accordingly.` : '',
        ...groundingSystemLines(groundedFacts, authorProfile),
        voiceInstruction(voiceSeed),
      ].filter(Boolean).join('\n');

  const userPrompt = isStory
    ? [
        `Write a single job-story post for a ${niche} business serving ${city}, ${state}.`,
        `Working title: "${proposedTitle}"`,
        ``,
        `Dramatize this factual skeleton — keep the problem and fix accurate; the customer is fictional and unnamed:`,
        `- Presenting symptom: ${storyScaffold!.presentingSymptom}`,
        `- Root cause discovered: ${storyScaffold!.rootCause}`,
        `- Resolution: ${storyScaffold!.resolution}`,
        `- Prevention takeaway: ${storyScaffold!.preventionTakeaway}`,
        `- Setting flavor (no named person): ${storyScaffold!.settingHint}`,
        ...(nicheKnowledge
          ? [``, `Niche knowledge — keep terminology and technique consistent with this:`, nicheKnowledge]
          : []),
        ...groundingPromptLines(groundedFacts, authorProfile),
        ``,
        `Requirements:`,
        `- Title ≤60 chars, framed as a job/use-case, includes the keyword naturally.`,
        `- Meta description ≤155 chars, with a CTA.`,
        `- MDX body ${lengthTarget - 100}–${lengthTarget + 100} words. Narrative arc with H2 sections: the call/symptom → what we found on site → how we fixed it → what to watch for.`,
        `- Weave the keyword phrase 3–5 times naturally (not stuffed).`,
        `- End the body with a short italic line: *Names and details are illustrative; the problem and fix reflect real jobs we do.* — then a CTA inviting the reader to call using the {{phone}} placeholder token.`,
        `- JSON-LD: Article with "articleSection": "Case Study". No Review/Rating/named Person nodes.`,
        ``,
        `Call ${DRAFT_TOOL_NAME} exactly once with the result.`,
      ].join('\n')
    : [
        `Author a single info page for a ${niche} business serving ${city}, ${state}.`,
        `Topic: "${proposedTitle}"`,
        `Intent: ${intent}`,
        ...groundingPromptLines(groundedFacts, authorProfile),
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
        input_schema: (isStory ? buildStoryToolInputSchema(lengthTarget) : buildDraftToolInputSchema(lengthTarget)) as never,
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
  const { proposedTitle, niche, city, state, lengthTarget = 1000, archetype, voiceSeed, intent, storyScaffold, groundedFacts, authorProfile } = args;

  // Byline + grounded-facts blocks mirror what the real prompt demands, so
  // unit tests can assert the plumbing end-to-end without an LLM call.
  const bylineLine = authorProfile?.authorName
    ? `*By ${authorProfile.authorName}${authorProfile.authorTitle ? `, ${authorProfile.authorTitle}` : ''}*`
    : null;
  const groundedBlock = groundedFacts
    ? [
        `## Grounded facts`,
        ``,
        '```json',
        JSON.stringify({ source: groundedFacts.source, seeds: groundedFacts.seeds ?? undefined, metric: groundedFacts.metric ?? undefined }),
        '```',
        ...(groundedFacts.metric ? [``, `Based on ${groundedFacts.metric.sampleSize} observations of ${groundedFacts.metric.metricKind}.`] : []),
        ...(groundedFacts.illustrative ? [``, `*The examples above are illustrative composites, not specific verified client engagements.*`] : []),
      ].join('\n')
    : null;
  const mockAuthorJsonLd = authorProfile?.authorName
    ? { author: { '@type': 'Organization', name: authorProfile.authorName } }
    : {};

  if (intent === 'story' && storyScaffold) {
    const title = clampString(`${proposedTitle} | ${niche} ${city}`, 60);
    const meta = clampString(
      `A ${niche} job in ${city}: ${storyScaffold.presentingSymptom.slice(0, 60)}. Call us today.`,
      155,
    );
    const mdx = [
      `# ${proposedTitle}`,
      ...(bylineLine ? [``, bylineLine] : []),
      ``,
      `## The call`,
      ``,
      `A homeowner in ${storyScaffold.settingHint} called our ${city} ${niche} team: ${storyScaffold.presentingSymptom}`,
      ``,
      `## What we found on site`,
      ``,
      `${storyScaffold.rootCause} It is a common ${niche} issue in ${city}, ${state}, and the surface symptom was masking it.`,
      ``,
      `## How we fixed it`,
      ``,
      `${storyScaffold.resolution}`,
      ``,
      `## What to watch for`,
      ``,
      `${storyScaffold.preventionTakeaway}`,
      ``,
      `*Names and details are illustrative; the problem and fix reflect real jobs we do.*`,
      ``,
      `Dealing with something similar? Call our ${city} ${niche} crew at {{phone}} for a free quote.`,
    ].join('\n');
    return {
      title,
      metaDescription: meta,
      h1: proposedTitle,
      mdx,
      jsonLd: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        articleSection: 'Case Study',
        headline: title,
        about: storyScaffold.rootCause,
        areaServed: `${city}, ${state}`,
        ...mockAuthorJsonLd,
      }),
    };
  }

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
    ...(bylineLine ? [``, bylineLine] : []),
    ``,
    `If you're searching for ${proposedTitle.toLowerCase()} in ${city}, ${state}, here's what local ${niche} pros want you to know.`,
    ``,
    `## What ${proposedTitle.toLowerCase()} usually involves`,
    ``,
    `Most ${niche} jobs in ${city} share a common workflow: assessment, planning, execution, and cleanup. Knowing what to expect helps you compare quotes and avoid surprises.`,
    ...(groundedBlock ? [``, groundedBlock] : []),
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
      ...mockAuthorJsonLd,
    }),
  };
}
