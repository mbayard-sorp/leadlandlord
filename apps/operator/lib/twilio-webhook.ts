import { headers } from 'next/headers';
import { verifyWebhookSignature } from '@leadlandlord/integrations/twilio';

/**
 * Read all form-urlencoded params from a Twilio webhook POST. Twilio sends
 * application/x-www-form-urlencoded bodies — never JSON.
 */
export async function readTwilioParams(req: Request): Promise<Record<string, string>> {
  const text = await req.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

/**
 * Reconstruct the absolute URL Twilio used to call the webhook. Vercel sets
 * `x-forwarded-host` and `x-forwarded-proto`; if those are missing fall back to
 * the request URL. Twilio's signature check requires the EXACT URL it called,
 * so respect any custom domain or vanity host.
 */
export async function absoluteWebhookUrl(req: Request): Promise<string> {
  const h = await headers();
  const url = new URL(req.url);
  const proto = h.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
}

/** Verify the Twilio signature on an incoming webhook. */
export async function verifyTwilioRequest(req: Request, params: Record<string, string>): Promise<boolean> {
  // Allow disabling signature verification in dev.
  if (process.env.TWILIO_SIGNATURE_VERIFY === 'false') return true;
  const url = await absoluteWebhookUrl(req);
  const h = await headers();
  const sig = h.get('x-twilio-signature');
  return verifyWebhookSignature({ url, params, signature: sig });
}
