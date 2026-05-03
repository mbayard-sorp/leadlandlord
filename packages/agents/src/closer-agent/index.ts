import { z } from 'zod';
import { BaseAgent } from '../base';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const CloserAgentInput = z.object({
  trial_id: z.string().uuid(),
  channel: z.enum(['voice', 'sms', 'email']).default('voice'),
});

export const CloserAgentOutput = z.object({
  trial_id: z.string().uuid(),
  outcome: z.enum(['won', 'lost', 'follow_up']),
  monthly_rent_usd: z.number().optional(),
  stripe_checkout_url: z.string().url().optional(),
});

export class CloserAgent extends BaseAgent<typeof CloserAgentInput, typeof CloserAgentOutput> {
  constructor() {
    super({ name: 'closer-agent', inputSchema: CloserAgentInput, outputSchema: CloserAgentOutput });
  }
  protected async execute(): Promise<z.infer<typeof CloserAgentOutput>> {
    // TODO(phase-3): voice agent (Bland.ai/Vapi), Stripe Checkout link gen, e-sign optional.
    throw new NotImplementedError('closer-agent');
  }
}
