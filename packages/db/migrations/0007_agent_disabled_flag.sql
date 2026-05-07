ALTER TABLE "agent_budgets" ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true;
