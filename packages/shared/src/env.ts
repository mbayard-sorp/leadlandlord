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
  /** Zoho agentic email — MCP endpoint URL. */
  ZOHO_MCP_URL: z.string().url().optional(),
  ZOHO_ACCOUNT_ID: z.string().optional(),
  ZOHO_DEFAULT_FROM: z.string().email().optional(),
  /** Hard daily cap (used as a flat fallback when no warmup schedule applies). */
  ZOHO_DAILY_SEND_CAP: z.coerce.number().int().positive().default(50),
  /** Optional override for the warmup schedule — JSON array of { days, cap }. */
  ZOHO_WARMUP_SCHEDULE_JSON: z.string().optional(),
  ZOHO_MCP_ENABLED: z.coerce.boolean().default(false),
  /** CAN-SPAM postal address used in agent-drafted outbound mail. */
  LEADLANDLORD_POSTAL_ADDRESS: z.string().optional(),
  KLAVIYO_PRIVATE_API_KEY: z.string().optional(),
  /** Google Cloud API key with Places API (New) enabled. */
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  /** Per-request timeout (ms) for Google Places fetches. Default 10000. */
  GOOGLE_PLACES_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  /** Minimum interval (ms) between Places requests (per-instance burst smoother). Default 250. */
  GOOGLE_PLACES_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(250),
  /** Hard per-UTC-day Places request cap — the real spend ceiling. Default 500. */
  GOOGLE_PLACES_DAILY_CAP: z.coerce.number().int().positive().default(500),
  /** Build & Sell per-build cost ceiling (USD), enforced mid-run in spec-site-builder. Default 0.50. */
  BUILDSELL_PER_RUN_CAP_USD: z.coerce.number().positive().default(0.5),
  /** Default quoted price (USD) for a Build & Sell spec site. Optional. */
  BUILDSELL_DEFAULT_PRICE_USD: z.coerce.number().positive().optional(),
  /** Apollo restricted API key for organizations/enrich + organization_top_people. */
  APOLLO_API_KEY: z.string().optional(),
  /** ElevenLabs API key for Conversational AI outbound voice (Phase 6). */
  ELEVENLABS_API_KEY: z.string().optional(),
  /** ElevenLabs Agent ID — created in the ElevenLabs dashboard. */
  ELEVENLABS_AGENT_ID: z.string().optional(),
  /** ElevenLabs phone_number_id — created when you import a Twilio number into ElevenLabs. */
  ELEVENLABS_PHONE_NUMBER_ID: z.string().optional(),
  /** Shared secret for verifying the `ElevenLabs-Signature` header on inbound webhooks (ADR 0031). */
  ELEVENLABS_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Signing secret for tenant-facing call-recording links (ADR 0031, Phase D).
   * Falls back to OPERATOR_SESSION_SECRET when unset so recording links work
   * out of the box; set a dedicated value in production to avoid reusing the
   * session secret across concerns.
   */
  TENANT_RECORDING_SECRET: z.string().optional(),
  /** Stripe sandbox/test secret key (sk_test_...). Preferred during development. */
  STRIPE_SECRET_KEY_TEST: z.string().optional(),
  /** Stripe live secret key (sk_live_...). Only set when ready for real payments. */
  STRIPE_SECRET_KEY: z.string().optional(),
  /** Webhook signing secret for /api/webhooks/stripe. Test mode whsec_test_... */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
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
  /** Central GA4 measurement ID (G-XXXXXXX). Optional in non-production. */
  NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().regex(/^G-/).optional(),
  /**
   * Google service-account credentials JSON — either raw JSON or base64-encoded
   * JSON. Used by Google Search Console + GA4 Data API integrations. Optional
   * because dry-run mode bypasses it.
   */
  GOOGLE_SERVICE_ACCOUNT_KEY_JSON: z.string().optional(),
  /** Path to a service-account JSON key file on disk. Alternative to KEY_JSON. */
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: z.string().optional(),
  /** When 'true', GSC + GA4 wrappers return synthetic data without calling the API. */
  GOOGLE_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Resolve the active Stripe secret key. Prefers the test/sandbox key when
 * set so dev doesn't accidentally hit the live API. Returns null when
 * neither is configured.
 *
 * Set `STRIPE_FORCE_LIVE=true` to use the live key even if a test key is
 * present — useful on prod deploys where both env vars exist.
 */
export function stripeSecretKey(): string | null {
  const test = process.env.STRIPE_SECRET_KEY_TEST;
  const live = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_FORCE_LIVE === 'true' && live) return live;
  if (test) return test;
  if (live) return live;
  return null;
}

/** True when stripeSecretKey() resolves to a test/sandbox key (sk_test_...). */
export function stripeIsTestMode(): boolean {
  const key = stripeSecretKey();
  return key !== null && key.startsWith('sk_test_');
}

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
    ZOHO_MCP_URL: process.env.ZOHO_MCP_URL,
    ZOHO_ACCOUNT_ID: process.env.ZOHO_ACCOUNT_ID,
    ZOHO_DEFAULT_FROM: process.env.ZOHO_DEFAULT_FROM,
    ZOHO_DAILY_SEND_CAP: Number.parseInt(process.env.ZOHO_DAILY_SEND_CAP ?? '50', 10),
    ZOHO_WARMUP_SCHEDULE_JSON: process.env.ZOHO_WARMUP_SCHEDULE_JSON,
    ZOHO_MCP_ENABLED: process.env.ZOHO_MCP_ENABLED === 'true',
    LEADLANDLORD_POSTAL_ADDRESS: process.env.LEADLANDLORD_POSTAL_ADDRESS,
    KLAVIYO_PRIVATE_API_KEY: process.env.KLAVIYO_PRIVATE_API_KEY,
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    APOLLO_API_KEY: process.env.APOLLO_API_KEY,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ELEVENLABS_AGENT_ID: process.env.ELEVENLABS_AGENT_ID,
    ELEVENLABS_PHONE_NUMBER_ID: process.env.ELEVENLABS_PHONE_NUMBER_ID,
    ELEVENLABS_WEBHOOK_SECRET: process.env.ELEVENLABS_WEBHOOK_SECRET,
    TENANT_RECORDING_SECRET: process.env.TENANT_RECORDING_SECRET,
    STRIPE_SECRET_KEY_TEST: process.env.STRIPE_SECRET_KEY_TEST,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    MOCK_TELEPHONY: process.env.MOCK_TELEPHONY === 'true',
    SENTRY_DSN: process.env.SENTRY_DSN,
    OPERATOR_PUBLIC_URL: process.env.OPERATOR_PUBLIC_URL ?? 'http://localhost:3000',
    DAILY_LLM_BUDGET_USD: Number.parseFloat(process.env.DAILY_LLM_BUDGET_USD ?? '20'),
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    IMAGEN_MODEL: process.env.IMAGEN_MODEL ?? 'google/imagen-3-fast',
    GOOGLE_SERVICE_ACCOUNT_KEY_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON,
    GOOGLE_SERVICE_ACCOUNT_KEY_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    GOOGLE_DRY_RUN: process.env.GOOGLE_DRY_RUN === 'true',
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  };
}
