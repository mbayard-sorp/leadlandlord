import { IntegrationError } from '@leadlandlord/shared/errors';

/**
 * BrightLocal citation submission stub.
 *
 * BrightLocal offers a paid Citation Builder API that can submit business
 * listings to ~70 directories on our behalf. Phase B uses an operator-driven
 * manual queue instead — this module exists to document the seam without
 * committing to the implementation. When the integration is ready, replace
 * this body with the real call; the rest of backlink-builder is already
 * shaped to call submitCitation per directory.
 */

export interface SubmitCitationInput {
  businessName: string;
  address?: string;
  phone: string;
  website: string;
  description: string;
  directory: string; // domain or BrightLocal directory id
}

export interface SubmitCitationResult {
  status: 'submitted' | 'queued' | 'mock';
  externalId?: string;
}

function isMock(): boolean {
  return process.env.BRIGHTLOCAL_DRY_RUN === 'true' || process.env.MOCK_TELEPHONY === 'true';
}

export async function submitCitation(input: SubmitCitationInput): Promise<SubmitCitationResult> {
  if (isMock()) {
    return { status: 'mock', externalId: `mock-${input.directory}-${Date.now()}` };
  }
  throw new IntegrationError('brightlocal', 'BrightLocal integration not yet implemented');
}
