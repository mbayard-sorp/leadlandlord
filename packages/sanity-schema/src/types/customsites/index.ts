import { customSitesObjectTypes } from './objects';
import { customSitesSectionTypes } from './sections';
import { csSite } from './custom-site';
import { csPage } from './custom-page';
import { csPracticeArea } from './custom-practice-area';
import { csPublication } from './custom-publication';
import { csAttorney } from './custom-attorney';
import { csTestimonial } from './custom-testimonial';
import { csBadge } from './custom-badge';

export * from './objects';
export * from './sections';
export { csSite } from './custom-site';
export { csPage } from './custom-page';
export { csPracticeArea } from './custom-practice-area';
export { csPublication } from './custom-publication';
export { csAttorney } from './custom-attorney';
export { csTestimonial } from './custom-testimonial';
export { csBadge } from './custom-badge';

// customSitesObjectTypes (csSeo, csNavChildLink, csNavLink, csAddress,
// csFaqItem, csBody, csRedirect, csCredential, csBarAdmission) must be
// registered before the section blocks and documents that use them (e.g.
// csFaqItem in csPracticeArea and csFaqBlock, csBody in
// csIntroBlock/csRichTextBlock/csPracticeArea/csPublication/csAttorney,
// csCredential/csBarAdmission in csAttorney).

/** All Custom Sites schema types, ready to spread into `schemaTypes`. */
export const customSitesSchemaTypes = [
  ...customSitesObjectTypes,
  ...customSitesSectionTypes,
  csPracticeArea,
  csAttorney,
  csTestimonial,
  csBadge,
  csPublication,
  csPage,
  csSite,
];
