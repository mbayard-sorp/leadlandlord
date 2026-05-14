import { NextResponse } from 'next/server';
import { ANTHROPIC_MODULE_VERSION, getAnthropicClient } from '@leadlandlord/integrations/anthropic';
import { requireOperatorSession } from '../../../../lib/auth';

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
  try { await requireOperatorSession(); } catch { return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }); }
  // Actually invoke getAnthropicClient and inspect the result. Proves whether
  // the cron path's bundle has the same anthropic.ts that diag has.
  let clientType = 'unknown';
  let clientErr: string | null = null;
  try {
    const c: unknown = getAnthropicClient();
    // Mock client has no real Anthropic prototype; real client has `_client`
    // and `messages` of specific shape. Use a heuristic.
    if (c && typeof c === 'object' && 'messages' in c) {
      const m = (c as { messages: { create?: unknown } }).messages;
      // Mock's messages.create is a plain async fn; SDK's is bound on a class.
      const ctor = c.constructor?.name ?? 'unknown';
      clientType = ctor === 'Object' ? 'mock' : ctor;
      void m;
    }
  } catch (err) {
    clientErr = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    mockAi: process.env.MOCK_AI ?? 'unset',
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    anthropicModuleVersion: ANTHROPIC_MODULE_VERSION,
    anthropicClientType: clientType,
    anthropicClientErr: clientErr,
    codeMarkers: {
      pr10_dedupe_fix: 'eventId-fallback-2026-05-07',
      pr12_mock_ai: 'mock-ai-2026-05-07',
      pr15_cascade_defense: 'loop-guard-2026-05-08T0530',
    },
    now: new Date().toISOString(),
  });
}
