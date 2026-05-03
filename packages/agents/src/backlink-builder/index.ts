import { z } from 'zod';
import { BaseAgent } from '../base';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const BacklinkBuilderInput = z.object({
  site_id: z.string().uuid(),
  strategy: z.enum(['citations_only', 'citations_plus_haro', 'aggressive']).default('citations_only'),
  monthly_budget_usd: z.number().nonnegative().default(0),
});

export const BacklinkBuilderOutput = z.object({
  site_id: z.string().uuid(),
  links_attempted: z.number(),
  links_acquired: z.number(),
  pending_review: z.number(),
});

export class BacklinkBuilder extends BaseAgent<typeof BacklinkBuilderInput, typeof BacklinkBuilderOutput> {
  constructor() {
    super({
      name: 'backlink-builder',
      inputSchema: BacklinkBuilderInput,
      outputSchema: BacklinkBuilderOutput,
    });
  }
  protected async execute(): Promise<z.infer<typeof BacklinkBuilderOutput>> {
    // TODO(phase-2): citation submissions, HARO/Connectively, manual queue for guest posts.
    throw new NotImplementedError('backlink-builder');
  }
}
