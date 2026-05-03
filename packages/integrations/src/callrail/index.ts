import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import type { TrackingNumber } from '@leadlandlord/shared/types';

const CALLRAIL_BASE = 'https://api.callrail.com/v3';

const NumberSchema = z.object({
  id: z.string(),
  formatted_number: z.string(),
  number: z.string(),
});

export interface ProvisionNumberArgs {
  siteId: string;
  areaCodeHint?: string;
  forwardingNumber?: string;
  whisperMessage?: string;
  recordingEnabled?: boolean;
}

/**
 * Provision a tracking number.
 *
 * Falls back to a deterministic mock if:
 *   - CALLRAIL_API_KEY is not set, OR
 *   - process.env.MOCK_TELEPHONY === 'true'
 *
 * The Phase 1 dry-run script always sets MOCK_TELEPHONY=true so we never
 * burn money on a real number.
 */
export async function provisionNumber(args: ProvisionNumberArgs): Promise<TrackingNumber> {
  const useMock = !process.env.CALLRAIL_API_KEY || process.env.MOCK_TELEPHONY === 'true';

  if (useMock) {
    log.info({ siteId: args.siteId, provider: 'mock' }, 'using mock tracking number');
    return mockNumber(args);
  }

  const accountId = process.env.CALLRAIL_ACCOUNT_ID;
  if (!accountId) {
    throw new IntegrationError('callrail', 'CALLRAIL_ACCOUNT_ID is required for live mode');
  }

  const res = await fetch(`${CALLRAIL_BASE}/a/${accountId}/trackers.json`, {
    method: 'POST',
    headers: {
      Authorization: `Token token="${process.env.CALLRAIL_API_KEY}"`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'source',
      name: `LeadLandlord-${args.siteId.slice(0, 8)}`,
      area_code: args.areaCodeHint,
      destination_number: args.forwardingNumber,
      whisper_message: args.whisperMessage ?? 'Call from LeadLandlord',
      record_calls: args.recordingEnabled ?? true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError('callrail', `provision failed: ${res.status} ${text}`, res.status, text);
  }

  const json = await res.json();
  const parsed = NumberSchema.parse(json);
  return {
    number: parsed.formatted_number,
    provider: 'callrail',
    whisper: args.whisperMessage,
    recording_enabled: args.recordingEnabled ?? true,
  };
}

function mockNumber(args: ProvisionNumberArgs): TrackingNumber {
  // Derive a stable fake number from the site id so re-runs produce the same one.
  const hash = simpleHash(args.siteId);
  const npa = String(200 + (hash % 700)).padStart(3, '0'); // valid-ish area code
  const nxx = String(200 + ((hash >> 8) % 700)).padStart(3, '0');
  const xxxx = String(hash % 10000).padStart(4, '0');
  return {
    number: `+1-${npa}-${nxx}-${xxxx}`,
    provider: 'mock',
    whisper: args.whisperMessage ?? 'Call from LeadLandlord (MOCK)',
    recording_enabled: false,
  };
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
