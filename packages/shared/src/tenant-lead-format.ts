/**
 * Pure formatting helpers for the tenant-facing "qualified lead" SMS/email
 * fan-out (ADR 0031, Phase D). Kept dependency-free (no DB/integration
 * imports) so they're trivially unit-testable and reusable if a future
 * channel (push notification, Slack, etc.) needs the same summary shape.
 */

export interface TenantLeadCallInfo {
  callerName?: string | null;
  callerNumber?: string | null;
  qualificationScore?: number | null;
  qualificationIntent?: string | null;
  qualificationUrgency?: string | null;
  qualificationJobType?: string | null;
  qualificationBudgetBand?: string | null;
  qualificationAddress?: string | null;
  transcript?: string | null;
  /** True when the call metadata flags a warm transfer to the tenant's phone. */
  warmTransfer?: boolean;
}

export interface TenantLeadSiteInfo {
  businessName: string;
}

const TRANSCRIPT_EXCERPT_MAX = 1500;

/** Human-friendly label for a caller — falls back to the raw number, then a generic label. */
export function callerLabel(call: TenantLeadCallInfo): string {
  if (call.callerName && call.callerName.trim().length > 0) return call.callerName.trim();
  if (call.callerNumber && call.callerNumber.trim().length > 0) return call.callerNumber.trim();
  return 'Unknown caller';
}

/**
 * Concise SMS body for a newly-qualified AI-answered lead. Kept under
 * ~320 chars (2-segment SMS) where the fields allow it.
 *
 * `emailExpected` gates the "Recording + full details emailed." line — only
 * true when the tenant email is actually going out (tenant has an email on
 * file and email sending is configured), so the SMS never promises a
 * follow-up email that isn't coming.
 */
export function formatTenantLeadSms(
  site: TenantLeadSiteInfo,
  call: TenantLeadCallInfo,
  emailExpected = false,
): string {
  const lines: string[] = [`New qualified lead for ${site.businessName}`];

  const who = callerLabel(call);
  const withNumber =
    call.callerName && call.callerNumber && call.callerName.trim() !== call.callerNumber.trim()
      ? `${who} (${call.callerNumber.trim()})`
      : who;
  lines.push(withNumber);

  const jobBits: string[] = [];
  if (call.qualificationJobType) jobBits.push(call.qualificationJobType);
  if (call.qualificationUrgency) jobBits.push(formatUrgency(call.qualificationUrgency));
  if (jobBits.length > 0) lines.push(jobBits.join(' · '));

  if (typeof call.qualificationScore === 'number') {
    lines.push(`Score: ${call.qualificationScore}/100`);
  }

  if (call.qualificationAddress) lines.push(call.qualificationAddress);

  if (emailExpected) lines.push('Recording + full details emailed.');

  return lines.join('\n');
}

export interface TenantLeadEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Full email summary for a newly-qualified AI-answered lead: subject +
 * text/html bodies including all qualification fields, a transcript
 * excerpt, an optional warm-transfer note, and an optional signed
 * recording link.
 */
export function formatTenantLeadEmail(
  site: TenantLeadSiteInfo,
  call: TenantLeadCallInfo,
  opts: { recordingUrl?: string | null } = {},
): TenantLeadEmail {
  const who = callerLabel(call);
  const subjectJobType = call.qualificationJobType ?? 'New lead';
  const subject = `Qualified lead: ${subjectJobType} — ${who}`;

  const fields: Array<[string, string]> = [];
  fields.push(['Caller', who]);
  if (call.callerNumber) fields.push(['Phone', call.callerNumber]);
  if (call.qualificationJobType) fields.push(['Job type', call.qualificationJobType]);
  if (call.qualificationUrgency) fields.push(['Urgency', formatUrgency(call.qualificationUrgency)]);
  if (typeof call.qualificationScore === 'number') {
    fields.push(['Qualification score', `${call.qualificationScore}/100`]);
  }
  if (call.qualificationBudgetBand) fields.push(['Budget', call.qualificationBudgetBand]);
  if (call.qualificationAddress) fields.push(['Address', call.qualificationAddress]);
  if (call.qualificationIntent) fields.push(['Intent', call.qualificationIntent]);

  const excerpt = call.transcript ? truncate(call.transcript, TRANSCRIPT_EXCERPT_MAX) : null;

  const textLines: string[] = [`New qualified lead for ${site.businessName}`, ''];
  for (const [label, value] of fields) textLines.push(`${label}: ${value}`);

  if (call.warmTransfer) {
    textLines.push('', 'This call was warm-transferred to your phone during the conversation.');
  }

  if (excerpt) {
    textLines.push('', 'Transcript excerpt:', excerpt);
  }

  if (opts.recordingUrl) {
    textLines.push('', `Recording: ${opts.recordingUrl}`);
  }

  const htmlFieldRows = fields
    .map(([label, value]) => `<tr><td style="padding:2px 8px 2px 0;color:#666">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('');

  const htmlParts: string[] = [
    `<p><strong>New qualified lead for ${escapeHtml(site.businessName)}</strong></p>`,
    `<table>${htmlFieldRows}</table>`,
  ];
  if (call.warmTransfer) {
    htmlParts.push('<p><em>This call was warm-transferred to your phone during the conversation.</em></p>');
  }
  if (excerpt) {
    htmlParts.push(`<p><strong>Transcript excerpt:</strong></p><p style="white-space:pre-wrap">${escapeHtml(excerpt)}</p>`);
  }
  if (opts.recordingUrl) {
    htmlParts.push(`<p><a href="${escapeHtml(opts.recordingUrl)}">Listen to recording</a></p>`);
  }

  return { subject, text: textLines.join('\n'), html: htmlParts.join('\n') };
}

function formatUrgency(u: string): string {
  return u.replace(/_/g, ' ');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
