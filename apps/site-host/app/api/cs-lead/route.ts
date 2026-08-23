import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendEmail } from '@leadlandlord/integrations/resend';
import {
  fetchCustomSiteAssessment,
  fetchCustomSiteByHost,
  fetchCustomSiteByKey,
  fetchCustomSiteLeadMagnetAsset,
  type CustomSite,
} from '../../../lib/customsites-sanity';
import { bandForScore, scoreAnswers } from '../../../lib/customsites-assessment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Custom Sites lead endpoint (ADR 0033 D4). Discriminated on `kind`:
 *
 *   contact (default) — ContactForm.tsx standard variant.
 *     { siteKey, firstName, lastName, email, phone?, message, company }
 *   consultation — ContactForm.tsx consultation variant: message optional,
 *     plus callTypes[] (goal | tax | profitability | other).
 *   magnet — LeadMagnetCard.tsx gated download: assetId (Sanity file asset,
 *     verified against the site's own csLeadMagnetBlock items — a client URL
 *     is never trusted). Emails the firm the lead, emails the visitor the
 *     PDF link, and returns { ok, url } so the download starts immediately.
 *     A non-JS (urlencoded) submit is answered with a 303 to the PDF.
 *   assessment — AssessmentQuiz.tsx: assessmentSlug + answers[] (option
 *     index per question). The route RE-SCORES server-side from the
 *     csAssessment doc — the client total is never trusted. Firm-only email
 *     (per operator decision); the visitor sees the result on screen.
 *
 *   -> 200 { ok: true, ... } | 4xx/5xx { error: string }
 *
 * No Postgres row, no agent_events row — csSite in Sanity is resolved
 * directly and the lead is forwarded to csSite.leadRecipients via Resend.
 * `company` is the honeypot field (hidden in the form via CSS); a non-empty
 * value means bot, and we silently report success without sending.
 *
 * The form posts same-origin through apps/site-host/proxy.ts (custom hosts
 * passthrough /api/cs-lead to this route directly), so no CORS handling is
 * needed here.
 */

// ---------------------------------------------------------------------------
// Per-IP + per-siteKey sliding-window rate limiter.
//
// Copied from apps/operator/app/api/bs/lead/route.ts rather than shared,
// because that route is Postgres-coupled (buildsell_sites) and this one is
// deliberately not (ADR 0033 D4) — no shared package seam exists between
// them and creating one for a ~30-line limiter isn't worth the coupling.
// ---------------------------------------------------------------------------
/** Max requests per IP within RATE_WINDOW_MS. */
const IP_RATE_LIMIT = 10;
/** Max requests per siteKey within RATE_WINDOW_MS. */
const SITE_RATE_LIMIT = 20;
/** Sliding window length in milliseconds. */
const RATE_WINDOW_MS = 60_000;

/**
 * In-memory store: key -> array of request timestamps (ms) within the window.
 * Module-level so it persists across requests on the same Node.js instance.
 * On Vercel, each serverless instance is isolated, which is acceptable — the
 * limits guard against burst on a single instance, not distributed flood.
 */
const _rateBuckets = new Map<string, number[]>();

/**
 * Returns true if the request should be rate-limited (bucket exceeded).
 * Mutates the bucket on allow.
 */
function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const bucket = _rateBuckets.get(key) ?? [];
  // Prune timestamps outside the current window.
  const trimmed = bucket.filter((t) => t > cutoff);
  if (trimmed.length >= limit) {
    // Do not record this request — just reject.
    _rateBuckets.set(key, trimmed);
    return true; // rate-limited
  }
  trimmed.push(now);
  _rateBuckets.set(key, trimmed);
  return false;
}

/**
 * Safely extract the client IP from the forwarded header Vercel sets.
 * Takes only the first address in the comma-separated list; strips port.
 * Never returns an empty string — falls back to "unknown".
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) {
      return first.trim().replace(/^\[/, '').replace(/\]:\d+$/, '').replace(/:\d+$/, '') || 'unknown';
    }
  }
  return 'unknown';
}

const BaseFields = {
  siteKey: z.string().trim().min(1).max(120),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(40).optional(),
  /** Honeypot — non-empty means bot. */
  company: z.string().nullish(),
};

const CallType = z.enum(['goal', 'tax', 'profitability', 'other']);

const ContactBody = z.object({
  kind: z.literal('contact'),
  ...BaseFields,
  message: z.string().trim().min(1).max(4000),
});

