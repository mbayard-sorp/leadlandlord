CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"zip" text,
	"message" text,
	"source" text DEFAULT 'unknown' NOT NULL,
	"klaviyo_profile_id" text,
	"sms_status" text,
	"email_status" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "twilio_call_sid" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "twilio_recording_sid" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "called_number" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "direction" text DEFAULT 'inbound' NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "is_voicemail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "twilio_phone_sid" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "forwarding_number" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "whisper_message" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "recording_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ga_measurement_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "klaviyo_list_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_site_created_idx" ON "leads" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calls_twilio_call_sid_uniq" ON "calls" USING btree ("twilio_call_sid") WHERE "calls"."twilio_call_sid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sites_twilio_sid_idx" ON "sites" USING btree ("twilio_phone_sid");