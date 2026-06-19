// Plain (non-'use server') module so both the client components and the server
// actions can import these types. Do NOT put types in actions.ts — Turbopack's
// server-action transform turns every export of a 'use server' file into a
// server reference and crashes on erased type identifiers.
import type { BuildSellLeadResult } from '@leadlandlord/integrations/google-places';

/** A search result with the operator's saved CRM state overlaid (dates as ISO strings). */
export interface SearchLead extends BuildSellLeadResult {
  called: boolean;
  calledAt: string | null;
  note: string | null;
  /** YYYY-MM-DD */
  followUpAt: string | null;
}

/** A worked lead for the follow-up board (a row from buildsell_leads, serialized). */
export interface WorkedLead {
  placeId: string;
  displayName: string | null;
  nationalPhone: string | null;
  formattedAddress: string | null;
  trade: string | null;
  city: string | null;
  state: string | null;
  websiteUri: string | null;
  called: boolean;
  calledAt: string | null;
  note: string | null;
  /** YYYY-MM-DD */
  followUpAt: string | null;
}