const ConsultationBody = z.object({
  kind: z.literal('consultation'),
  ...BaseFields,
  message: z.string().trim().max(4000).optional(),
  callTypes: z.array(CallType).max(4).optional(),
});

/** Sanity CDN filename param: turns an inline PDF response into a download. */
function withDownloadParam(url: string, title?: string | null): string {
  const slug = (title ?? 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}dl=${encodeURIComponent(`${slug || 'report'}.pdf`)}`;
}

const MagnetBody = z.object({
  kind: z.literal('magnet'),
  ...BaseFields,
  /** Sanity file-asset id of the requested PDF (e.g. "file-…-pdf"). */
  assetId: z.string().trim().min(1).max(200),
});

const AssessmentBody = z.object({
  kind: z.literal('assessment'),
  ...BaseFields,
  assessmentSlug: z.string().trim().min(1).max(200),
  /** Selected option index per question; -1 = skipped. */
  answers: z.array(z.number().int().min(-1).max(25)).max(50),
});

const Body = z.discriminatedUnion('kind', [ContactBody, ConsultationBody, MagnetBody, AssessmentBody]);

const CALL_TYPE_LABELS: Record<z.infer<typeof CallType>, string> = {
  goal: 'Goal Strategy Call',
  tax: 'Tax Strategy Call',
  profitability: 'Practice Profitability Call',
  other: 'Other',
};

/** Accepts the pre-kind JSON shape (no `kind` → contact) and non-JS
 * urlencoded posts from the magnet form's <form method="post"> fallback. */
async function parseRequestBody(req: Request): Promise<unknown> {
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const raw = (await req.json()) as Record<string, unknown>;
    if (raw && typeof raw === 'object' && !('kind' in raw)) raw.kind = 'contact';
    return raw;
  }
  const form = await req.formData();
  const raw: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue;
    raw[key] = value;
  }
  if (!raw.kind) raw.kind = 'contact';
  return raw;
}

/**
 * Resolve the csSite for this request. Prefers the Host header (set by
 * proxy.ts as x-site-host on every request) so a spoofed siteKey in the body
 * can't be used to redirect leads to a different site's recipients; falls
 * back to the body's siteKey for local/dev requests where the host isn't a
 * registered custom domain.
 */
async function resolveCsSite(req: Request, siteKey: string): Promise<CustomSite | null> {
  const hostHeader = req.headers.get('x-site-host');
  if (hostHeader) {
    const byHost = await fetchCustomSiteByHost(hostHeader);
    if (byHost) return byHost;
  }
  return fetchCustomSiteByKey(siteKey);
}

export async function POST(req: Request) {
  const isFormPost = !(req.headers.get('content-type') ?? '').includes('application/json');
  let payload: z.infer<typeof Body>;
  try {
    payload = Body.parse(await parseRequestBody(req));
  } catch (err) {
    console.warn('cs-lead: invalid payload', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  // Honeypot tripped — silently succeed without sending anything.
  if (payload.company && payload.company.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  // Rate limiting: per-IP and per-site burst protection.
  const clientIp = getClientIp(req);
  if (checkRateLimit(`ip:${clientIp}`, IP_RATE_LIMIT)) {
    console.warn('cs-lead: rate limited (ip)', { clientIp });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (checkRateLimit(`site:${payload.siteKey}`, SITE_RATE_LIMIT)) {
    console.warn('cs-lead: rate limited (site)', { siteKey: payload.siteKey });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const csSite = await resolveCsSite(req, payload.siteKey);
  if (!csSite || !csSite.leadRecipients || csSite.leadRecipients.length === 0) {
    console.warn('cs-lead: site not found or no lead recipients', { siteKey: payload.siteKey });
    return NextResponse.json({ error: 'site_not_found' }, { status: 404 });
  }

  const submitterName = `${payload.firstName} ${payload.lastName}`.trim();
  const sourceHost = req.headers.get('x-site-host') ?? req.headers.get('host') ?? 'unknown';
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? '';

  const contactLines = [
    `Name: ${submitterName}`,
    `Email: ${payload.email}`,
    `Phone: ${payload.phone ?? '—'}`,
  ];
  const footerLines = ['', `Source: ${sourceHost}`, `Submitted: ${new Date().toISOString()}`];

  let firmSubject = `New inquiry from ${submitterName} - ${csSite.name}`;
  let firmBody: string[] = [];
  let magnetUrl: string | null = null;
  let magnetTitle: string | null = null;

  if (payload.kind === 'contact') {
    firmBody = [...contactLines, '', 'Message:', payload.message, ...footerLines];
  } else if (payload.kind === 'consultation') {
    const callTypes = (payload.callTypes ?? []).map((t) => CALL_TYPE_LABELS[t]);
    firmSubject = `New consultation request from ${submitterName} - ${csSite.name}`;
    firmBody = [
      ...contactLines,
      `Call type${callTypes.length === 1 ? '' : 's'}: ${callTypes.length ? callTypes.join(', ') : '—'}`,
      ...(payload.message ? ['', 'Message:', payload.message] : []),
      ...footerLines,
    ];
  } else if (payload.kind === 'magnet') {
    const asset = await fetchCustomSiteLeadMagnetAsset(csSite.siteKey, payload.assetId);
    if (!asset) {
      console.warn('cs-lead: magnet asset not found for site', { siteKey: csSite.siteKey });
      return NextResponse.json({ error: 'asset_not_found' }, { status: 404 });
    }
    // Force an attachment. Sanity serves PDFs inline, so handing back the bare
    // CDN url meant both paths (location.assign here, the 303 below for non-JS)
    // navigated the visitor off the site into a PDF viewer. `?dl=` sets
    // Content-Disposition: attachment, so the file downloads and the page stays.
    magnetUrl = withDownloadParam(asset.url, asset.title);
    magnetTitle = asset.title;
    firmSubject = `New report download from ${submitterName} - ${csSite.name}`;
    firmBody = [...contactLines, `Requested report: ${asset.title}`, ...footerLines];
  } else {
    // assessment — re-score server-side; never trust a client-computed total.
    const assessment = await fetchCustomSiteAssessment(csSite.siteKey, payload.assessmentSlug);
    if (!assessment) {
      console.warn('cs-lead: assessment not found', { siteKey: csSite.siteKey, slug: payload.assessmentSlug });
      return NextResponse.json({ error: 'assessment_not_found' }, { status: 404 });
    }
    const score = scoreAnswers(assessment, payload.answers);
    const band = bandForScore(assessment, score);
    const stageTitle = band?.resultHeading ?? band?.stage?.title ?? 'Unknown';
    const answerLines = assessment.questions.map((q, i) => {
      const idx = payload.kind === 'assessment' ? payload.answers[i] : -1;
      const chosen = idx != null && idx >= 0 ? q.options[idx]?.label : null;
      return `${i + 1}. ${q.prompt}\n   → ${chosen ?? '(skipped)'}`;
    });
    firmSubject = assessment.emailSubject?.trim() || `New assessment result from ${submitterName} - ${csSite.name}`;
    firmBody = [
      ...(assessment.emailIntro ? [assessment.emailIntro, ''] : []),
      ...contactLines,
      `Score: ${score}`,
      `Stage: ${stageTitle}`,
      '',
      'Answers:',
      ...answerLines,
      ...footerLines,
    ];
  }

  try {
    await sendEmail({
      to: csSite.leadRecipients,
      from: fromAddress,
      subject: firmSubject,
      text: firmBody.join('\n'),
      replyTo: payload.email,
    });
  } catch (err) {
    // No PII beyond what the form already carries (name/email are the
    // submitter's own, already in the failed email's payload).
    console.error('cs-lead: resend send failed', {
      siteKey: payload.siteKey,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'delivery_failed' }, { status: 502 });
  }

  // Magnet: also email the visitor their link. Firm email already succeeded;
  // a visitor-email failure still returns the URL (the download proceeds).
  if (payload.kind === 'magnet' && magnetUrl) {
    try {
      await sendEmail({
        to: [payload.email],
        from: fromAddress,
        subject: `Your report from ${csSite.name}: ${magnetTitle}`,
        text: [
          `Hi ${payload.firstName},`,
          '',
          `Here's your copy of "${magnetTitle}":`,
          magnetUrl,
          '',
          `— ${csSite.name}`,
        ].join('\n'),
      });
    } catch (err) {
      console.error('cs-lead: visitor magnet email failed', {
        siteKey: payload.siteKey,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    // Non-JS <form> fallback: send the browser straight to the PDF.
    if (isFormPost) {
      return NextResponse.redirect(magnetUrl, 303);
    }
    return NextResponse.json({ ok: true, url: magnetUrl });
  }

  return NextResponse.json({ ok: true });
}
