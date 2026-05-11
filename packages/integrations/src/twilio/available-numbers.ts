import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

export interface PhoneCandidate {
  /** E.164 format, e.g. +15205550100 */
  e164: string;
  /**
   * Twilio IncomingPhoneNumber SID. Null until the number is purchased —
   * the AvailablePhoneNumbers resource doesn't expose a SID.
   */
  sid: string | null;
  locality: string | null;
  region: string | null;
  capabilities: {
    voice: boolean;
    sms: boolean;
    mms: boolean;
  };
  /**
   * Pre-computed vanity score 0–100. Higher = more memorable.
   * Based on digit repetition and word-fragment matching.
   * Provided to the Haiku prompt so it doesn't have to do string math.
   */
  vanityScore: number;
}

const AvailableNumberSchema = z.object({
  phone_number: z.string(),
  locality: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  capabilities: z
    .object({
      voice: z.union([z.boolean(), z.string()]).optional(),
      SMS: z.union([z.boolean(), z.string()]).optional(),
      MMS: z.union([z.boolean(), z.string()]).optional(),
    })
    .optional(),
});

const ListResponseSchema = z.object({
  available_phone_numbers: z.array(AvailableNumberSchema),
});

export interface ListAvailableNumbersInput {
  /** City, e.g. "Tucson". Used as Twilio's `InLocality` filter. */
  city?: string;
  /** Two-letter US state, e.g. "AZ". Used as Twilio's `InRegion` filter. */
  state?: string;
  /** Optional area-code fallback / explicit override. */
  areaCode?: string;
  limit?: number;
}

/**
 * Fetch available Twilio local phone numbers for a site's locale.
 *
 * Query strategy (in order, first non-empty result wins):
 *   1. InLocality + InRegion (city-scoped, ideal)
 *   2. InRegion only (state-scoped, covers cities with no local pool)
 *   3. AreaCode (only if explicitly supplied)
 *
 * Falls back to deterministic mock when:
 *   - TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set, OR
 *   - process.env.MOCK_TELEPHONY === 'true'
 *
 * Docs: https://www.twilio.com/docs/phone-numbers/api/availablephonenumberlocal-resource
 */
