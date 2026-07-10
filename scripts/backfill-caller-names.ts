#!/usr/bin/env -S tsx
/**
 * LeadLandlord — one-shot Twilio CNAM (caller-name) backfill.
 *
 * Caller-name lookup (`VoiceCallerIdLookup`) was not enabled on tracking
 * numbers, so Twilio never populated the `CallerName` webhook param and every
 * `calls.caller_name` came back null. The provisioning code now enables it for
 * new numbers; this script fixes the two remaining gaps:
 *
 *   1. Historical calls — resolves the CNAM for each distinct caller number
 *      (Twilio Lookup v2, ~$0.01/lookup) and writes it onto every matching
 *      `calls` row that is missing a name. Distinct numbers are looked up once
 *      to control cost (a spam number that called 40 times = one lookup).
 *
 *   2. Existing numbers going forward — with --enable-lookup, turns on
 *      `VoiceCallerIdLookup` on the live sites' numbers so future inbound calls
 *      arrive with a name (the code fix only covers newly provisioned numbers).
 *
 * Only calls on Twilio-provider sites with an E.164 caller number are
 * considered (mock numbers are skipped — they have no real CNAM and cost
 * nothing to skip).
 *
 * Safe by default: prints what it WOULD look up and exits without calling
 * Twilio or writing. Pass --execute to perform lookups and updates (real
 * Twilio spend).
 *
 * Usage:
 *   pnpm backfill-caller-names                          # dry run — counts only
 *   pnpm backfill-caller-names --execute                # backfill historical call names
 *   pnpm backfill-caller-names --execute --enable-lookup # also enable CNAM on live numbers
 *   pnpm backfill-caller-names --execute --limit 100 --delay-ms 250
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function findEnvFile(start: string, name: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
const envLocal = findEnvFile(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });

// eslint-disable-next-line import/order
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
// eslint-disable-next-line import/order
import { getDb, calls, sites } from '@leadlandlord/db';
// eslint-disable-next-line import/order
import { lookupCallerName, updateNumber } from '@leadlandlord/integrations/twilio';
// eslint-disable-next-line import/order
import { log } from '@leadlandlord/shared/log';

/** Real Twilio caller numbers are E.164 (+15205551234). Skip mock formats. */
const E164 = /^\+\d{8,15}$/;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function enableLookupOnLiveNumbers(execute: boolean): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: sites.id, sid: sites.twilioPhoneSid, number: sites.trackingNumber })
    .from(sites)
    .where(and(eq(sites.trackingProvider, 'twilio'), isNotNull(sites.twilioPhoneSid)));

  console.log(`\nEnable CNAM lookup — ${rows.length} Twilio number(s)`);
  if (!execute) {
    console.log('  (dry run — pass --execute to PATCH VoiceCallerIdLookup=true)\n');
    return;
  }
  let enabled = 0;
  for (const r of rows) {
    if (!r.sid) continue;
    try {
      await updateNumber({ twilioSid: r.sid, callerIdLookup: true });
      enabled += 1;
      console.log(`  ✓ ${r.number ?? r.sid}`);
    } catch (err) {
      console.log(`  ✗ ${r.number ?? r.sid} — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nEnabled caller-name lookup on ${enabled}/${rows.length} number(s).\n`);
}

async function backfillHistoricalNames(
  execute: boolean,
  limit: number,
  delayMs: number,
): Promise<void> {
  const db = getDb();
  // Distinct caller numbers on Twilio-provider sites whose calls have no name.
  const rows = await db
    .selectDistinct({ callerNumber: calls.callerNumber })
    .from(calls)
    .innerJoin(sites, eq(calls.siteId, sites.id))
    .where(
      and(
        isNull(calls.callerName),
        isNotNull(calls.callerNumber),
        eq(sites.trackingProvider, 'twilio'),
      ),
    );

  const numbers = rows
    .map((r) => r.callerNumber)
    .filter((n): n is string => !!n && E164.test(n))
    .slice(0, limit);

  console.log(`\nCaller-name backfill — ${numbers.length} distinct caller number(s) missing a name`);
  console.log(`Mode: ${execute ? 'EXECUTE (Twilio lookups + DB updates)' : 'DRY RUN (no lookups, no writes)'}\n`);

  if (!execute) {
    for (const n of numbers) console.log(`  ${n}`);
    console.log(
      `\nDry run only. Re-run with --execute to look up and backfill ${numbers.length} number(s) ` +
        `(~$${(numbers.length * 0.01).toFixed(2)} in Twilio lookups).\n`,
    );
    return;
  }

  let resolved = 0;
  let rowsUpdated = 0;
  for (const number of numbers) {
    let name: string | null = null;
    try {
      name = await lookupCallerName(number);
    } catch (err) {
      log.warn({ number, err: err instanceof Error ? err.message : err }, 'caller-name lookup failed');
    }
    if (name) {
      // Apply to every un-named row for this number (still guarding IS NULL so
      // we never clobber a name that arrived some other way).
      const result = await db
        .update(calls)
        .set({ callerName: name })
        .where(and(eq(calls.callerNumber, number), isNull(calls.callerName)))
        .returning({ id: calls.id });
      resolved += 1;
      rowsUpdated += result.length;
      console.log(`  ✓ ${number} → "${name}" (${result.length} row(s))`);
    } else {
      console.log(`  · ${number} → no CNAM record`);
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  console.log(
    `\nResolved ${resolved}/${numbers.length} number(s); updated ${rowsUpdated} call row(s).\n`,
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean', default: false },
      'enable-lookup': { type: 'boolean', default: false },
      limit: { type: 'string', default: '1000' },
      'delay-ms': { type: 'string', default: '250' },
    },
  });

  const execute = values.execute === true;
  const limit = Math.max(1, Number.parseInt(values.limit ?? '1000', 10));
  const delayMs = Math.max(0, Number.parseInt(values['delay-ms'] ?? '250', 10));

  if (values['enable-lookup']) {
    await enableLookupOnLiveNumbers(execute);
  }
  await backfillHistoricalNames(execute, limit, delayMs);

  // Guard against silently paying for lookups when creds are absent.
  if (execute && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN)) {
    console.warn(
      'NOTE: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — lookups returned null (no backfill applied).',
    );
  }
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? err.message : err, stack: err instanceof Error ? err.stack : undefined },
    'backfill-caller-names failed',
  );
  process.exit(1);
});
