import { z } from 'zod';

/**
 * content-migrator shared schemas + types.
 *
 * Kept dependency-light (zod only) so the operator review-queue client
 * component can `import type` the suggestion shapes without pulling the
 * Anthropic SDK / DB into the browser bundle.
 */

// ── Agent dispatch IO ─────────────────────────────────────────────────────────

export const ContentMigratorInput = z.object({
  buildsell_site_id: z.string().uuid(),
  /** Prospect's existing website, resolved from the Places cache by the operator. */
  website_uri: z.string().min(1),
  /** Dedupe component — operator stamps a fresh epoch per crawl. */
  crawl_epoch: z.string(),
});
export type ContentMigratorInput = z.infer<typeof ContentMigratorInput>;

export const ContentMigratorOutput = z.object({
  buildsell_site_id: z.string(),
  status: z.enum(['ok', 'no_website', 'empty_crawl', 'capped']),
  suggestions_written: z.number(),
  images_uploaded: z.number(),
  cost_usd: z.number(),
});
export type ContentMigratorOutput = z.infer<typeof ContentMigratorOutput>;

// ── Suggestion shapes (stored in buildsell_sites.metadata.pendingMigration) ────

/** A Sanity asset already uploaded by the agent, so the operator can preview it. */
export const MigratedAsset = z.object({
  assetId: z.string(),
  url: z.string(),
  /** Original source URL on the prospect's site (provenance). */
  sourceUrl: z.string().optional(),
});
export type MigratedAsset = z.infer<typeof MigratedAsset>;

export const MigratedServiceCard = z.object({
  icon: z.string().describe('lucide icon name'),
  title: z.string(),
  description: z.string(),
});
export type MigratedServiceCard = z.infer<typeof MigratedServiceCard>;

export const MigratedSocialLink = z.object({
  platform: z.string(),
  href: z.string(),
});
export type MigratedSocialLink = z.infer<typeof MigratedSocialLink>;

export const MigratedUgcItem = z.object({
  platform: z.string(),
  postUrl: z.string().optional(),
  caption: z.string().optional(),
  /** Captured thumbnail uploaded to Sanity (optional — links-only items allowed). */
  asset: MigratedAsset.optional(),
});
export type MigratedUgcItem = z.infer<typeof MigratedUgcItem>;

/** The full set of migration candidates the agent surfaces for operator review. */
export const MigrationSuggestions = z.object({
  headline: z.string().optional(),
  aboutBody: z.string().optional(),
  services: z.array(MigratedServiceCard).optional(),
  socials: z.array(MigratedSocialLink).optional(),
  logo: MigratedAsset.optional(),
  heroImage: MigratedAsset.optional(),
  aboutImage: MigratedAsset.optional(),
  ugc: z.array(MigratedUgcItem).optional(),
});
export type MigrationSuggestions = z.infer<typeof MigrationSuggestions>;

/** Blob persisted at `buildsell_sites.metadata.pendingMigration`. */
export const PendingMigration = z.object({
  status: z.enum(['pending', 'applied', 'rejected']),
  /** ISO timestamp — also drives the retention sweep TTL. */
  createdAt: z.string(),
  /** The crawled website. */
  source: z.string(),
  suggestions: MigrationSuggestions,
});
export type PendingMigration = z.infer<typeof PendingMigration>;

/** Metadata key holding the pending review blob. */
export const PENDING_MIGRATION_KEY = 'pendingMigration' as const;
/** Metadata key holding the per-site/day crawl cost cap counter. */
export const MIGRATION_CRAWL_CAP_KEY = 'migrationCrawlCap' as const;

/**
 * Operator-approved subset sent from the review panel to applyMigrationSelections.
 * Each field present = approved (with any operator edits already applied).
 */
export const MigrationSelections = MigrationSuggestions;
export type MigrationSelections = MigrationSuggestions;
