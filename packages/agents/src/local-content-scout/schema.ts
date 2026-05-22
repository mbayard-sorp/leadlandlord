import { z } from 'zod';

export const LocalContentScoutInput = z.object({
  site_id: z.string().uuid(),
  idea_count: z.number().int().positive().max(10).default(3),
});
export type LocalContentScoutInput = z.infer<typeof LocalContentScoutInput>;

export const LocalContentScoutOutput = z.object({
  proposed: z.number().int().nonnegative(),
  autoApproved: z.number().int().nonnegative(),
});
export type LocalContentScoutOutput = z.infer<typeof LocalContentScoutOutput>;
