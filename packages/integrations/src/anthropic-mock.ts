/**
 * Mock Anthropic client for end-to-end pipeline testing without burning credits.
 *
 * Activated by `MOCK_AI=true` env var (see anthropic.ts::getAnthropicClient).
 *
 * Returns canned responses keyed by the tool name in the request. Supports
 * both `messages.create` (used by keyword-planner, niche-hunter,
 * call-classifier) and `messages.stream` (used by content-engine).
 *
 * Built 2026-05-07 after a $103 cascade burn convinced us we needed to
 * exercise the orchestration code path with $0 spend before re-touching
 * production.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'node:events';

type MessageCreateRequest = Parameters<Anthropic['messages']['create']>[0];

const MOCK_USAGE = {
  input_tokens: 100,
  output_tokens: 200,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
} as const;

/**
 * Build a fake `messages.create` response shaped like the Anthropic SDK's
 * Message type, with a single tool_use block carrying canned input data.
 */
function buildMockMessage(toolName: string, toolInput: unknown) {
  return {
    id: `msg_mock_${Math.random().toString(36).slice(2, 10)}`,
    type: 'message' as const,
    role: 'assistant' as const,
    content: [
      {
        type: 'tool_use' as const,
        id: `toolu_mock_${Math.random().toString(36).slice(2, 10)}`,
        name: toolName,
        input: toolInput,
      },
    ],
    model: 'mock-model',
    stop_reason: 'tool_use' as const,
    stop_sequence: null,
    usage: {
      input_tokens: MOCK_USAGE.input_tokens,
      output_tokens: MOCK_USAGE.output_tokens,
      cache_read_input_tokens: MOCK_USAGE.cache_read_input_tokens,
      cache_creation_input_tokens: MOCK_USAGE.cache_creation_input_tokens,
      service_tier: 'standard' as const,
      server_tool_use: null,
    },
  };
}

/** Pull the requested tool name out of a messages.create payload. */
function extractToolName(req: MessageCreateRequest): string {
  if (
    typeof req.tool_choice === 'object' &&
    req.tool_choice !== null &&
    'type' in req.tool_choice &&
    req.tool_choice.type === 'tool' &&
    'name' in req.tool_choice
  ) {
    return (req.tool_choice as { name: string }).name;
  }
  // Fallback: first tool in the tools array.
  const tools = req.tools as Array<{ name?: string }> | undefined;
  return tools?.[0]?.name ?? 'unknown_tool';
}

/** Try to extract the user prompt text for context-aware mocks. */
function extractUserText(req: MessageCreateRequest): string {
  const msgs = req.messages as Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
  const last = msgs[msgs.length - 1];
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  return last.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
}

/**
 * Generate a canned tool input by tool name. New tools should be added here
 * as agents are added to the system. Falls back to {} for unknown tools.
 */
function cannedToolInput(toolName: string, prompt: string): unknown {
  switch (toolName) {
    case 'submit_keyword_clusters':
      return mockKeywordClusters(prompt);
    case 'output_content_bundle':
      return mockContentBundle(prompt);
    case 'submit_niches':
    case 'submit_niche_candidates':
      return mockNicheCandidates();
    default:
      return {};
  }
}

// ---- Per-tool canned responses ----

function mockKeywordClusters(_prompt: string): unknown {
  // Match ClusterSchema in keyword-planner: cluster_key, page_kind, intent,
  // primary_keyword, supporting_keywords, rationale.
  return {
    clusters: [
      {
        cluster_key: 'home-commercial',
        page_kind: 'home',
        intent: 'commercial',
        primary_keyword: 'mock primary keyword',
        supporting_keywords: ['mock support 1', 'mock support 2', 'mock support 3'],
        rationale: 'mock home page cluster',
      },
      {
        cluster_key: 'service-mock-install',
        page_kind: 'service',
        intent: 'commercial',
        primary_keyword: 'mock installation service',
        supporting_keywords: ['mock install 1', 'mock install 2', 'mock install 3'],
        rationale: 'mock primary service cluster',
      },
      {
        cluster_key: 'service-mock-repair',
        page_kind: 'service',
        intent: 'commercial',
        primary_keyword: 'mock repair service',
        supporting_keywords: ['mock repair 1', 'mock repair 2'],
        rationale: 'mock secondary service cluster',
      },
      {
        cluster_key: 'service_area-mock-locality',
        page_kind: 'service_area',
        intent: 'local-modifier',
        primary_keyword: 'mock service in mock locality',
        supporting_keywords: ['mock locality 1', 'mock locality 2'],
        rationale: 'mock service area cluster',
      },
      {
        cluster_key: 'blog-mock-cost',
        page_kind: 'blog',
        intent: 'informational',
        primary_keyword: 'mock cost guide',
        supporting_keywords: ['mock cost 1', 'mock cost 2'],
        rationale: 'mock blog cluster',
      },
      {
        cluster_key: 'info-mock-howto',
        page_kind: 'info',
        intent: 'informational',
        primary_keyword: 'mock how-to',
        supporting_keywords: ['mock howto 1', 'mock howto 2'],
        rationale: 'mock info page cluster',
      },
    ],
  };
}

