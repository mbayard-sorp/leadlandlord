CREATE TABLE IF NOT EXISTS "dataforseo_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "endpoint" text NOT NULL,
  "key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "cost_usd" numeric(10,4) NOT NULL DEFAULT '0',
  "hit_count" integer NOT NULL DEFAULT 0,
  "last_hit_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dataforseo_cache_endpoint_key_idx" ON "dataforseo_cache" ("endpoint","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dataforseo_cache_expires_at_idx" ON "dataforseo_cache" ("expires_at");
