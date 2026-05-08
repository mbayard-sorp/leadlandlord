import { z } from 'zod';
import { BaseAgent } from '../base';
import { NotImplementedError } from '@leadlandlord/shared/errors';

/**
 * Stub agent — Lighthouse audit runner. Phase A scaffolding. Real
 * implementation (PSI / chrome-launcher → lighthouse_audits insert) lands
 * with the SEO Operator dev-team-mate.
 */
export const LighthouseAuditInput = z.object({
  site_id: z.string().uuid(),
  url: z.string().url().optional(),
});

export const LighthouseAuditOutput = z.object({
  site_id: z.string().uuid(),
  url: z.string(),
  performance: z.number().int().min(0).max(100).nullable(),
  accessibility: z.number().int().min(0).max(100).nullable(),
  bestPractices: z.number().int().min(0).max(100).nullable(),
  seo: z.number().int().min(0).max(100).nullable(),
});

export class LighthouseAudit extends BaseAgent<typeof LighthouseAuditInput, typeof LighthouseAuditOutput> {
  constructor() {
    super({
      name: 'lighthouse-audit',
      inputSchema: LighthouseAuditInput,
      outputSchema: LighthouseAuditOutput,
    });
  }
  protected async execute(): Promise<z.infer<typeof LighthouseAuditOutput>> {
    throw new NotImplementedError('lighthouse-audit');
  }
}
