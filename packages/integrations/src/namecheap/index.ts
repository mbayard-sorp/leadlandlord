import { NotImplementedError } from '@leadlandlord/shared/errors';

export async function checkAvailability(_domain: string): Promise<{ available: boolean; price_usd?: number }> {
  // TODO(phase-2): Namecheap or Cloudflare Registrar — domain availability check.
  throw new NotImplementedError('namecheap.checkAvailability');
}

export async function registerDomain(_args: {
  domain: string;
  years?: number;
  whoisGuard?: boolean;
}): Promise<{ registrationId: string; expiresAt: string }> {
  // TODO(phase-2): real registration. SPENDS REAL MONEY — hard-gate behind explicit user approval.
  throw new NotImplementedError('namecheap.registerDomain');
}
