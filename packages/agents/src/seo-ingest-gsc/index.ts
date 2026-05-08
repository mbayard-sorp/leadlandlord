import { z } from 'zod';
import { BaseAgent } from '../base';
import { NotImplementedError } from '@leadlandlord/shared/errors';

/**
 * Stub agent — GSC daily ingest. Phase A scaffolding so the scheduler
 * cron route resolves the agent name. Real implementation (Search Console
 * API → seo_metrics_daily upsert) lands with the SEO ingest dev-team-mate.
 */
export const SeoIngestGscInput = z.object({
  site_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const SeoIngestGscOutput = z.object({
  site_id: z.string().uuid(),
  date: z.string(),
  rows_upserted: z.number().int().nonnegative(),
});

export class SeoIngestGsc extends BaseAgent<typeof SeoIngestGscInput, typeof SeoIngestGscOutput> {
  constructor() {
    super({
      name: 'seo-ingest-gsc',
      inputSchema: SeoIngestGscInput,
      outputSchema: SeoIngestGscOutput,
    });
  }
  protected async execute(): Promise<z.infer<typeof SeoIngestGscOutput>> {
    throw new NotImplementedError('seo-ingest-gsc');
  }
}
