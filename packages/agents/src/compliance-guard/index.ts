import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import { isSuppressed } from '@leadlandlord/db/suppression';

export const ComplianceGuardInput = z.object({
  scope: z.enum(['outreach_email', 'outreach_sms', 'outreach_voice', 'site_content']),
  /** The text we're about to send (SMS body, email body, or page content). */
  text: z.string(),
  /** Recipient identifier — required for outreach scopes. Phone (E.164) for sms/voice, email for email. */
  recipient: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const Violation = z.object({
  rule: z.string(),
  severity: z.enum(['blocker', 'warning']),
  message: z.string(),
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
 *   outreach_sms   — recipient suppression check; STOP-keyword presence
 *   outreach_voice — recipient suppression check
 *   outreach_email — recipient suppression check; CAN-SPAM (unsubscribe link
 *                    + physical address heuristic)
 *   site_content   — soft brand/claim checks (specific license #, "best in
 *                    state", fake awards) — flagged as warnings, not blockers
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
