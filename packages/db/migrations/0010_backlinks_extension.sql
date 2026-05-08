ALTER TABLE "backlinks" ADD COLUMN IF NOT EXISTS "domain_authority" integer;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN IF NOT EXISTS "pitch_draft" text;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN IF NOT EXISTS "subject_line" text;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN IF NOT EXISTS "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN IF NOT EXISTS "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN IF NOT EXISTS "response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN IF NOT EXISTS "response_snippet" text;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "backlinks_dedupe_key_uniq" ON "backlinks" USING btree ("dedupe_key") WHERE "backlinks"."dedupe_key" IS NOT NULL;
