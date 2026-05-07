import { z } from 'zod';
import { BaseAgent } from '../base';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const SeoOperatorInput = z.object({
  site_id: z.string().uuid(),
  audit_kind: z.enum(['on_page', 'core_web_vitals', 'internal_links', 'schema', 'all']).default('all'),
});

export const SeoOperatorOutput = z.object({
  site_id: z.string().uuid(),
  audit_score: z.number().min(0).max(100),
  issues: z.array(
    z.object({
      severity: z.enum(['critical', 'warning', 'info']),
      area: z.string(),
      message: z.string(),
      suggested_fix: z.string().optional(),
    }),
  ),
  fixes_applied: z.array(z.string()),
});

export class SeoOperator extends BaseAgent<typeof SeoOperatorInput, typeof SeoOperatorOutput> {
  constructor() {
    super({ name: 'seo-operator', inputSchema: SeoOperatorInput, outputSchema: SeoOperatorOutput });
  }
  protected async execute(): Promise<z.infer<typeof SeoOperatorOutput>> {
    // TODO(phase-2): Lighthouse, Screaming Frog cloud, Ahrefs site audit; auto-apply low-risk fixes.
    throw new NotImplementedError('seo-operator');
  }
}
