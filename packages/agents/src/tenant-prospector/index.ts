import { z } from 'zod';
import { BaseAgent } from '../base.js';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const TenantProspectorInput = z.object({
  site_id: z.string().uuid(),
  count: z.number().int().positive().default(50),
  exclude_existing_tenants: z.boolean().default(true),
});

export const TenantProspectorOutput = z.object({
  site_id: z.string().uuid(),
  prospects: z.array(
    z.object({
      business_name: z.string(),
      contact_name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      website_url: z.string().optional(),
      source: z.string(),
    }),
  ),
});

export class TenantProspector extends BaseAgent<typeof TenantProspectorInput, typeof TenantProspectorOutput> {
  constructor() {
    super({
      name: 'tenant-prospector',
      inputSchema: TenantProspectorInput,
      outputSchema: TenantProspectorOutput,
    });
  }
  protected async execute(): Promise<z.infer<typeof TenantProspectorOutput>> {
    // TODO(phase-3): Google Places + Yelp Fusion + Apollo/Clay enrichment.
    throw new NotImplementedError('tenant-prospector');
  }
}
