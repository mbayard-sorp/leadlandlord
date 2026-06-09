import { IntegrationError } from '@leadlandlord/shared/errors';

/**
 * Hard stop for the fleet audit (orchestrator Phase 1). When AGENT_AUDIT=1,
 * outbound side-effect integrations (real email/SMS, phone-number purchases,
 * card charges) throw instead of firing. scripts/agent-audit.ts sets
 * AGENT_AUDIT=1 before doing anything, so even an accidental execution path
 * can never send an email, provision a number, or charge a card.
 *
 * This is belt-and-suspenders: the audit is static and never executes agents,
 * but the guard guarantees the invariant regardless.
 */
export function assertNotAuditing(action: string): void {
  if (process.env.AGENT_AUDIT === '1') {
    throw new IntegrationError(
      'audit-guard',
      `AGENT_AUDIT=1: refusing real outbound side effect (${action})`,
    );
  }
}
