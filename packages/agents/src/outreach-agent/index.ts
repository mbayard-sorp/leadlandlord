import { z } from 'zod';
import { BaseAgent } from '../base.js';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const OutreachAgentInput = z.object({
  site_id: z.string().uuid(),
  prospect_ids: z.array(z.string().uuid()),
  channels: z.array(z.enum(['email', 'sms', 'voice'])).default(['email']),
  template_set: z.string().default('default'),
});

export const OutreachAgentOutput = z.object({
  site_id: z.string().uuid(),
  events_emitted: z.number(),
  trials_offered: z.number(),
});

export class OutreachAgent extends BaseAgent<typeof OutreachAgentInput, typeof OutreachAgentOutput> {
  constructor() {
    super({ name: 'outreach-agent', inputSchema: OutreachAgentInput, outputSchema: OutreachAgentOutput });
  }
  protected async execute(): Promise<z.infer<typeof OutreachAgentOutput>> {
    // TODO(phase-3): Smartlead/Instantly (email), Twilio (SMS), Bland.ai/Vapi (voice).
    throw new NotImplementedError('outreach-agent');
  }
}
