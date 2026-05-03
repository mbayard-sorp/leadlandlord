import { z } from 'zod';
import { BaseAgent } from '../base.js';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const PortfolioAnalystInput = z.object({
  window_days: z.number().int().positive().default(30),
  send_digest: z.boolean().default(false),
});

export const PortfolioAnalystOutput = z.object({
  total_sites: z.number(),
  active_tenants: z.number(),
  mrr_usd: z.number(),
  cogs_usd: z.number(),
  net_usd: z.number(),
  flagged_sites: z.array(z.object({ site_id: z.string().uuid(), reason: z.string() })),
});

export class PortfolioAnalyst extends BaseAgent<typeof PortfolioAnalystInput, typeof PortfolioAnalystOutput> {
  constructor() {
    super({
      name: 'portfolio-analyst',
      inputSchema: PortfolioAnalystInput,
      outputSchema: PortfolioAnalystOutput,
    });
  }
  protected async execute(): Promise<z.infer<typeof PortfolioAnalystOutput>> {
    // TODO(phase-4): SQL aggregation over sites/tenants/invoices/agent_runs; optional Slack digest.
    throw new NotImplementedError('portfolio-analyst');
  }
}
