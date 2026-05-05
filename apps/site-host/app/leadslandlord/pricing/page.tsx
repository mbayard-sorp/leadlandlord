import { renderCorporateKind, corporateKindMetadata } from '../_lib';

export default async function CorporatePricing() {
  return renderCorporateKind('pricing');
}

export async function generateMetadata() {
  return corporateKindMetadata('pricing', '/pricing');
}
