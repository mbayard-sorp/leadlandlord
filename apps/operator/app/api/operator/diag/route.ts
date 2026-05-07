import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diagnostic route — reports env state + code version markers so we can
 * verify what's actually deployed vs what we think we shipped. Used during
 * the 2026-05-07 cascade incident debugging to prove which build is live.
 *
 * Returns:
 *   - mockAi: value of MOCK_AI env var (string or 'unset')
 *   - hasAnthropicKey: boolean — whether ANTHROPIC_API_KEY is set
 *   - codeMarkers: hard-coded marker strings unique to recent PRs;
 *     if these strings appear in the response, the build contains those PRs
 *   - now: server timestamp
 */
export async function GET() {
  return NextResponse.json({
    mockAi: process.env.MOCK_AI ?? 'unset',
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    codeMarkers: {
      // PR 10 marker — bumped each time we ship a build to verify freshness.
      pr10_dedupe_fix: 'eventId-fallback-2026-05-07',
      pr12_mock_ai: 'mock-ai-2026-05-07',
    },
    now: new Date().toISOString(),
  });
}
