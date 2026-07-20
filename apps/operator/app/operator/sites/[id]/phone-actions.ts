'use server';

import { revalidatePath } from 'next/cache';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, sites, phoneProvisions, type PhoneProvision } from '@leadlandlord/db';
import { listAvailableNumbers } from '@leadlandlord/integrations/twilio/available-numbers';
import { provisionNumber } from '@leadlandlord/integrations/twilio';
import { getAnthropicClient } from '@leadlandlord/integrations/anthropic';
import { log } from '@leadlandlord/shared/log';
import { bustSiteHostTags } from '@/lib/site-host-revalidate';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PhoneCandidateRow extends PhoneProvision {
  // convenience alias so callers don't need to import PhoneProvision directly
}

export interface FindCandidatesResult {
  ok: boolean;
  candidates?: PhoneCandidateRow[];
  message?: string;
}

export interface RecommendResult {
  ok: boolean;
  candidates?: PhoneCandidateRow[];
  message?: string;
}

export interface ProvisionResult {
  ok: boolean;
  trackingNumber?: string;
  message?: string;
}

// ─── Server actions ────────────────────────────────────────────────────────────

const SiteIdSchema = z.string().uuid();

/**
 * Step 1: Fetch 5 available Twilio numbers for the site's city area code and
 * insert them as phone_provisions rows.
 *
 * Idempotent in the sense that each call inserts a fresh batch — the operator
 * can retry if they want different candidates. Old unprovisioned rows are left
 * in place as audit history.
 */
export async function findPhoneCandidates(siteId: string): Promise<FindCandidatesResult> {
  const parseResult = SiteIdSchema.safeParse(siteId);
  if (!parseResult.success) return { ok: false, message: 'invalid site id' };

  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  let availableNumbers;
  try {
    availableNumbers = await listAvailableNumbers({
      city: site.city,
      state: site.state,
      limit: 5,
    });
  } catch (err) {
    log.error(
      { siteId, city: site.city, state: site.state, err: err instanceof Error ? err.message : err },
      'listAvailableNumbers failed',
    );
    return { ok: false, message: err instanceof Error ? err.message : 'Twilio lookup failed' };
  }

  if (availableNumbers.length === 0) {
    return {
      ok: false,
      message: `No numbers available for ${site.city}, ${site.state}. Use manual override.`,
    };
  }

  // Insert all candidates as audit rows
  const inserted = await db
    .insert(phoneProvisions)
    .values(
      availableNumbers.map((n) => ({
        siteId,
        candidateE164: n.e164,
        twilioNumberSid: n.sid,
        locality: n.locality,
        region: n.region,
        capabilities: n.capabilities,
        recommended: false,
        chosen: false,
      })),
    )
    .returning();

  log.info(
    { siteId, count: inserted.length, city: site.city, state: site.state },
    'phone candidates inserted',
  );
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true, candidates: inserted };
}

/**
 * Step 2: Read the most-recently-inserted batch of candidates for this site,
 * ask Haiku to pick the best one, and update the recommended row's rationale.
 *
 * Returns the full set (recommended + runners-up) with rationale attached.
 *
 * Uses a direct Anthropic (Haiku) call — no BaseAgent, no agent_runs row.
 * Audit trail lives entirely in phone_provisions.
 */
export async function recommendNumber(siteId: string): Promise<RecommendResult> {
  const parseResult = SiteIdSchema.safeParse(siteId);
  if (!parseResult.success) return { ok: false, message: 'invalid site id' };

  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  // Read the latest batch: the 5 most-recently inserted rows for this site
  // (ordered by createdAt desc, take 5 — this is the last findPhoneCandidates batch)
  const allRows = await db
    .select()
    .from(phoneProvisions)
    .where(eq(phoneProvisions.siteId, siteId))
    .orderBy(desc(phoneProvisions.createdAt))
    .limit(5);

  if (allRows.length === 0) {
    return { ok: false, message: 'No candidates found. Run "Find phone numbers" first.' };
  }

  // Build prompt for Haiku
  const candidateList = allRows
    .map(
      (r, i) =>
        `${i + 1}. ${r.candidateE164} | locality: ${r.locality ?? 'unknown'} | vanityScore: ${
          // vanity score was computed at insert time and stored in capabilities metadata;
          // we re-compute here from the stored e164 since it's cheap
          computeSimpleVanityHint(r.candidateE164)
        }`,
    )
    .join('\n');

  const prompt = `You are a phone-number selector for a local service business website.

Business context:
  - Niche: ${site.niche}
  - City: ${site.city}, ${site.state}

Available numbers (E.164 | locality | vanityScore 0-100):
${candidateList}

Pick the single best number for this business. Prefer: high vanity score (repetition, sequences, or keypad words), local area code match, voice-enabled.

Respond ONLY with a JSON object matching this exact schema — no markdown, no prose:
{
  "recommended_e164": "+1XXXXXXXXXX",
  "rationale": "One sentence explaining why this number is best for the business.",
  "runners_up": [
    { "e164": "+1XXXXXXXXXX", "rationale": "Brief reason." }
  ]
}`;

  let aiResult: { recommended_e164: string; rationale: string; runners_up: Array<{ e164: string; rationale: string }> };

  try {
    const anthropic = getAnthropicClient();
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    aiResult = JSON.parse(text);
  } catch (err) {
    log.error(
      { siteId, err: err instanceof Error ? err.message : err },
      'Haiku recommendation failed',
    );
    // Gracefully degrade: pick the first candidate as recommended with no rationale
    aiResult = {
      recommended_e164: allRows[0]!.candidateE164,
      rationale: null as unknown as string,
      runners_up: [],
    };
  }

  // Update the recommended row
  const recommendedE164 = aiResult.recommended_e164;
  const rationaleMap = new Map<string, string>();
  rationaleMap.set(recommendedE164, aiResult.rationale);
  for (const ru of aiResult.runners_up ?? []) {
    if (ru.e164 && ru.rationale) rationaleMap.set(ru.e164, ru.rationale);
  }

  // Update rows in DB
  const updated: PhoneCandidateRow[] = [];
  for (const row of allRows) {
    const isRecommended = row.candidateE164 === recommendedE164;
    const rationale = rationaleMap.get(row.candidateE164) ?? null;
    const [updatedRow] = await db
      .update(phoneProvisions)
      .set({ recommended: isRecommended, rationale })
      .where(eq(phoneProvisions.id, row.id))
      .returning();
    if (updatedRow) updated.push(updatedRow);
  }

  // Sort: recommended first
  updated.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));

  log.info({ siteId, recommended: recommendedE164 }, 'phone recommendation written');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true, candidates: updated };
}

