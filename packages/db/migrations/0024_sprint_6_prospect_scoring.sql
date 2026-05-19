-- Sprint 6: tenant-pipeline scoring fields on prospects.
-- apollo_org_id is denormalized from metadata for indexable dedupe across sites.
-- scoring_metadata holds DFS paid-ad signal + future scoring weights.
--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "apollo_org_id" text;
--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "scoring_metadata" jsonb;
--> statement-breakpoint
CREATE INDEX "prospects_status_last_outreach_idx" ON "prospects" ("status", "last_outreach_at");
--> statement-breakpoint
CREATE INDEX "prospects_apollo_org_idx" ON "prospects" ("apollo_org_id") WHERE "apollo_org_id" IS NOT NULL;
