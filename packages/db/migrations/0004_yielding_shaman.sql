CREATE TABLE IF NOT EXISTS "system_state" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"kill_switch_reason" text,
	"kill_switch_activated_at" timestamp with time zone,
	"kill_switch_activated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
