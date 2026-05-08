import { z } from 'zod';
import { BaseAgent } from '../base';
import { NotImplementedError } from '@leadlandlord/shared/errors';

/**
 * Stub agent — GA4 daily ingest. Phase A scaffolding. Real implementation
 * (GA4 Data API → ga4_metrics_daily upsert) lands with the SEO ingest
 * dev-team-mate.
 */
export const SeoIngestGa4Input = z.object({
  site_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const SeoIngestGa4Output = z.object({
  site_id: z.string().uuid(),
  date: z.string(),
  rows_upserted: z.number().int().nonnegative(),
});

export class SeoIngestGa4 extends BaseAgent<typeof SeoIngestGa4Input, typeof SeoIngestGa4Output> {
  constructor() {
    super({
      name: 'seo-ingest-ga4',
      inputSchema: SeoIngestGa4Input,
      outputSchema: SeoIngestGa4Output,
    });
  }
  protected async execute(): Promise<z.infer<typeof SeoIngestGa4Output>> {
    throw new NotImplementedError('seo-ingest-ga4');
  }
}