/**
 * Step 3: Provision the chosen number with Twilio, write it to sites.trackingNumber
 * and sites.twilioPhoneSid, and mark the phone_provisions row as chosen.
 */
export async function provisionChosenNumber(
  siteId: string,
  e164: string,
): Promise<ProvisionResult> {
  const parseResult = SiteIdSchema.safeParse(siteId);
  if (!parseResult.success) return { ok: false, message: 'invalid site id' };

  const e164Parsed = z.string().min(10).safeParse(e164);
  if (!e164Parsed.success) return { ok: false, message: 'invalid phone number' };

  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  // Call existing provisionNumber (handles MOCK_TELEPHONY guard).
  // Pass voice + status webhook URLs so Twilio wires them up at buy time —
  // otherwise the IncomingPhoneNumber resource has no VoiceUrl and inbound
  // calls go nowhere until the operator hits the manual-override "Save" path.
  const baseUrl = process.env.OPERATOR_PUBLIC_URL ?? '';
  let tracking;
  try {
    tracking = await provisionNumber({
      siteId,
      phoneNumber: e164, // provision the exact number the operator selected
      voiceUrl: baseUrl ? `${baseUrl}/api/webhooks/twilio/voice` : undefined,
      statusCallbackUrl: baseUrl ? `${baseUrl}/api/webhooks/twilio/status` : undefined,
    });
  } catch (err) {
    log.error(
      { siteId, e164, err: err instanceof Error ? err.message : err },
      'provisionNumber failed',
    );
    return { ok: false, message: err instanceof Error ? err.message : 'Provision failed' };
  }

  // Update site row with the provisioned number
  await db
    .update(sites)
    .set({
      trackingNumber: tracking.number,
      twilioPhoneSid: tracking.twilio_sid ?? null,
      trackingProvider: tracking.provider,
      updatedAt: new Date(),
    })
    .where(eq(sites.id, siteId));

  // Mark the phone_provisions row as chosen
  // Find the most recent row matching this e164 for this site
  const provisionRows = await db
    .select()
    .from(phoneProvisions)
    .where(eq(phoneProvisions.siteId, siteId))
    .orderBy(desc(phoneProvisions.createdAt))
    .limit(20);

  const matchRow = provisionRows.find((r) => r.candidateE164 === e164);
  if (matchRow) {
    await db
      .update(phoneProvisions)
      .set({ chosen: true, provisionedAt: new Date() })
      .where(eq(phoneProvisions.id, matchRow.id));
  }

  log.info({ siteId, e164, trackingNumber: tracking.number, provider: tracking.provider }, 'phone provisioned');
  await bustSiteHostTags([`site:tracking:${siteId}`]);
  revalidatePath(`/operator/sites/${siteId}`);
  revalidatePath('/operator/portfolio');
  return { ok: true, trackingNumber: tracking.number };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Simple vanity hint string passed to the prompt. Returns a numeric score
 * derived from the last 7 digits so the model has a pre-computed signal.
 * Mirrors the full computeVanityScore in available-numbers.ts but inlined
 * here to avoid importing the integrations package from a server action
 * (would be fine, but keeps the dependency surface minimal).
 */
function computeSimpleVanityHint(e164: string): number {
  const digits = e164.replace(/\D/g, '').slice(-7);
  if (digits.length < 7) return 0;
  let score = 0;
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
  const last4 = digits.slice(-4);
  if (last4 === last4.split('').reverse().join('')) score += 15;
  return Math.min(score, 100);
}
