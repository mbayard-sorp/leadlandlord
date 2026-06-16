import { z } from 'zod';

/** Narrative job-story archetypes (produce use-case posts with a storyScaffold). */
export const STORY_ARCHETYPES = [
  'job_story_diagnosis',
  'job_story_second_opinion',
  'job_story_emergency',
] as const;

/** All content archetypes. Informative-prose formats first, then the story formats. */
export const ARCHETYPES = [
  'seasonal',
  'how_to',
  'cost_guide',
  'comparison',
  'local_spotlight',
  ...STORY_ARCHETYPES,
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

export const LocalContentScoutInput = z.object({
  site_id: z.string().uuid(),
  idea_count: z.number().int().positive().max(10).default(3),
  /**
   * Optional archetype override. When omitted (the normal weekly cron path),
   * the agent picks one deterministically per site+week. When set, the agent
   * generates ideas for exactly this archetype — used to backfill a specific
   * format (e.g. seeding one of each job-story type per site).
   */
  archetype: z.enum(ARCHETYPES).optional(),
});
export type LocalContentScoutInput = z.infer<typeof LocalContentScoutInput>;

export const LocalContentScoutOutput = z.object({
  proposed: z.number().int().nonnegative(),
  autoApproved: z.number().int().nonnegative(),
});
export type LocalContentScoutOutput = z.infer<typeof LocalContentScoutOutput>;
