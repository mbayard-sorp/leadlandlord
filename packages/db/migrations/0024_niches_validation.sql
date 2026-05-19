-- Niche validation columns: niche-hunter now scores on Claude estimates only
-- (volume_source='claude_estimate'); operators validate per-row on demand,
-- which writes the measured dfs_* columns + the full raw DataForSEO payload.
-- The existing search_volume/kd columns stay as the estimate; validation never
-- overwrites them so the UI can show estimate vs measured side by side.
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "volume_source" text DEFAULT 'claude_estimate' NOT NULL;
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "est_search_volume" integer;
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "dfs_search_volume" integer;
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "dfs_kd" integer;
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "validated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "dfs_raw" jsonb;