export async function listAvailableNumbers(
  input: ListAvailableNumbersInput,
): Promise<PhoneCandidate[]> {
  const { city, state, areaCode, limit = 5 } = input;
  if (!city && !state && !areaCode) {
    throw new IntegrationError(
      'twilio',
      'listAvailableNumbers requires at least one of: city, state, areaCode',
      400,
    );
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const useMock = !sid || !token || process.env.MOCK_TELEPHONY === 'true';

  if (useMock) {
    log.info({ city, state, areaCode, limit, provider: 'mock' }, 'listAvailableNumbers: using mock');
    return mockCandidates({ city, state, areaCode, limit });
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const attempts: Array<Record<string, string>> = [];
  if (city && state) attempts.push({ InLocality: city, InRegion: state });
  if (state) attempts.push({ InRegion: state });
  if (areaCode) attempts.push({ AreaCode: areaCode });

  for (const filters of attempts) {
    const params = new URLSearchParams({
      ...filters,
      PageSize: String(limit),
      VoiceEnabled: 'true',
    });

    const res = await fetch(
      `${TWILIO_BASE}/Accounts/${sid}/AvailablePhoneNumbers/US/Local.json?${params.toString()}`,
      { headers: { Authorization: `Basic ${auth}` } },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new IntegrationError(
        'twilio',
        `listAvailableNumbers failed: ${res.status} ${text}`,
        res.status,
        text,
      );
    }

    const json = await res.json();
    const parsed = ListResponseSchema.parse(json);
    if (parsed.available_phone_numbers.length > 0) {
      log.info(
        { filters, count: parsed.available_phone_numbers.length },
        'listAvailableNumbers: results',
      );
      return parsed.available_phone_numbers.map(toCandidate);
    }
    log.info({ filters }, 'listAvailableNumbers: empty result, trying next filter');
  }

  return [];
}

// ─── Vanity scoring ────────────────────────────────────────────────────────────

/**
 * Compute a vanity score 0–100 for a phone number's digit suffix (last 7 digits).
 *
 * Signals:
 *   - Repeating digit runs (222, 333, 1111): +20 per triple, +40 per quad+
 *   - Ascending/descending sequences (1234, 9876): +25
 *   - Palindrome last 4 digits: +15
 *   - Word-fragment matching against common vanity words: +30 cap
 *
 * Capped at 100. No negative scoring — all numbers are at least neutral.
 */
export function computeVanityScore(e164: string): number {
  // Strip country code and formatting, keep only digits
  const digits = e164.replace(/\D/g, '').slice(-7);
  if (digits.length < 7) return 0;

  let score = 0;

  // Repeating runs
  let runLen = 1;
  let maxRun = 1;
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] === digits[i - 1]) {
      runLen++;
      maxRun = Math.max(maxRun, runLen);
    } else {
      runLen = 1;
    }
  }
  if (maxRun >= 4) score += 40;
  else if (maxRun === 3) score += 20;
  else if (maxRun === 2) score += 8;

  // Ascending/descending sequence of 4+
  const isSeq = (start: number, dir: 1 | -1): boolean => {
    for (let j = 1; j < 4; j++) {
      if (Number(digits[start + j]) !== Number(digits[start + j - 1]) + dir) return false;
    }
    return true;
  };
  for (let i = 0; i <= digits.length - 4; i++) {
    if (isSeq(i, 1) || isSeq(i, -1)) {
      score += 25;
      break;
    }
  }

  // Palindrome last 4
  const last4 = digits.slice(-4);
  if (last4 === last4.split('').reverse().join('')) score += 15;

  // Word-fragment matching on phone keypad (2=ABC, 3=DEF, 4=GHI, 5=JKL, 6=MNO, 7=PQRS, 8=TUV, 9=WXYZ)
  const KEYPAD: Record<string, string> = {
    '2': 'abc', '3': 'def', '4': 'ghi', '5': 'jkl',
    '6': 'mno', '7': 'pqrs', '8': 'tuv', '9': 'wxyz',
  };
  const VANITY_WORDS = [
    'home', 'help', 'call', 'sale', 'fix', 'roof', 'lawn', 'pool',
    'best', 'care', 'fast', 'tree', 'pest', 'pipe', 'hvac', 'lock',
    'move', 'clean', 'plumb', 'elec', 'solar', 'lease', 'rent',
  ];
  // Build all possible letter combos from the last 7 digits and check prefix match
  let wordBonus = 0;
  for (const word of VANITY_WORDS) {
    if (word.length > digits.length) continue;
    // Check if digits can spell the word at any start position
    for (let start = 0; start <= digits.length - word.length; start++) {
      let matches = true;
      for (let k = 0; k < word.length; k++) {
        const d = digits[start + k];
        const letters = d ? KEYPAD[d] ?? '' : '';
        if (!letters.includes(word[k]!)) {
          matches = false;
          break;
        }
      }
      if (matches) {
        wordBonus = Math.min(wordBonus + 30, 30);
        break;
      }
    }
    if (wordBonus >= 30) break;
  }
  score += wordBonus;

  return Math.min(score, 100);
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function toCandidate(
  n: z.infer<typeof AvailableNumberSchema>,
): PhoneCandidate {
  const caps = n.capabilities ?? {};
  const boolCap = (v: boolean | string | undefined): boolean =>
    v === true || v === 'true' || v === '1';

  return {
    e164: n.phone_number,
    sid: null,
    locality: n.locality ?? null,
    region: n.region ?? null,
    capabilities: {
      voice: boolCap(caps.voice),
      sms: boolCap(caps.SMS),
      mms: boolCap(caps.MMS),
    },
    vanityScore: computeVanityScore(n.phone_number),
  };
}

// Deterministic mock seeded by city/state/areaCode so results are stable.
// Generates a plausible 3-digit area-code prefix from the seed inputs when
// no explicit areaCode is supplied — keeps mock numbers self-consistent without
// pretending to know real geography.
function mockCandidates(opts: {
  city?: string;
  state?: string;
  areaCode?: string;
  limit: number;
}): PhoneCandidate[] {
  const { city, state, areaCode, limit } = opts;
  const seed = `${city ?? ''}|${state ?? ''}|${areaCode ?? ''}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const ac = areaCode ?? String(200 + (hash % 700));
  const base = parseInt(ac, 10) || 520;
  const candidates: PhoneCandidate[] = [];
  for (let i = 0; i < limit; i++) {
    const nxx = String(200 + ((base + i * 17) % 700)).padStart(3, '0');
    const xxxx = String((base * 31 + i * 137) % 10000).padStart(4, '0');
    const e164 = `+1${ac}${nxx}${xxxx}`;
    candidates.push({
      e164,
      sid: `PN_MOCK_${ac}_${i}`,
      locality: city ?? 'Mock City',
      region: state ?? 'US',
      capabilities: { voice: true, sms: true, mms: false },
      vanityScore: computeVanityScore(e164),
    });
  }
  return candidates;
}
