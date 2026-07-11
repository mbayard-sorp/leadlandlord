-- ADR 0031 (inbound AI lead call qualification, Phase A): schema foundation
-- for the ElevenLabs Conversational AI voice-agent qualification flow.
--
--   sites.call_mode        — per-site opt-in enum (off | ai_first |
--                             fallback). Default 'off' is the safety gate;
--                             no site is AI-answered until an operator flips
--                             it via CallModeSelector (Phase E).
--   calls.*                — additive columns correlating AI-answered calls
--                             to their ElevenLabs conversation + persisting
--                             LeadQualifier's structured output and the
--                             tenant-notification delivery statuses (mirrors
--                             leads.sms_status / leads.email_status).
--   call_qualification_scripts — niche-keyed question scripts for the
--                             shared ElevenLabs agent. The single row with
--                             niche IS NULL is the default fallback script;
--                             seeded below with generic home-services
--                             qualification questions.
--
-- NOTE: this diff was generated alongside unrelated in-flight drift from
-- prior hand-authored migrations (0062-0065, ADR 0030 niche-scout-accuracy
-- columns) that drizzle-kit's local snapshot cache hadn't caught up to.
-- Those columns are already covered by their own idempotent migrations —
-- intentionally NOT repeated here to keep this migration scoped to ADR 0031.
--
-- Additive + idempotent (IF NOT EXISTS throughout) for safe re-application.
-- Apply manually to prod: pnpm db:migrate

DO $$ BEGIN
  CREATE TYPE "public"."call_mode" AS ENUM('off', 'ai_first', 'fallback');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."qualification_urgency" AS ENUM('emergency', 'this_week', 'flexible', 'just_browsing');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "call_qualification_scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche" text,
	"questions" jsonb NOT NULL,
	"system_prompt_override" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_qualification_scripts_niche_unique" UNIQUE("niche")
);
--> statement-breakpoint

ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "call_mode" "call_mode" DEFAULT 'off' NOT NULL;
--> statement-breakpoint

ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "elevenlabs_conversation_id" text;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "answered_by" text;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "qualification_score" integer;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "qualification_intent" text;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "qualification_urgency" "qualification_urgency";
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "qualification_job_type" text;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "qualification_budget_band" text;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "qualification_address" text;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "tenant_sms_status" text;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "tenant_email_status" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "calls_elevenlabs_conversation_idx" ON "calls" USING btree ("elevenlabs_conversation_id");
--> statement-breakpoint

-- Default fallback qualification script (niche IS NULL). Generic
-- home-services question set used when no niche-specific row exists.
--
-- NOTE: Postgres unique constraints treat NULL as distinct-from-NULL, so
-- `ON CONFLICT ("niche") DO NOTHING` would never dedupe this row on a
-- re-run (every NULL "conflicts" with nothing). We add a WHERE NOT EXISTS
-- guard alongside ON CONFLICT DO NOTHING so this insert is actually
-- idempotent for the default row while non-null niche rows still get the
-- standard unique-conflict protection.
INSERT INTO "call_qualification_scripts" ("niche", "questions")
SELECT
  NULL,
  '[
    "Can I get your full name?",
    "What''s the best callback number for you?",
    "What''s the service address for this job?",
    "Can you describe the job or issue you need help with?",
    "Is this an emergency, or can it wait a few days?",
    "How did you hear about us?"
  ]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM "call_qualification_scripts" WHERE "niche" IS NULL
)
ON CONFLICT ("niche") DO NOTHING;
