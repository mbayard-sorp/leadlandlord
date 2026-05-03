import { z } from 'zod';
import { BaseAgent } from '../base';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const DomainProcurerInput = z.object({
  niche: z.string(),
  city: z.string(),
  state: z.string().length(2),
  niche_id: z.string().uuid().optional(),
  max_price_usd: z.number().positive().default(20),
  prefer_tlds: z.array(z.string()).default(['.com', '.net', '.co']),
  human_approved: z.boolean().default(false),
});

export const DomainProcurerOutput = z.object({
  domain: z.string(),
  registrar: z.string(),
  price_usd: z.number(),
  registered_at: z.string(),
  expires_at: z.string(),
});

export class DomainProcurer extends BaseAgent<typeof DomainProcurerInput, typeof DomainProcurerOutput> {
  constructor() {
    super({
      name: 'domain-procurer',
      inputSchema: DomainProcurerInput,
      outputSchema: DomainProcurerOutput,
    });
  }
  protected async execute(): Promise<z.infer<typeof DomainProcurerOutput>> {
    // TODO(phase-2): real domain registration via Namecheap/Cloudflare. Hard-gated on human_approved.
    throw new NotImplementedError('domain-procurer');
  }
}
