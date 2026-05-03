import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base.js';

export const ComplianceGuardInput = z.object({
  scope: z.enum(['outreach_email', 'outreach_sms', 'outreach_voice', 'site_content']),
  text: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const ComplianceGuardOutput = z.object({
  ok: z.boolean(),
  violations: z.array(
    z.object({
      rule: z.string(),
      severity: z.enum(['blocker', 'warning']),
      message: z.string(),
    }),
  ),
});

/**
 * Phase 1: returns ok=true with no violations. Real implementation in Phase 4
 * will run TCPA/CAN-SPAM/DNC checks before any outreach goes out, and brand
 * + claim checks on generated site content.
 */
export class ComplianceGuard extends BaseAgent<typeof ComplianceGuardInput, typeof ComplianceGuardOutput> {
  constructor() {
    super({ name: 'compliance-guard', inputSchema: ComplianceGuardInput, outputSchema: ComplianceGuardOutput });
  }
  protected async execute(_input: z.infer<typeof ComplianceGuardInput>, ctx: AgentContext) {
    ctx.log.warn('compliance-guard is a Phase 1 stub — returning ok=true without real checks');
    return { ok: true, violations: [] };
  }
}
