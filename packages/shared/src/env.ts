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
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  /** Operator destination number for lead-form SMS notifications. */
  OPERATOR_PHONE_NUMBER: z.string().optional(),
  /** Operator destination email for lead-form notifications. */
  OPERATOR_EMAIL: z.string().email().optional(),
  /** Verified Resend sender — e.g. "LeadLandlord <leads@yourdomain.com>". */
  RESEND_FROM_ADDRESS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  KLAVIYO_PRIVATE_API_KEY: z.string().optional(),
  /** Google Cloud API key with Places API (New) enabled. */
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  /** ElevenLabs API key for Conversational AI outbound voice (Phase 6). */
  ELEVENLABS_API_KEY: z.string().optional(),
  /** ElevenLabs Agent ID — created in the ElevenLabs dashboard. */
  ELEVENLABS_AGENT_ID: z.string().optional(),
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
  AI_GATEWAY_API_KEY: z.string().optional(),
  IMAGEN_MODEL: z.string().default('google/imagen-3-fast'),
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
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
    OPERATOR_PHONE_NUMBER: process.env.OPERATOR_PHONE_NUMBER,
    OPERATOR_EMAIL: process.env.OPERATOR_EMAIL,
    RESEND_FROM_ADDRESS: process.env.RESEND_FROM_ADDRESS,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    KLAVIYO_PRIVATE_API_KEY: process.env.KLAVIYO_PRIVATE_API_KEY,
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ELEVENLABS_AGENT_ID: process.env.ELEVENLABS_AGENT_ID,
    MOCK_TELEPHONY: process.env.MOCK_TELEPHONY === 'true',
    SENTRY_DSN: process.env.SENTRY_DSN,
    OPERATOR_PUBLIC_URL: process.env.OPERATOR_PUBLIC_URL ?? 'http://localhost:3000',
    DAILY_LLM_BUDGET_USD: Number.parseFloat(process.env.DAILY_LLM_BUDGET_USD ?? '20'),
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    IMAGEN_MODEL: process.env.IMAGEN_MODEL ?? 'google/imagen-3-fast',
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  };
}
