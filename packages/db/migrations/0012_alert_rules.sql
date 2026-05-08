CREATE TABLE IF NOT EXISTS "alert_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "thresholds" jsonb NOT NULL,
  "cooldown_minutes" integer DEFAULT 60 NOT NULL,
  "last_fired_at" timestamp with time zone,
  "channels" jsonb DEFAULT '["pagerduty","slack"]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "alert_rules_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rule_id" uuid,
  "rule_name" text NOT NULL,
  "severity" text NOT NULL,
  "payload" jsonb NOT NULL,
  "channels_fired" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "alert_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_events_rule_created_idx" ON "alert_events" USING btree ("rule_name","created_at");
--> statement-breakpoint
-- Seed default rules. Idempotent via ON CONFLICT (name).
INSERT INTO "alert_rules" ("name", "thresholds", "cooldown_minutes", "channels")
VALUES
  ('agent_failure_rate', '{"windowHours":1,"failureRatePct":5,"minRuns":10}'::jsonb, 60, '["pagerduty","slack"]'::jsonb),
  ('llm_spend_spike', '{"multipleOf7dAvg":2}'::jsonb, 240, '["slack"]'::jsonb),
  ('stripe_webhook_failures', '{"windowHours":1,"failures":3}'::jsonb, 60, '["pagerduty","slack"]'::jsonb),
  ('ssl_expiry', '{"daysBefore":14}'::jsonb, 1440, '["slack"]'::jsonb),
  ('domain_expiry', '{"daysBefore":30}'::jsonb, 1440, '["slack"]'::jsonb)
ON CONFLICT ("name") DO NOTHING;
