-- Caller name from Twilio CNAM lookup (the `CallerName` voice-webhook param).
-- We pay ~$0.01/call for this lookup; store it so operator surfaces can show
-- who called. Nullable — CNAM is commonly empty for mobile callers.
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "caller_name" text;
