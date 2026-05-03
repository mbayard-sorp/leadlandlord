import { z } from 'zod';
import { BaseAgent } from '../base.js';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const OperatorInput = z.object({
  goal: z.enum(['build_site', 'find_niches', 'land_tenant', 'recover_churn', 'audit_portfolio']),
  payload: z.record(z.unknown()).optional(),
});

export const OperatorOutput = z.object({
  goal: z.string(),
  events_emitted: z.number(),
  agents_dispatched: z.array(z.string()),
});

/**
 * The Operator agent orchestrates higher-level goals by emitting events that
 * the cron dispatcher picks up. Phase 1 doesn't need it — the dry-run script
 * calls Site Builder directly. Wired up properly in Phase 4 when the dashboard
 * gains a "manual goal" button.
 */
export class Operator extends BaseAgent<typeof OperatorInput, typeof OperatorOutput> {
  constructor() {
    super({ name: 'operator', inputSchema: OperatorInput, outputSchema: OperatorOutput });
  }
  protected async execute(): Promise<z.infer<typeof OperatorOutput>> {
    throw new NotImplementedError('operator');
  }
}
