-- Inbound greeting: text the caller hears (via Polly TTS) before the call
-- is forwarded to the tenant or sent to voicemail. Distinct from
-- whisper_message which plays only to the called party.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "inbound_greeting" text;
