import { eq, and } from 'drizzle-orm';
import { getDb } from './client';
import { suppressionList, type Suppression } from './schema';

/**
 * Helpers for the global suppression list.
 *
 * Suppression is portfolio-wide — TCPA / CAN-SPAM apply per-account, not per-
 * site, so a STOP from a prospect on one tenant site applies across all
 * outreach. ComplianceGuard checks here before any SMS/voice/email goes out.
 */

export type SuppressionType = 'phone' | 'email';
export type SuppressionReason =
  | 'sms_stop'
  | 'voice_dnc'
  | 'email_unsubscribe'
  | 'manual'
  | 'trial_decline'
  | 'churn'
  | 'bounce'
  | 'invalid';
export type SuppressionChannel = 'sms' | 'voice' | 'email' | 'manual';

/**
 * Normalize an identifier for storage:
 *   - phone → E.164 (best effort, US default)
 *   - email → lowercase, trimmed
 *
 * Returns null when the input doesn't normalize to anything useful.
 */
export function normalizeIdentifier(
  identifier: string,
  type: SuppressionType,
): string | null {
  if (!identifier) return null;
  if (type === 'email') {
    const e = identifier.trim().toLowerCase();
    return e.includes('@') ? e : null;
  }
  // phone
  const digits = identifier.replace(/[^+\d]/g, '');
  if (digits.startsWith('+') && digits.length >= 11) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length < 10) return null;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

export interface AddSuppressionArgs {
  identifier: string;
  type: SuppressionType;
  reason: SuppressionReason;
  sourceSiteId?: string | null;
  channel?: SuppressionChannel | null;
  metadata?: Record<string, unknown>;
}

/**
 * Add to the suppression list. Idempotent — uniq index on
 * (identifier, identifier_type) means a duplicate insert is a no-op.
 *
 * Returns the row that's now in the list (existing or newly inserted).
 */
export async function addSuppression(args: AddSuppressionArgs): Promise<Suppression | null> {
  const id = normalizeIdentifier(args.identifier, args.type);
  if (!id) return null;
  const db = getDb();
  const inserted = await db
    .insert(suppressionList)
    .values({
      identifier: id,
      identifierType: args.type,
      reason: args.reason,
      sourceSiteId: args.sourceSiteId ?? null,
      channel: args.channel ?? null,
      metadata: args.metadata ?? null,
    })
    .onConflictDoNothing({
      target: [suppressionList.identifier, suppressionList.identifierType],
    })
    .returning();
  if (inserted[0]) return inserted[0];
  // Conflict — fetch the existing row.
  const existing = await db
    .select()
    .from(suppressionList)
    .where(
      and(
        eq(suppressionList.identifier, id),
        eq(suppressionList.identifierType, args.type),
      ),
    )
    .limit(1);
  return existing[0] ?? null;
}

/**
 * True when the identifier is currently suppressed for the given channel.
 * Phone numbers are normalized to E.164 before lookup; emails lowercased.
 */
export async function isSuppressed(identifier: string, type: SuppressionType): Promise<boolean> {
  const id = normalizeIdentifier(identifier, type);
  if (!id) return false;
  const db = getDb();
  const rows = await db
    .select({ id: suppressionList.id })
    .from(suppressionList)
    .where(
      and(
        eq(suppressionList.identifier, id),
        eq(suppressionList.identifierType, type),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Bulk-check a list of identifiers in one query. Useful for the Outreach
 * Agent which scrubs ~50 prospects at a time before sending.
 */
export async function filterSuppressed<T>(
  items: T[],
  pick: (t: T) => { identifier: string; type: SuppressionType } | null,
): Promise<T[]> {
  if (items.length === 0) return [];
  const keys = items
    .map(pick)
    .map((k) => (k ? { ...k, normalized: normalizeIdentifier(k.identifier, k.type) } : null))
    .filter((k): k is NonNullable<typeof k> & { normalized: string } => !!k && k.normalized !== null);
  if (keys.length === 0) return items;

  const db = getDb();
  // Drizzle doesn't have a clean tuple `IN ((id, type), ...)` builder, so we
  // chunk it: one query per type for simplicity. Phone/email are the only
  // two types in practice.
  const phoneIds = keys.filter((k) => k.type === 'phone').map((k) => k.normalized);
  const emailIds = keys.filter((k) => k.type === 'email').map((k) => k.normalized);

  const suppressed = new Set<string>();
  if (phoneIds.length > 0) {
    const rows = await db
      .select({ identifier: suppressionList.identifier })
      .from(suppressionList)
      .where(
        and(
          eq(suppressionList.identifierType, 'phone'),
          // drizzle inArray
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (suppressionList.identifier as any).in(phoneIds),
        ),
      );
    for (const r of rows) suppressed.add(`phone:${r.identifier}`);
  }
  if (emailIds.length > 0) {
    const rows = await db
      .select({ identifier: suppressionList.identifier })
      .from(suppressionList)
      .where(
        and(
          eq(suppressionList.identifierType, 'email'),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (suppressionList.identifier as any).in(emailIds),
        ),
      );
    for (const r of rows) suppressed.add(`email:${r.identifier}`);
  }

  return items.filter((item) => {
    const k = pick(item);
    if (!k) return true; // can't check — keep
    const norm = normalizeIdentifier(k.identifier, k.type);
    if (!norm) return true;
    return !suppressed.has(`${k.type}:${norm}`);
  });
}

/**
 * Remove from the suppression list (e.g. for re-opt-in). Returns true if a
 * row was deleted.
 */
export async function removeSuppression(identifier: string, type: SuppressionType): Promise<boolean> {
  const id = normalizeIdentifier(identifier, type);
  if (!id) return false;
  const db = getDb();
  const deleted = await db
    .delete(suppressionList)
    .where(
      and(
        eq(suppressionList.identifier, id),
        eq(suppressionList.identifierType, type),
      ),
    )
    .returning({ id: suppressionList.id });
  return deleted.length > 0;
}
