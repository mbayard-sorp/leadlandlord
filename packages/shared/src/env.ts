import { z } from 'zod';

const EnvSchema = z.object({
  // Required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Neon Postgres connection string)'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  VERCEL_TOKEN: z.string().min(1, 'VERCEL_TOKEN is required for Site Builder deploys'),
  OPERATOR_PASSWORD: z.string().min(1, 'OPERATOR_PASSWORD is required'),
  OPERATOR_SESSION_SECRET: z
    .string()
    .min(32, 'OPERATOR_SESSION_SECRET must be at least 32 chars (use `openssl rand -hex 32`)'),

  // Optional
  VERCEL_TEAM_ID: z.string().optional(),
  CALLRAIL_API_KEY: z.string().optional(),
  MOCK_TELEPHONY: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  SENTRY_DSN: z.string().optional(),
  OPERATOR_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  DAILY_LLM_BUDGET_USD: z
    .string()
    .default('20')
    .transform((v) => Number.parseFloat(v))
    .pipe(z.number().positive()),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Looser variant for tooling that runs at build time (e.g., dry-run script
 * before user has filled in secrets). Returns nullable values instead of throwing.
 */
export function getEnvLoose() {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
    OPERATOR_PASSWORD: process.env.OPERATOR_PASSWORD,
    OPERATOR_SESSION_SECRET: process.env.OPERATOR_SESSION_SECRET,
    CALLRAIL_API_KEY: process.env.CALLRAIL_API_KEY,
    MOCK_TELEPHONY: process.env.MOCK_TELEPHONY === 'true',
    SENTRY_DSN: process.env.SENTRY_DSN,
    OPERATOR_PUBLIC_URL: process.env.OPERATOR_PUBLIC_URL ?? 'http://localhost:3000',
    DAILY_LLM_BUDGET_USD: Number.parseFloat(process.env.DAILY_LLM_BUDGET_USD ?? '20'),
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  };
}
