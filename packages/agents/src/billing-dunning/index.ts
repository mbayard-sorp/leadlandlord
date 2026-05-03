import { z } from 'zod';
import { BaseAgent } from '../base.js';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const BillingDunningInput = z.object({
  invoice_id: z.string().uuid(),
  attempt: z.number().int().positive(),
});

export const BillingDunningOutput = z.object({
  invoice_id: z.string().uuid(),
  recovered: z.boolean(),
  next_attempt_at: z.string().optional(),
});

export class BillingDunning extends BaseAgent<typeof BillingDunningInput, typeof BillingDunningOutput> {
  constructor() {
    super({ name: 'billing-dunning', inputSchema: BillingDunningInput, outputSchema: BillingDunningOutput });
  }
  protected async execute(): Promise<z.infer<typeof BillingDunningOutput>> {
    // TODO(phase-4): 7-day recovery — SMS day 1, email day 2, voice day 4, final SMS day 7.
    throw new NotImplementedError('billing-dunning');
  }
}
