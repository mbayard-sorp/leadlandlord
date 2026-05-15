-- Sprint 5: wave_state enum + waves table for the wave-launcher agent.
--> statement-breakpoint
CREATE TYPE "public"."wave_state" AS ENUM ('draft', 'launching', 'aging', 'linking', 'backlinking', 'monitoring', 'completed');
--> statement-breakpoint
CREATE TABLE "waves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "niche" text NOT NULL,
  "site_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "state" "wave_state" DEFAULT 'draft' NOT NULL,
  "aging_until" timestamp with time zone,
  "transitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "waves_state_updated_idx" ON "waves" ("state", "updated_at");
