import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import type { TrackingNumber } from '@leadlandlord/shared/types';

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

const IncomingNumberSchema = z.object({
  sid: z.string(),
  phone_number: z.string(),
  friendly_name: z.string().optional(),
});

export interface ProvisionNumberArgs {
  siteId: string;
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
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const useMock = !sid || !token || process.env.MOCK_TELEPHONY === 'true';

  if (useMock) {
    log.info({ siteId: args.siteId, provider: 'mock' }, 'using mock tracking number');
    return mockNumber(args);
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams();
  if (args.areaCodeHint) body.set('AreaCode', args.areaCodeHint);
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
 * 1. Whisper to the answering party (so they know it's a tracking number)
 * 2. Dial the forwarding number with dual-channel recording
 * 3. POST recording status to /api/webhooks/twilio/recording
 */
export function buildForwardingTwiml(opts: {
  forwardingNumber: string;
  whisperMessage?: string;
  recordingStatusCallback?: string;
}): string {
  const whisper = opts.whisperMessage ?? 'Call from LeadLandlord';
  const record = opts.recordingStatusCallback
    ? ` record="record-from-answer-dual" recordingStatusCallback="${escape(opts.recordingStatusCallback)}"`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial${record} answerOnBridge="true">
    <Number url="https://twimlets.com/message?Message[0]=${encodeURIComponent(whisper)}">${escape(opts.forwardingNumber)}</Number>
  </Dial>
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

function mockNumber(args: ProvisionNumberArgs): TrackingNumber {
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
