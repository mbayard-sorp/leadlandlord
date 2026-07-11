/**
 * Tenant-facing lead notification fan-out (ADR 0031, Phase D).
 *
 * Fires once LeadQualifier has persisted structured qualification onto the
 * calls row (see the post-call webhook, which calls this after that write).
 * Delivers:
 *   - SMS summary via `sendSms` to `tenants.phone`
 *   - Email (summary + transcript excerpt + signed recording link) via
 *     `sendEmail` to `tenants.email`
 * `Promise.allSettled`'d, writing `calls.tenantSmsStatus` /
 * `calls.tenantEmailStatus` ('sent' | 'skipped' | 'failed'; skip-not-error
 * when the tenant has no phone/email on file, or the site has no tenant).
 */

import { eq } from 'drizzle-orm';
import { getDb, calls, sites, tenants, type Call, type Site, type Tenant } from '@leadlandlord/db';
import { sendSms } from '@leadlandlord/integrations/twilio';
import { sendEmail } from '@leadlandlord/integrations/resend';
import { formatTenantLeadSms, formatTenantLeadEmail } from '@leadlandlord/shared/tenant-lead-format';
import { signRecordingToken } from '@leadlandlord/shared/tenant-recording-token';
import { log } from '@leadlandlord/shared/log';

export interface TenantNotifyResult {
  smsStatus: string;
  emailStatus: string;
}

export async function notifyTenantOfQualifiedLead(callId: string): Promise<TenantNotifyResult> {
  const db = getDb();

  const call = (await db.select().from(calls).where(eq(calls.id, callId)).limit(1))[0];
  if (!call) {
    log.warn({ callId }, 'tenant-lead-notify: call not found');
    return { smsStatus: 'skipped', emailStatus: 'skipped' };
  }

  const site = (await db.select().from(sites).where(eq(sites.id, call.siteId)).limit(1))[0];
  const tenant = site?.tenantId
    ? (await db.select().from(tenants).where(eq(tenants.id, site.tenantId)).limit(1))[0]
    : undefined;

  if (!site || !tenant) {
    log.info({ callId, siteId: call.siteId }, 'tenant-lead-notify: no tenant on file, skipping');
    return writeAndReturn(db, callId, 'skipped', 'skipped');
  }

  const [smsResult, emailResult] = await Promise.allSettled([
    notifyTenantSms(call, site, tenant),
    notifyTenantEmail(call, site, tenant),
  ]);

  const smsStatus = statusOf(smsResult, 'sms', callId);
  const emailStatus = statusOf(emailResult, 'email', callId);

  return writeAndReturn(db, callId, smsStatus, emailStatus);
}

async function writeAndReturn(
  db: ReturnType<typeof getDb>,
  callId: string,
  smsStatus: string,
  emailStatus: string,
): Promise<TenantNotifyResult> {
  await db.update(calls).set({ tenantSmsStatus: smsStatus, tenantEmailStatus: emailStatus }).where(eq(calls.id, callId));
  return { smsStatus, emailStatus };
}

function statusOf(
  result: PromiseSettledResult<string>,
  channel: 'sms' | 'email',
  callId: string,
): string {
  if (result.status === 'fulfilled') return result.value;
  log.error(
    { err: result.reason instanceof Error ? result.reason.message : result.reason, callId, channel },
    `tenant-lead-notify: ${channel} fan-out crashed`,
  );
  return 'failed';
}

async function notifyTenantSms(call: Call, site: Site, tenant: Tenant): Promise<string> {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!tenant.phone || !from || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return 'skipped';
  }
  // Only promise "Recording + full details emailed." when the email fan-out
  // is actually going to fire — mirrors notifyTenantEmail's own skip gate.
  const emailExpected = Boolean(
    tenant.email && process.env.RESEND_FROM_ADDRESS && process.env.RESEND_API_KEY,
  );
  const body = formatTenantLeadSms({ businessName: tenant.businessName }, callToLeadInfo(call), emailExpected);
  await sendSms({ to: tenant.phone, from, body });
  return 'sent';
}

async function notifyTenantEmail(call: Call, site: Site, tenant: Tenant): Promise<string> {
  const from = process.env.RESEND_FROM_ADDRESS;
  if (!tenant.email || !from || !process.env.RESEND_API_KEY) {
    return 'skipped';
  }

  const recordingUrl = buildSignedRecordingUrl(call);
  const { subject, text, html } = formatTenantLeadEmail(
    { businessName: tenant.businessName },
    callToLeadInfo(call),
    { recordingUrl },
  );

  await sendEmail({ to: tenant.email, from, subject, text, html });
  return 'sent';
}

function callToLeadInfo(call: Call) {
  const metadata = (call.metadata as Record<string, unknown> | null) ?? {};
  return {
    callerName: call.callerName,
    callerNumber: call.callerNumber,
    qualificationScore: call.qualificationScore,
    qualificationIntent: call.qualificationIntent,
    qualificationUrgency: call.qualificationUrgency,
    qualificationJobType: call.qualificationJobType,
    qualificationBudgetBand: call.qualificationBudgetBand,
    qualificationAddress: call.qualificationAddress,
    transcript: call.transcript,
    warmTransfer: metadata.warmTransfer === true,
  };
}

/**
 * Builds a signed, 7-day tenant-recording link for `call`, or null when
 * there's no recording yet (Twilio `recordingUrl` OR an ElevenLabs
 * conversation for AI-answered calls — see
 * apps/operator/app/api/tenant-recordings/[callId]/route.ts) or no secret
 * configured to sign with. Base URL mirrors the OPERATOR_PUBLIC_URL usage
 * elsewhere (e.g. apps/operator/app/operator/sites/[id]/actions.ts).
 */
function buildSignedRecordingUrl(call: Call): string | null {
  if (!call.recordingUrl && !call.elevenlabsConversationId) return null;
  const secret = process.env.TENANT_RECORDING_SECRET || process.env.OPERATOR_SESSION_SECRET;
  if (!secret) return null;

  const token = signRecordingToken(call.id, secret);
  const baseUrl = (process.env.OPERATOR_PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${baseUrl}/api/tenant-recordings/${call.id}?t=${token}`;
}
