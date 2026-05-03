import { z } from 'zod';
import { BaseAgent } from '../base.js';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const ChurnRecoveryInput = z.object({
  site_id: z.string().uuid(),
  churned_tenant_id: z.string().uuid(),
});

export const ChurnRecoveryOutput = z.object({
  site_id: z.string().uuid(),
  next_prospects_queued: z.number(),
});

export class ChurnRecovery extends BaseAgent<typeof ChurnRecoveryInput, typeof ChurnRecoveryOutput> {
  constructor() {
    super({ name: 'churn-recovery', inputSchema: ChurnRecoveryInput, outputSchema: ChurnRecoveryOutput });
  }
  protected async execute(): Promise<z.infer<typeof ChurnRecoveryOutput>> {
    // TODO(phase-4): re-run TenantProspector + OutreachAgent against the next 50 prospects.
    throw new NotImplementedError('churn-recovery');
  }
}
