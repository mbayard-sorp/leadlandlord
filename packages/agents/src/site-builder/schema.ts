import { z } from 'zod';

export const SiteBuilderInput = z.object({
  niche: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  niche_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional(),
  fast_mode: z.boolean().optional(),
});
export type SiteBuilderInput = z.infer<typeof SiteBuilderInput>;

export const SiteBuilderOutput = z.object({
  site_id: z.string().uuid(),
  vercel_project_id: z.string(),
  vercel_project_name: z.string(),
  preview_url: z.string().url(),
  tracking_number: z.string(),
  tracking_provider: z.enum(['twilio', 'mock']),
  deployed_at: z.string(),
  build_dir: z.string(),
});
export type SiteBuilderOutput = z.infer<typeof SiteBuilderOutput>;
