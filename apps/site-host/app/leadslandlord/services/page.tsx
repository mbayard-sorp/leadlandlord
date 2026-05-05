import { renderCorporateKind, corporateKindMetadata } from '../_lib';

export default async function CorporateServices() {
  return renderCorporateKind('services');
}

export async function generateMetadata() {
  return corporateKindMetadata('services', '/services');
}
