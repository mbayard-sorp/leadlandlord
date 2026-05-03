import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base.js';
import { TrackingNumber } from '@leadlandlord/shared/types';
import { provisionNumber } from '@leadlandlord/integrations/callrail';

export const TrackingSetupInput = z.object({
  site_id: z.string().uuid(),
  area_code_hint: z.string().optional(),
  forwarding_number: z.string().optional(),
  whisper_message: z.string().optional(),
  recording_enabled: z.boolean().optional(),
});
export type TrackingSetupInput = z.infer<typeof TrackingSetupInput>;

export const TrackingSetupOutput = TrackingNumber;
export type TrackingSetupOutput = z.infer<typeof TrackingSetupOutput>;

export class TrackingSetup extends BaseAgent<typeof TrackingSetupInput, typeof TrackingSetupOutput> {
  constructor() {
    super({
      name: 'tracking-setup',
      inputSchema: TrackingSetupInput,
      outputSchema: TrackingSetupOutput,
      dedupeKeyFn: (i) => i.site_id,
      defaultDailyCapUsd: 1,
    });
  }

  protected async execute(input: TrackingSetupInput, ctx: AgentContext): Promise<TrackingSetupOutput> {
    ctx.log.info({ siteId: input.site_id }, 'provisioning tracking number');
    return provisionNumber({
      siteId: input.site_id,
      areaCodeHint: input.area_code_hint,
      forwardingNumber: input.forwarding_number,
      whisperMessage: input.whisper_message,
      recordingEnabled: input.recording_enabled,
    });
  }
}
