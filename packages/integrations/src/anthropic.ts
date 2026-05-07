import Anthropic from '@anthropic-ai/sdk';
import { createMockAnthropicClient } from './anthropic-mock';

let cached: Anthropic | null = null;

export function getAnthropicClient(apiKey?: string): Anthropic {
  // MOCK_AI bypasses the real Anthropic SDK and returns canned tool-use
  // responses. Used for end-to-end pipeline testing without burning credits.
  // See packages/integrations/src/anthropic-mock.ts. Activated by setting
  // MOCK_AI=true on the Vercel project (Production scope) — UNSET when ready
  // to resume real generation. Hit a $103 cascade today (2026-05-07) before
  // shipping this safety valve.
  if (process.env.MOCK_AI === 'true') {
    if (!cached) {
      cached = createMockAnthropicClient() as Anthropic;
    }
    return cached;
  }
  if (cached) return cached;
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is not set.');
  }
  cached = new Anthropic({ apiKey: key });
  return cached;
}

/**
 * Pricing as of 2026-05 (subject to change). Numbers in USD per 1M tokens.
 * Used for cost tracking on agent_runs.
 */
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-7': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export interface UsageBreakdown {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function estimateCostUsd(model: string, usage: UsageBreakdown): number {
  const baseModel = Object.keys(PRICING).find((k) => model.startsWith(k));
  if (!baseModel) {
    return 0;
  }
  const p = PRICING[baseModel]!;
  const cost =
    (usage.input_tokens / 1_000_000) * p.input +
    (usage.output_tokens / 1_000_000) * p.output +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * p.cacheRead +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * p.cacheWrite;
  return Number(cost.toFixed(4));
}