function mockPage(kind: string, slug: string, title: string, clusterKey?: string, primaryKeyword?: string): unknown {
  const targetedKeywords =
    clusterKey && primaryKeyword
      ? [
          { phrase: primaryKeyword, role: 'primary', cluster_key: clusterKey },
          { phrase: `${primaryKeyword} secondary`, role: 'secondary', cluster_key: clusterKey },
          { phrase: `${primaryKeyword} support`, role: 'supporting', cluster_key: clusterKey },
        ]
      : [];
  return {
    kind,
    slug,
    title,
    meta_description: `Mock meta description for ${title}. Generated by MOCK_AI=true for E2E pipeline testing.`,
    mdx: `# ${title}\n\nThis is mock content for ${title}. The MOCK_AI flag bypassed the real Anthropic API to keep your $0 spend during pipeline testing.\n\n## Section one\n\nLorem ipsum dolor sit amet.\n\n## Section two\n\nMore mock content.`,
    cluster_key: clusterKey,
    primary_keyword: primaryKeyword,
    targeted_keywords: targetedKeywords,
  };
}

function mockContentBundle(prompt: string): unknown {
  // Try to extract niche/city/state from the prompt for slightly-realistic mock data.
  const nicheMatch = /niche[:\s]+([^\n]+)/i.exec(prompt);
  const cityMatch = /city[:\s]+([^\n]+)/i.exec(prompt);
  const stateMatch = /state[:\s]+([A-Z]{2})/.exec(prompt);
  const niche = nicheMatch?.[1]?.trim() ?? 'mock niche';
  const city = cityMatch?.[1]?.trim() ?? 'Mock City';
  const state = stateMatch?.[1] ?? 'MO';

  // Match ContentBundle schema in @leadlandlord/shared/types.
  return {
    niche,
    city,
    state,
    business_name: `Mock ${niche} Co.`,
    variant: 'classic',
    hero_image_prompt: `Professional photo of ${niche} work in ${city}`,
    nearby_cities: [`${city} North`, `${city} South`],
    trust_signals: ['Licensed & Bonded', 'Family Owned', '5★ on Google'],
    home: mockPage('home', '/', `${niche} in ${city}, ${state}`, 'home-commercial', `${niche} ${city.toLowerCase()}`),
    services: [
      mockPage('service', 'mock-install', `Mock Installation in ${city}`, 'service-mock-install', `mock installation ${city.toLowerCase()}`),
      mockPage('service', 'mock-repair', `Mock Repair in ${city}`, 'service-mock-repair', `mock repair ${city.toLowerCase()}`),
    ],
    service_areas: [
      mockPage('service_area', 'mock-locality', `${niche} in Mock Locality`, 'service_area-mock-locality', `${niche} mock locality`),
    ],
    about: mockPage('about', 'about', `About Mock ${niche} Co.`),
    contact: mockPage('contact', 'contact', `Contact ${city} ${niche}`),
    blog_posts: [mockPage('blog', 'cost-guide', `${niche} Cost Guide`, 'blog-mock-cost', 'mock cost guide')],
    info_pages: [mockPage('info', 'how-to', `How to Choose a ${niche} Pro`, 'info-mock-howto', 'mock how-to')],
    generated_at: new Date().toISOString(),
  };
}

function mockNicheCandidates(): unknown {
  return {
    niches: [
      {
        niche: 'mock niche 1',
        city: 'Mock City',
        state: 'MO',
        rationale: 'mock rationale',
        search_volume: 500,
        kd: 25,
        est_avg_job_value_usd: 800,
        est_close_rate: 0.15,
        score: 30,
      },
    ],
  };
}

// ---- Stream mock for content-engine ----

interface StreamLike {
  on(event: string, cb: (payload: unknown) => void): StreamLike;
  finalMessage(): Promise<ReturnType<typeof buildMockMessage>>;
}

function mockStream(req: MessageCreateRequest): StreamLike {
  const toolName = extractToolName(req);
  const prompt = extractUserText(req);
  const input = cannedToolInput(toolName, prompt);
  const finalMsg = buildMockMessage(toolName, input);
  const emitter = new EventEmitter();
  // Schedule the inputJson event in a microtask so .on() listeners attach first.
  setImmediate(() => {
    const json = JSON.stringify(input);
    // Emit two chunks so the progress code path with `streamedChars +=` is exercised.
    emitter.emit('inputJson', json.slice(0, json.length / 2));
    emitter.emit('inputJson', json.slice(json.length / 2));
  });
  return {
    on(event: string, cb: (payload: unknown) => void) {
      emitter.on(event, cb);
      return this;
    },
    async finalMessage() {
      // Yield once so any pending inputJson events flush.
      await new Promise<void>((resolve) => setImmediate(resolve));
      return finalMsg;
    },
  };
}

// ---- Mock client export ----

/**
 * Anthropic-SDK-shaped mock. Implements only the methods the agents
 * actually use: messages.create and messages.stream. Other SDK surface
 * area is omitted — call something not implemented here and you'll get
 * a runtime error pointing at this file.
 */
export function createMockAnthropicClient(): unknown {
  return {
    messages: {
      create: async (req: MessageCreateRequest) => {
        const toolName = extractToolName(req);
        const prompt = extractUserText(req);
        return buildMockMessage(toolName, cannedToolInput(toolName, prompt));
      },
      stream: (req: MessageCreateRequest) => mockStream(req),
    },
  };
}
