import { eq, sql } from 'drizzle-orm';
import { getDb, bccGraduation, type BccGraduation } from '@leadlandlord/db';

/**
 * BCC graduation policy (ADR-0006): the first 20 globally-outbound emails
 * from an agent are BCC'd to a human reviewer. After the 20th successful
 * send the agent "graduates" and BCC stops. `manual_override` re-enables
 * BCC indefinitely regardless of count.
 *
 * Per-agent rows live in `bcc_graduation` (one row per agent_name, seeded
 * by migration 0019 for `molly`).
 */

const GRADUATION_THRESHOLD = 20;

export interface BccDecision {
  /** The BCC address to attach to the send, or null when BCC is off. */
  bcc: string | null;
  /** Whether the agent is currently graduated (no BCC unless override). */
  graduated: boolean;
  /** Whether manual_override is forcing BCC on. */
  override: boolean;
  /** Current outbound count for telemetry/logging. */
  outboundCount: number;
}

/**
 * Decide whether to BCC the next send for `agentName`. Reads the
 * bcc_graduation row plus the env-var fallback. Pure read — does NOT
 * increment the counter; call `recordBccSend` after a successful send.
 *
 * Resolution order for the BCC address:
 *   1. bcc_graduation.bcc_address column (operator UI sets this).
 *   2. MOLLY_BCC_ADDRESS env var (deploy-time default).
 *
 * Returns `bcc: null` when:
 *   - The agent has graduated AND manual_override is false, OR
 *   - No BCC address is configured anywhere.
 */
export async function decideBcc(agentName: string): Promise<BccDecision> {
  const db = getDb();
  const row = (
    await db
      .select()
      .from(bccGraduation)
      .where(eq(bccGraduation.agentName, agentName))
      .limit(1)
  )[0] as BccGraduation | undefined;

  if (!row) {
    // No row means BCC policy isn't configured for this agent. Default: no BCC.
    return { bcc: null, graduated: false, override: false, outboundCount: 0 };
  }

  const graduated = row.graduatedAt !== null;
  const override = row.manualOverride;
  const wantsBcc = override || !graduated;

  if (!wantsBcc) {
    return { bcc: null, graduated, override, outboundCount: row.outboundCount };
  }

  const address = row.bccAddress ?? process.env.MOLLY_BCC_ADDRESS ?? null;
  return { bcc: address, graduated, override, outboundCount: row.outboundCount };
}

/**
 * Record a successful outbound send against the agent's BCC graduation
 * counter. Increments outbound_count by 1 atomically and, if the new
 * count reaches the graduation threshold, sets graduated_at = NOW().
 *
 * Idempotent against concurrent sends — the UPDATE is a single statement
 * and graduated_at is only set when previously NULL.
 */
export async function recordBccSend(agentName: string): Promise<void> {
  const db = getDb();
  await db
    .update(bccGraduation)
    .set({
      outboundCount: sql`${bccGraduation.outboundCount} + 1`,
      graduatedAt: sql`CASE
        WHEN ${bccGraduation.graduatedAt} IS NULL
         AND ${bccGraduation.outboundCount} + 1 >= ${GRADUATION_THRESHOLD}
        THEN NOW()
        ELSE ${bccGraduation.graduatedAt}
      END`,
      updatedAt: new Date(),
    })
    .where(eq(bccGraduation.agentName, agentName));
}
