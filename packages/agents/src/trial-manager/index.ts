import { z } from 'zod';
import { BaseAgent } from '../base';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const TrialManagerInput = z.object({
  trial_id: z.string().uuid(),
  action: z.enum(['start', 'route_call', 'classify_call', 'send_digest', 'end']),
  payload: z.record(z.unknown()).optional(),
});

export const TrialManagerOutput = z.object({
  trial_id: z.string().uuid(),
  ok: z.boolean(),
});

export class TrialManager extends BaseAgent<typeof TrialManagerInput, typeof TrialManagerOutput> {
  constructor() {
    super({ name: 'trial-manager', inputSchema: TrialManagerInput, outputSchema: TrialManagerOutput });
  }
  protected async execute(): Promise<z.infer<typeof TrialManagerOutput>> {
    // TODO(phase-3): Twilio webhook routing (update IncomingPhoneNumber.VoiceUrl
    // to flip forwarding to tenant), recording status callback, transcription
    // via Voice Intelligence, then LLM classification of call outcome.
    throw new NotImplementedError('trial-manager');
  }
}
