import { z } from 'zod';
import { ContentBundle } from '@leadlandlord/shared/types';

export const ContentEngineInput = z.object({
  site_id: z.string().uuid(),
  niche: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  business_name: z.string().optional(),
  /** When set, content engine generates fewer pages — useful for the dry-run. */
  fast_mode: z.boolean().optional(),
});
export type ContentEngineInput = z.infer<typeof ContentEngineInput>;

export const ContentEngineOutput = ContentBundle;
export type ContentEngineOutput = z.infer<typeof ContentEngineOutput>;
