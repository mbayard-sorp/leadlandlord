-- Niche scout/validate engine (deterministic redesign of niche-hunter).
-- Scout runs enumerate the full trade x city grid for chosen states, score
-- every cell from cached/static data, and persist only the top candidates
-- plus a report. The validator promotes selected candidates into `niches`
-- (the existing operator decision pipeline, unchanged).

CREATE TABLE "niche_scout_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_run_id" uuid,
  "states" jsonb NOT NULL,
  "category_filter" text,
  "population_min" integer NOT NULL,
  "population_max" integer NOT NULL,
  "grid_cells" integer NOT NULL,
  "persisted_candidates" integer NOT NULL,
  "report" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'current',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "niche_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scout_run_id" uuid NOT NULL REFERENCES "niche_scout_runs"("id") ON DELETE CASCADE,
  "trade" text NOT NULL,
  "category" text NOT NULL,
  "city" text NOT NULL,
  "state" text NOT NULL,
  "population" integer NOT NULL,
  "cluster_volume" integer,
  "est_city_volume" numeric(12,2),
  "lead_benchmark_price" numeric(8,2) NOT NULL,
  "rentability_prior" numeric(4,3) NOT NULL,
  "est_monthly_value_usd" numeric(12,2) NOT NULL,
  "rank" integer NOT NULL,
  "is_novel_trade" boolean NOT NULL DEFAULT false,
  "data_confidence" text NOT NULL DEFAULT 'cluster',
  "status" text NOT NULL DEFAULT 'scouted',
  "niche_id" uuid REFERENCES "niches"("id") ON DELETE SET NULL,
  "validated_value_usd" numeric(12,2),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "niche_candidates_run_cell_uniq" UNIQUE ("scout_run_id", "trade", "city", "state")
);
--> statement-breakpoint
CREATE INDEX "niche_candidates_run_rank_idx" ON "niche_candidates" ("scout_run_id", "rank");
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "est_monthly_value_usd" numeric(12,2);
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "validated_monthly_value_usd" numeric(12,2);
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "annotations" jsonb;
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN "scout_ctr_at_rank" numeric(5,4);
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN "scout_call_rate" numeric(5,4);
