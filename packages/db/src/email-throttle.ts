import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from './client';
import { emailSends } from './schema';

export interface WarmupStep {
  days: number;
  cap: number;
}

/**
 * Default schedule: 10/day for first week, 25/day for second week,
 * 50/day thereafter. Override via ZOHO_WARMUP_SCHEDULE_JSON env var
 * (JSON array of WarmupStep). The last step's `days` is treated as
 * effectively infinite.
 */
const DEFAULT_WARMUP: WarmupStep[] = [
  { days: 7, cap: 10 },
  { days: 7, cap: 25 },
  { days: 1_000_000, cap: 50 },
];

function parseWarmupSchedule(): WarmupStep[] {
  const raw = process.env.ZOHO_WARMUP_SCHEDULE_JSON;
  if (!raw) return DEFAULT_WARMUP;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_WARMUP;
    const filtered = parsed.filter(
      (s): s is WarmupStep =>
        s &&
        typeof s === 'object' &&
        typeof (s as WarmupStep).days === 'number' &&
        typeof (s as WarmupStep).cap === 'number',
    );
    return filtered.length > 0 ? filtered : DEFAULT_WARMUP;
  } catch {
    return DEFAULT_WARMUP;
  }
}

function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Returns the first sentAt timestamp for a mailbox among status='sent' rows,
 * or null if it has never successfully sent. Used to compute warmup day-N.
 */
async function getFirstSendDate(mailbox: string): Promise<Date | null> {
  const db = getDb();
  const rows = await db
    .select({ sentAt: emailSends.sentAt })
    .from(emailSends)
    .where(and(eq(emailSends.mailbox, mailbox), eq(emailSends.status, 'sent')))
    .orderBy(emailSends.sentAt)
    .limit(1);
  return rows[0]?.sentAt ?? null;
}

/**
 * Compute today's send cap for a mailbox based on the warmup schedule.
 * Day 1 = the date of the first successful send (or today if none yet, in
 * which case the first step's cap applies).
 */
export async function computeDailyCap(
  mailbox: string,
  now: Date = new Date(),
): Promise<number> {
  const schedule = parseWarmupSchedule();
  const flatCap = Number(process.env.ZOHO_DAILY_SEND_CAP ?? 50);
  const firstSend = await getFirstSendDate(mailbox);
  if (!firstSend) return schedule[0]?.cap ?? flatCap;
  const daysSinceFirst = Math.floor(
    (startOfUtcDay(now).getTime() - startOfUtcDay(firstSend).getTime()) / 86_400_000,
  );
  let cumulative = 0;
  for (const step of schedule) {
    cumulative += step.days;
    if (daysSinceFirst < cumulative) return step.cap;
  }
  return schedule[schedule.length - 1]?.cap ?? flatCap;
}

export async function getRemainingSendsToday(
  mailbox: string,
  now: Date = new Date(),
): Promise<{ remaining: number; cap: number; sentToday: number }> {
  const cap = await computeDailyCap(mailbox, now);
  const since = startOfUtcDay(now);
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailSends)
    .where(
      and(
        eq(emailSends.mailbox, mailbox),
        gte(emailSends.sentAt, since),
        eq(emailSends.status, 'sent'),
      ),
    );
  const sentToday = Number(rows[0]?.count ?? 0);
  return { remaining: Math.max(0, cap - sentToday), cap, sentToday };
}

export async function recordSend(input: {
  siteId?: string | null;
  mailbox: string;
  toAddress: string;
  subject: string;
  purpose: string;
  provider: 'zoho' | 'resend';
  externalId?: string | null;
  status: 'sent' | 'failed' | 'throttled';
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.insert(emailSends).values({
    siteId: input.siteId ?? null,
    mailbox: input.mailbox,
    toAddress: input.toAddress,
    subject: input.subject,
    purpose: input.purpose,
    provider: input.provider,
    externalId: input.externalId ?? null,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    metadata: input.metadata ?? null,
  });
}
