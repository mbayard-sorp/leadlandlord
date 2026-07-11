/**
 * Tenant-facing lead notification fan-out (ADR 0031).
 *
 * Phase C (this seam) wires the post-call webhook to call this function
 * after LeadQualifier persists the structured qualification onto the calls
 * row, so Phase D can implement real delivery without touching the webhook
 * route. Per the plan: SMS summary via `sendSms` to `tenants.phone` +
 * email (summary + transcript excerpt + signed recording link) via
 * `sendEmail` to `tenants.email`, `Promise.allSettled`'d, writing
 * `calls.tenantSmsStatus` / `calls.tenantEmailStatus` (skip-not-error when
 * the tenant has no phone/email on file).
 */

export interface TenantNotifyResult {
  smsStatus: string;
  emailStatus: string;
}

// TODO: Phase D implements delivery.
export async function notifyTenantOfQualifiedLead(_callId: string): Promise<TenantNotifyResult> {
  return { smsStatus: 'skipped', emailStatus: 'skipped' };
}
