import { NotImplementedError } from '@leadlandlord/shared/errors';

export interface KeywordMetrics {
  keyword: string;
  search_volume: number;
  cpc: number;
  competition: number;
  kd: number;
}

export async function getLocalKeywordMetrics(_args: {
  keywords: string[];
  location: string;
}): Promise<KeywordMetrics[]> {
  // TODO(phase-2): POST https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live
  throw new NotImplementedError('dataforseo.getLocalKeywordMetrics');
}

export async function getSerpResults(_args: {
  keyword: string;
  location: string;
}): Promise<unknown> {
  // TODO(phase-2): POST https://api.dataforseo.com/v3/serp/google/organic/live/regular
  throw new NotImplementedError('dataforseo.getSerpResults');
}
