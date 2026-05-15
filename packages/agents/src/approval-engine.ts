import { eq, and } from 'drizzle-orm';
import { getDb, autoApproveRules } from '@leadlandlord/db';

/**
 * Minimal JSON-path predicate engine for auto-approve rule matching.
 *
 * Supported operators in matcher values:
 *   { "$gte": number }  — payload path value >= threshold
 *   { "$lte": number }  — payload path value <= threshold
 *   { "$eq": value }    — payload path value strict-equals
 *   { "$includes": string } — payload path value (array) includes string
 *
 * Dot-path keys resolve nested properties, e.g. "score" or "payload.score".
 * Non-matching paths return false (safe default).
 */

type PredicateOp =
  | { $gte: number }
  | { $lte: number }
  | { $eq: unknown }
  | { $includes: string };

type Matcher = Record<string, PredicateOp | unknown>;

function resolvePath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function applyPredicate(value: unknown, predicate: unknown): boolean {
  if (predicate !== null && typeof predicate === 'object') {
    const p = predicate as Record<string, unknown>;
    if ('$gte' in p) return typeof value === 'number' && value >= (p.$gte as number);
    if ('$lte' in p) return typeof value === 'number' && value <= (p.$lte as number);
    if ('$eq' in p) return value === p.$eq;
    if ('$includes' in p) return Array.isArray(value) && value.includes(p.$includes);
  }
  // Plain value — treat as $eq
  return value === predicate;
}

function matchesMatcher(payload: object, matcher: Matcher): boolean {
  for (const [path, predicate] of Object.entries(matcher)) {
    const value = resolvePath(payload, path);
    if (!applyPredicate(value, predicate)) return false;
  }
  return true;
}

export interface AutoApproveResult {
  matched: boolean;
  ruleId?: string;
}

/**
 * Check whether any active auto-approve rule matches the given kind + payload.
 * Returns the first matching rule's ID, or matched=false if none match.
 */
export async function checkAutoApprove(
  kind: string,
  payload: object,
  db?: ReturnType<typeof getDb>,
): Promise<AutoApproveResult> {
  const database = db ?? getDb();
  const rules = await database
    .select()
    .from(autoApproveRules)
    .where(and(eq(autoApproveRules.kind, kind), eq(autoApproveRules.active, true)));

  for (const rule of rules) {
    const matcher = rule.matcher as Matcher;
    if (matchesMatcher(payload, matcher)) {
      // Increment usage telemetry (fire-and-forget; non-blocking).
      void database
        .update(autoApproveRules)
        .set({ approvedCount: (rule.approvedCount ?? 0) + 1 })
        .where(eq(autoApproveRules.id, rule.id))
        .catch(() => {
          /* telemetry increment is best-effort */
        });
      return { matched: true, ruleId: rule.id };
    }
  }

  return { matched: false };
}
