import { NextResponse } from 'next/server';
import { approveDomainCandidate } from '@/app/operator/sites/[id]/domain-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/operator/sites/[id]/domains/[candidateId]/approve
 *
 * Thin wrapper around the `approveDomainCandidate` server action so that
 * external dispatch tools (e.g. Slack /approve, or future automation) can
 * grant approval the same way the dashboard button does. Browser-driven
 * approvals go through the server action directly.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; candidateId: string }> },
) {
  const { id, candidateId } = await ctx.params;
  const result = await approveDomainCandidate(id, candidateId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
