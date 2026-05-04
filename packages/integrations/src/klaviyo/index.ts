import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const REVISION = '2024-10-15';

/**
 * Issue a request against the Klaviyo REST API.
 * Returns the parsed JSON body, or `null` for 204 responses.
 */
async function klaviyoFetch(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<unknown> {
  const apiKey = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!apiKey) {
    throw new IntegrationError('klaviyo', 'KLAVIYO_PRIVATE_API_KEY is required');
  }
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    accept: 'application/vnd.api+json',
    revision: REVISION,
    ...(init.headers ?? {}),
  };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/vnd.api+json';
  }
  const res = await fetch(`${KLAVIYO_BASE}${path}`, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    throw new IntegrationError(
      'klaviyo',
      `${init.method ?? 'GET'} ${path} → ${res.status} ${text}`,
      res.status,
      text,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new IntegrationError('klaviyo', `non-JSON response for ${path}: ${text.slice(0, 200)}`);
  }
}

const ProfileResponseSchema = z.object({
  data: z.object({ id: z.string(), type: z.literal('profile') }),
});

export interface UpsertProfileArgs {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  zip?: string;
  /** Free-form key/value pairs stored on the Klaviyo profile. */
  properties?: Record<string, unknown>;
}

/**
 * Upsert a Klaviyo profile by email or phone. Uses the dedicated
 * /api/profile-import endpoint which handles "create or update" with proper
 * deduplication on email + phone.
 *
 * Klaviyo docs: https://developers.klaviyo.com/en/reference/create_or_update_profile
 */
export async function createOrUpdateProfile(args: UpsertProfileArgs): Promise<{
  profileId: string;
}> {
  if (!args.email && !args.phone) {
    throw new IntegrationError('klaviyo', 'createOrUpdateProfile requires email or phone');
  }
  const attributes: Record<string, unknown> = {};
  if (args.email) attributes.email = args.email;
  if (args.phone) attributes.phone_number = normalizePhoneE164(args.phone);
  if (args.firstName) attributes.first_name = args.firstName;
  if (args.lastName) attributes.last_name = args.lastName;
  if (args.zip) attributes.location = { zip: args.zip };
  if (args.properties) attributes.properties = args.properties;

  const body = {
    data: {
      type: 'profile',
      attributes,
    },
  };

  const json = await klaviyoFetch('/profile-import/', { method: 'POST', body });
  const parsed = ProfileResponseSchema.parse(json);
  log.info({ profileId: parsed.data.id }, 'klaviyo profile upserted');
  return { profileId: parsed.data.id };
}

/**
 * Subscribe a profile to a list with email + SMS consent.
 *
 * Klaviyo's preferred endpoint for explicit consent is the bulk-subscription
 * job — even for a single profile.
 *
 * Klaviyo docs: https://developers.klaviyo.com/en/reference/subscribe_profiles
 */
export async function subscribeProfileToList(args: {
  listId: string;
  email?: string;
  phone?: string;
  consentMethod?: string;
}): Promise<void> {
  if (!args.email && !args.phone) {
    throw new IntegrationError('klaviyo', 'subscribeProfileToList requires email or phone');
  }
  const channels: Record<string, unknown> = {};
  if (args.email) channels.email = { marketing: { consent: 'SUBSCRIBED' } };
  if (args.phone) channels.sms = { marketing: { consent: 'SUBSCRIBED' } };

  const subscriptionAttrs: Record<string, unknown> = {
    subscriptions: channels,
  };
  if (args.email) (subscriptionAttrs as Record<string, unknown>).email = args.email;
  if (args.phone) (subscriptionAttrs as Record<string, unknown>).phone_number = normalizePhoneE164(args.phone);

  const body = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        custom_source: args.consentMethod ?? 'lead-form',
        profiles: {
          data: [
            {
              type: 'profile',
              attributes: subscriptionAttrs,
            },
          ],
        },
      },
      relationships: {
        list: {
          data: { type: 'list', id: args.listId },
        },
      },
    },
  };

  await klaviyoFetch('/profile-subscription-bulk-create-jobs/', { method: 'POST', body });
  log.info({ listId: args.listId }, 'klaviyo subscribed to list');
}

/**
 * Add an existing profile to a list without changing its subscription status.
 * Useful for segmenting profiles already opted-in.
 */
export async function addProfileToList(args: {
  listId: string;
  profileId: string;
}): Promise<void> {
  const body = {
    data: [{ type: 'profile', id: args.profileId }],
  };
  await klaviyoFetch(`/lists/${args.listId}/relationships/profiles/`, {
    method: 'POST',
    body,
  });
}

const ListResponseSchema = z.object({
  data: z.object({ id: z.string(), type: z.literal('list') }),
});

/**
 * Create a Klaviyo list (e.g., one per niche × city). Site Builder will call
 * this when provisioning a new tenant site.
 */
export async function createList(name: string): Promise<{ listId: string }> {
  const body = {
    data: {
      type: 'list',
      attributes: { name },
    },
  };
  const json = await klaviyoFetch('/lists/', { method: 'POST', body });
  const parsed = ListResponseSchema.parse(json);
  return { listId: parsed.data.id };
}

/** Klaviyo wants E.164. The site forms accept loose user input, so normalize. */
function normalizePhoneE164(raw: string): string {
  const digits = raw.replace(/[^+\d]/g, '');
  if (digits.startsWith('+')) return digits;
  // Default to US country code when missing.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}
