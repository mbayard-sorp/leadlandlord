import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import { isSuppressed } from '@leadlandlord/db/suppression';

export const ComplianceGuardInput = z.object({
  scope: z.enum([
    'outreach_email',
    'outreach_sms',
    'outreach_voice',
    'site_content',
    // Phase E additions:
    'voice_transcript',
    'site_publish',
  ]),
  /** The text we're about to evaluate (SMS body, email body, page content,
   *  voice transcript, or rendered MDX). For `site_publish` you can also
   *  pass an array of pages via metadata.pages — see notes below. */
  text: z.string(),
  /** Recipient identifier — required for outreach scopes. Phone (E.164) for sms/voice, email for email. */
  recipient: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const Violation = z.object({
  rule: z.string(),
  severity: z.enum(['blocker', 'warning']),
  message: z.string(),
  details: z.array(z.string()).optional(),
});
export const ComplianceGuardOutput = z.object({
  ok: z.boolean(),
  violations: z.array(Violation),
});

export type ComplianceGuardInput = z.infer<typeof ComplianceGuardInput>;
export type ComplianceGuardOutput = z.infer<typeof ComplianceGuardOutput>;
type Violations = z.infer<typeof Violation>[];

/**
 * Real Compliance Guard. Runs the appropriate rule pack for each scope:
 *
 *   outreach_sms      — recipient suppression check; STOP-keyword presence
 *   outreach_voice    — recipient suppression check
 *   outreach_email    — recipient suppression; CAN-SPAM unsubscribe + zip
 *   site_content      — soft brand/claim warnings
 *   voice_transcript  — TCPA AI-disclosure in first 10 seconds (block on miss)
 *   site_publish      — fabrication audit on rendered MDX before Sanity publish
 *
 * The output `ok` is true only when there are NO blocker violations. Warnings
 * don't stop outreach but are logged + surfaced via agent_runs.metadata for
 * the operator to review.
 */
export class ComplianceGuard extends BaseAgent<typeof ComplianceGuardInput, typeof ComplianceGuardOutput> {
  constructor() {
    super({
      name: 'compliance-guard',
      inputSchema: ComplianceGuardInput,
      outputSchema: ComplianceGuardOutput,
      defaultDailyCapUsd: 1,
    });
  }

  protected async execute(
    input: ComplianceGuardInput,
    ctx: AgentContext,
  ): Promise<ComplianceGuardOutput> {
    const violations: Violations = [];

    switch (input.scope) {
      case 'outreach_sms':
        await checkSmsSuppression(input, violations);
        checkSmsBody(input, violations);
        break;
      case 'outreach_voice':
        await checkVoiceSuppression(input, violations);
        break;
      case 'outreach_email':
        await checkEmailSuppression(input, violations);
        checkEmailBody(input, violations);
        break;
      case 'site_content':
        checkSiteContent(input, violations);
        break;
      case 'voice_transcript':
        checkVoiceTranscript(input, violations);
        break;
      case 'site_publish':
        checkSitePublish(input, violations);
        break;
    }

    const blockers = violations.filter((v) => v.severity === 'blocker');
    const ok = blockers.length === 0;
    if (!ok) {
      ctx.log.warn(
        { scope: input.scope, blockers: blockers.length, warnings: violations.length - blockers.length },
        'compliance-guard blocked',
      );
    } else if (violations.length > 0) {
      ctx.log.info(
        { scope: input.scope, warnings: violations.length },
        'compliance-guard pass with warnings',
      );
    }
    return { ok, violations };
  }
}

async function checkSmsSuppression(input: ComplianceGuardInput, violations: Violations): Promise<void> {
  if (!input.recipient) {
    violations.push({
      rule: 'recipient_required',
      severity: 'blocker',
      message: 'SMS outreach requires a recipient phone number',
    });
    return;
  }
  if (await isSuppressed(input.recipient, 'phone')) {
    violations.push({
      rule: 'sms_suppressed',
      severity: 'blocker',
      message: `Recipient ${input.recipient} is on the suppression list (TCPA / STOP)`,
    });
  }
}

async function checkVoiceSuppression(input: ComplianceGuardInput, violations: Violations): Promise<void> {
  if (!input.recipient) {
    violations.push({
      rule: 'recipient_required',
      severity: 'blocker',
      message: 'Voice outreach requires a recipient phone number',
    });
    return;
  }
  if (await isSuppressed(input.recipient, 'phone')) {
    violations.push({
      rule: 'voice_suppressed',
      severity: 'blocker',
      message: `Recipient ${input.recipient} is on the suppression list (TCPA / DNC)`,
    });
  }
}

async function checkEmailSuppression(input: ComplianceGuardInput, violations: Violations): Promise<void> {
  if (!input.recipient) {
    violations.push({
      rule: 'recipient_required',
      severity: 'blocker',
      message: 'Email outreach requires a recipient email address',
    });
    return;
  }
  if (await isSuppressed(input.recipient, 'email')) {
    violations.push({
      rule: 'email_suppressed',
      severity: 'blocker',
      message: `Recipient ${input.recipient} is on the suppression list (CAN-SPAM unsubscribe / bounce)`,
    });
  }
}

/**
 * SMS bodies should mention "STOP" so recipients know how to opt out. Not a
 * legal requirement at every send, but Twilio's A2P 10DLC review checks for
 * it and carriers filter messages that lack it.
 */
function checkSmsBody(input: ComplianceGuardInput, violations: Violations): void {
  const lower = input.text.toLowerCase();
  if (!/\bstop\b/.test(lower)) {
    violations.push({
      rule: 'sms_no_opt_out_keyword',
      severity: 'warning',
      message: 'SMS body should mention "STOP" so recipients know how to opt out',
    });
  }
  if (input.text.length > 1600) {
    violations.push({
      rule: 'sms_too_long',
      severity: 'warning',
      message: `SMS body is ${input.text.length} chars; carriers split + may charge for >1600`,
    });
  }
}

/**
 * CAN-SPAM checks for cold email:
 *   - Must include unsubscribe mechanism (link or instruction)
 *   - Should include sender's physical address (warning — not a hard blocker
 *     because we may serve from a virtual address)
 *   - Subject line shouldn't be misleading
 */
function checkEmailBody(input: ComplianceGuardInput, violations: Violations): void {
  const lower = input.text.toLowerCase();
  const hasUnsubscribe =
    /unsubscribe/.test(lower) || /opt[- ]?out/.test(lower) || /reply.*remove/.test(lower);
  if (!hasUnsubscribe) {
    violations.push({
      rule: 'can_spam_no_unsubscribe',
      severity: 'blocker',
      message: 'CAN-SPAM requires an unsubscribe mechanism (link or "reply with REMOVE")',
    });
  }
  // Physical address heuristic — look for a 5-digit ZIP somewhere in the body.
  const hasZip = /\b\d{5}(-\d{4})?\b/.test(input.text);
  if (!hasZip) {
    violations.push({
      rule: 'can_spam_no_address',
      severity: 'warning',
      message:
        'CAN-SPAM requires the sender\'s physical postal address — none detected in body',
    });
  }
}

/**
 * Site content checks — soft warnings only since the model occasionally
 * generates phrases that resemble fake claims. Hard blocks are deliberately
 * narrow so we don't over-flag legitimate copy.
 */
function checkSiteContent(input: ComplianceGuardInput, violations: Violations): void {
  const text = input.text;
  const lower = text.toLowerCase();

  // License # claims — flag specific-looking license numbers we may not have
  // verified. Operator should swap in the real one before live deploys.
  if (/license\s*[#:]?\s*(\d{4,}|[a-z]{1,3}-\d{4,})/i.test(text)) {
    violations.push({
      rule: 'license_number_present',
      severity: 'warning',
      message:
        'Site content contains a specific license number — verify it matches the partnered provider before going live',
    });
  }

  // Fake-award flags
  if (/(best of|#1|number\s+one|top[- ]rated)\s+(in\s+)?(the\s+)?(state|country|usa|america|world)/i.test(text)) {
    violations.push({
      rule: 'unverified_superlative',
      severity: 'warning',
      message: 'Content claims "best/top in state/country" — these are FTC-flagged unless documented',
    });
  }

  // Fake-review pattern
  if (/(\d+(\.\d+)?)\s*\/\s*5\s*stars?\s+(based on|from)\s+(\d+|hundreds|thousands)/i.test(lower)) {
    violations.push({
      rule: 'fake_review_aggregate',
      severity: 'warning',
      message:
        'Content asserts a specific star rating + review count — only include when sourced from a real review platform',
    });
  }
}

/**
 * TCPA voice-transcript audit. The FCC's 2024 ruling requires AI-generated
 * voice calls to disclose AI involvement at the start of the call. We look at
 * roughly the first 10 seconds (~150 chars at average speaking rate, or the
 * first sentence-ish chunk if metadata.firstNSeconds is supplied as text).
 *
 * Pass `metadata.firstSeconds` (string) to override the auto-window — useful
 * when callers already have segment-level timestamps from Twilio/Whisper.
 */
function checkVoiceTranscript(input: ComplianceGuardInput, violations: Violations): void {
  const meta = (input.metadata ?? {}) as Record<string, unknown>;
  const firstSeconds =
    typeof meta.firstSeconds === 'string' && meta.firstSeconds.length > 0
      ? meta.firstSeconds
      : input.text.slice(0, 200);
  const disclosureRe =
    /(this is an? (ai|automated|computer|virtual)|i('m| am) an? (ai|virtual|automated|computer)|automated (assistant|message|call))/i;
  if (!disclosureRe.test(firstSeconds)) {
    violations.push({
      rule: 'tcpa_no_ai_disclosure',
      severity: 'blocker',
      message:
        'TCPA: AI-generated voice call must disclose AI involvement within the first 10 seconds',
    });
  }
}

/**
 * Pre-publish audit on rendered site MDX (per page). Blocks on fabrications
 * we should never publish; warns on softer marketing claims that are legal
 * but should be reviewed.
 *
 * Hard blockers:
 *   - Fabricated awards: "award-winning", "5-star", "#1 in <city>" without a
 *     citation/source line nearby.
 *   - License-number-shaped strings without a state qualifier.
 *   - Fake certifications (BBB A+, EPA-certified, etc) — we don't ship those
 *     unless the operator manually verifies.
 *
 * Pass `metadata.allowSoftClaims = true` to downgrade these to warnings — used
 * by content-engine eval mode where we want to surface but not block.
 */
function checkSitePublish(input: ComplianceGuardInput, violations: Violations): void {
  const text = input.text;
  const meta = (input.metadata ?? {}) as Record<string, unknown>;
  const softOnly = meta.allowSoftClaims === true;

  const offendingLines = (re: RegExp): string[] => {
    const out: string[] = [];
    for (const line of text.split('\n')) {
      if (re.test(line)) out.push(line.trim().slice(0, 200));
    }
    return out;
  };

  // 1. "5-star review" / "award-winning" without a nearby citation/source word.
  const fakeAwardRe = /(\baward[- ]winning\b|\b5[- ]star\b|\bfive[- ]star\b)/i;
  if (fakeAwardRe.test(text)) {
    const hasCitation = /(source:|according to|reviewed by|google reviews|yelp|bbb-verified)/i.test(text);
    if (!hasCitation) {
      violations.push({
        rule: 'fabricated_award',
        severity: softOnly ? 'warning' : 'blocker',
        message:
          'Page asserts award/5-star claim without a citation. Add a source line or remove the claim.',
        details: offendingLines(fakeAwardRe).slice(0, 5),
      });
    }
  }

  // 2. "#1 in <city/state>" — fabricated rank claim.
  const numberOneRe = /(#\s*1|number\s+one|top[- ]rated)\s+in\s+[A-Z][a-zA-Z]+/;
  if (numberOneRe.test(text)) {
    violations.push({
      rule: 'fabricated_rank',
      severity: softOnly ? 'warning' : 'blocker',
      message: 'Page claims "#1 / top-rated in <city>" — this is fabricated unless tied to a verifiable source.',
      details: offendingLines(numberOneRe).slice(0, 5),
    });
  }

  // 3. License-number-shaped string without state context. Look for a 5+ digit
  //    license number with no two-letter state code or "licensed in <state>"
  //    nearby on the same line.
  const licenseRe = /\blicense\s*[#:]?\s*(\d{4,}|[A-Z]{1,3}-?\d{4,})/i;
  if (licenseRe.test(text)) {
    const lines = text.split('\n').filter((l) => licenseRe.test(l));
    const offending = lines.filter((l) => !/\b([A-Z]{2}|licensed in|state of)\b/.test(l));
    if (offending.length > 0) {
      violations.push({
        rule: 'fabricated_license',
        severity: softOnly ? 'warning' : 'blocker',
        message:
          'Page lists a license number without a state qualifier. Either remove it or qualify with the state of issue.',
        details: offending.slice(0, 5).map((l) => l.trim().slice(0, 200)),
      });
    }
  }

  // 4. Fake certifications we don't ship by default.
  const certRe = /\b(bbb a\+|bbb-accredited|epa[- ]certified|nate[- ]certified|iicrc[- ]certified)\b/i;
  if (certRe.test(text)) {
    violations.push({
      rule: 'fabricated_certification',
      severity: softOnly ? 'warning' : 'blocker',
      message:
        'Page asserts a specific certification (BBB / EPA / NATE / IICRC) — only publish when verified for the partnered provider.',
      details: offendingLines(certRe).slice(0, 5),
    });
  }

  // 5. Soft warnings — generic superlatives that are legal but worth flagging.
  if (/(best in (the\s+)?(state|country|usa|america|world))/i.test(text)) {
    violations.push({
      rule: 'unverified_superlative',
      severity: 'warning',
      message: 'Page claims "best in state/country" — FTC-flagged unless documented.',
    });
  }
}
