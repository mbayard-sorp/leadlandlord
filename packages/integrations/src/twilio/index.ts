import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import type { TrackingNumber } from '@leadlandlord/shared/types';
import { assertNotAuditing } from '../audit-guard';

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

const IncomingNumberSchema = z.object({
  sid: z.string(),
  phone_number: z.string(),
  friendly_name: z.string().optional(),
});

export interface ProvisionNumberArgs {
  siteId: string;
  /**
   * Exact E.164 to provision (e.g. "+15205550100"). When set, Twilio is
   * asked for this specific number and `areaCodeHint` is ignored.
   * Mutually exclusive with `areaCodeHint` per the Twilio API.
   */
  phoneNumber?: string;
  areaCodeHint?: string;
  forwardingNumber?: string;
  whisperMessage?: string;
  recordingEnabled?: boolean;
  /** Public webhook URL Twilio POSTs to when a call arrives. */
  voiceUrl?: string;
  /** Status callback URL for call lifecycle events. */
  statusCallbackUrl?: string;
}

/**
 * Provision a Twilio tracking number (Programmable Voice).
 *
 * Falls back to a deterministic mock if:
 *   - TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set, OR
 *   - process.env.MOCK_TELEPHONY === 'true'
 *
 * The Phase 1 dry-run script always sets MOCK_TELEPHONY=true so we never
 * burn money on a real number.
 *
 * Twilio API docs: https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource
 */
