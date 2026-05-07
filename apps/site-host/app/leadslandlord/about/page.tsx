import { renderCorporateKind, corporateKindMetadata } from '../_lib';

export default async function CorporateAbout() {
  return renderCorporateKind('about');
}

export async function generateMetadata() {
  return corporateKindMetadata('about', '/about');
}