export async function provisionNumber(args: ProvisionNumberArgs): Promise<TrackingNumber> {
  assertNotAuditing('twilio.provisionNumber');
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const useMock = !sid || !token || process.env.MOCK_TELEPHONY === 'true';

  if (useMock) {
    log.info({ siteId: args.siteId, provider: 'mock' }, 'using mock tracking number');
    return mockNumber(args);
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams();
  // `PhoneNumber` and `AreaCode` are mutually exclusive per Twilio docs.
  // When the operator has chosen a specific number, send that exact E.164.
  if (args.phoneNumber) {
    body.set('PhoneNumber', args.phoneNumber);
  } else if (args.areaCodeHint) {
    body.set('AreaCode', args.areaCodeHint);
  }
  body.set('FriendlyName', `LeadLandlord-${args.siteId.slice(0, 8)}`);
  if (args.voiceUrl) {
    body.set('VoiceUrl', args.voiceUrl);
    body.set('VoiceMethod', 'POST');
  }
  if (args.statusCallbackUrl) {
    body.set('StatusCallback', args.statusCallbackUrl);
    body.set('StatusCallbackMethod', 'POST');
  }

  const res = await fetch(`${TWILIO_BASE}/Accounts/${sid}/IncomingPhoneNumbers.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError('twilio', `provision failed: ${res.status} ${text}`, res.status, text);
  }

  const json = await res.json();
  const parsed = IncomingNumberSchema.parse(json);
  return {
    number: parsed.phone_number,
    provider: 'twilio',
    twilio_sid: parsed.sid,
    whisper: args.whisperMessage,
    recording_enabled: args.recordingEnabled ?? true,
  };
}

/**
 * Update an already-provisioned tracking number — used by Trial Manager to
 * flip the forwarding destination from operator phone → tenant phone when a
 * trial begins.
 */
export interface UpdateNumberArgs {
  twilioSid: string;
  voiceUrl?: string;
  statusCallbackUrl?: string;
  friendlyName?: string;
}

export async function updateNumber(args: UpdateNumberArgs): Promise<void> {
  assertNotAuditing('twilio.updateNumber');
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new IntegrationError('twilio', 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');
  }
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams();
  if (args.voiceUrl) {
    body.set('VoiceUrl', args.voiceUrl);
    body.set('VoiceMethod', 'POST');
  }
  if (args.statusCallbackUrl) {
    body.set('StatusCallback', args.statusCallbackUrl);
    body.set('StatusCallbackMethod', 'POST');
  }
  if (args.friendlyName) body.set('FriendlyName', args.friendlyName);

  const res = await fetch(
    `${TWILIO_BASE}/Accounts/${sid}/IncomingPhoneNumbers/${args.twilioSid}.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError('twilio', `update failed: ${res.status} ${text}`, res.status, text);
  }
}

/**
 * Build TwiML for the inbound-call handler:
 *   1. Whisper to the answering party (so they know it's a tracking number).
 *      The whisper is delivered by a self-hosted whisperUrl that returns
 *      `<Response><Say>{message}</Say></Response>`.
 *   2. Dial the forwarding number with dual-channel recording.
 *   3. POST recording status to recordingStatusCallback.
 */
export function buildForwardingTwiml(opts: {
  forwardingNumber: string;
  /** URL that returns TwiML to play to the answering party as a whisper. */
  whisperUrl?: string;
  recordingStatusCallback?: string;
  /** Plain text greeting played to the caller (Polly TTS) before the dial. */
  inboundGreeting?: string;
}): string {
  const recordAttrs = opts.recordingStatusCallback
    ? ` record="record-from-answer-dual" recordingStatusCallback="${escape(opts.recordingStatusCallback)}" recordingStatusCallbackEvent="completed"`
    : '';
  const numberAttrs = opts.whisperUrl ? ` url="${escape(opts.whisperUrl)}"` : '';
  const greetingTag = opts.inboundGreeting
    ? `<Say voice="Polly.Joanna">${escape(opts.inboundGreeting)}</Say>\n  `
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${greetingTag}<Dial${recordAttrs} answerOnBridge="true">
    <Number${numberAttrs}>${escape(opts.forwardingNumber)}</Number>
  </Dial>
</Response>`;
}

/** TwiML that plays the whisper message to the answering party. */
export function buildWhisperTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escape(message)}</Say>
</Response>`;
}

/** TwiML for the case where no forwarding number is configured — go to voicemail. */
export function buildVoicemailTwiml(opts: {
  /** Plain text greeting — read by Twilio's Polly TTS when no audioUrl is set. */
  greeting?: string;
  /**
   * Public URL to a pre-rendered greeting MP3 (e.g. ElevenLabs synthesis
   * uploaded to Sanity assets). When present we use `<Play>` instead of
   * `<Say>` for a human-quality voice. Falls back to greeting text if the
   * URL is undefined.
   */
  audioUrl?: string;
  recordingStatusCallback?: string;
  transcribeCallback?: string;
}): string {
  const greeting =
    opts.greeting ??
    'Thanks for calling. Please leave a message after the tone and we will return your call.';
  const transcribe = opts.transcribeCallback
    ? ` transcribe="true" transcribeCallback="${escape(opts.transcribeCallback)}"`
    : '';
  const recordingCb = opts.recordingStatusCallback
    ? ` recordingStatusCallback="${escape(opts.recordingStatusCallback)}"`
    : '';
  const greetingTag = opts.audioUrl
    ? `<Play>${escape(opts.audioUrl)}</Play>`
    : `<Say voice="Polly.Joanna">${escape(greeting)}</Say>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${greetingTag}
  <Record maxLength="180" playBeep="true"${recordingCb}${transcribe} />
  <Hangup />
</Response>`;
}

/**
 * Send an outbound SMS via Twilio Messaging API. Used for lead notifications +
 * Phase 6 cold outreach.
 */
export interface SendSmsArgs {
  to: string;
  from: string;
  body: string;
}

export async function sendSms(args: SendSmsArgs): Promise<{ sid: string }> {
  assertNotAuditing('twilio.sendSms');
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new IntegrationError('twilio', 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');
  }
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams();
  body.set('To', args.to);
  body.set('From', args.from);
  body.set('Body', args.body);

  const res = await fetch(`${TWILIO_BASE}/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError('twilio', `sms failed: ${res.status} ${text}`, res.status, text);
  }
  const json = z.object({ sid: z.string() }).parse(await res.json());
  return { sid: json.sid };
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Verify a Twilio webhook signature.
 *
 * Twilio's algorithm:
 *   1. Take the full request URL (including any query string)
 *   2. Append POST params sorted alphabetically by key, concatenated as keyN+valueN
 *   3. HMAC-SHA1 with TWILIO_AUTH_TOKEN
 *   4. Base64 encode and compare to X-Twilio-Signature header
 *
 * Docs: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyWebhookSignature(args: {
  url: string;
  params: Record<string, string>;
  signature: string | null;
  authToken?: string;
}): boolean {
  const token = args.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  if (!token || !args.signature) return false;

  const sortedKeys = Object.keys(args.params).sort();
  let data = args.url;
  for (const key of sortedKeys) {
    data += key + args.params[key];
  }

  const expected = createHmac('sha1', token).update(data, 'utf-8').digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(args.signature);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function mockNumber(args: ProvisionNumberArgs): TrackingNumber {
  // If an explicit E.164 was chosen, honour it exactly (no fake number).
  if (args.phoneNumber) {
    return {
      number: args.phoneNumber,
      provider: 'mock',
      twilio_sid: undefined,
      whisper: args.whisperMessage ?? 'Call from LeadLandlord (MOCK)',
      recording_enabled: false,
    };
  }
  const hash = simpleHash(args.siteId);
  const npa = String(200 + (hash % 700)).padStart(3, '0');
  const nxx = String(200 + ((hash >> 8) % 700)).padStart(3, '0');
  const xxxx = String(hash % 10000).padStart(4, '0');
  return {
    number: `+1-${npa}-${nxx}-${xxxx}`,
    provider: 'mock',
    twilio_sid: undefined,
    whisper: args.whisperMessage ?? 'Call from LeadLandlord (MOCK)',
    recording_enabled: false,
  };
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
