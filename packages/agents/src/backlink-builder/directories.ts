/**
 * Curated list of 30 reputable directories for trade-business citations.
 *
 * `automatable: false` means we generate a row in the `backlinks` table with
 * the submission URL + instructions in metadata, and an operator manually
 * actions the row. This is the v1 reality — most directories require captcha,
 * email verification, or a paid API (BrightLocal, Whitespark) to automate.
 *
 * `automatable: true` is reserved for entries we can submit programmatically
 * (none in v1 — see brightlocal stub).
 */

export interface Directory {
  domain: string;
  name: string;
  submitUrl: string;
  automatable: boolean;
  instructions: string;
}

export const CITATION_DIRECTORIES: readonly Directory[] = [
  {
    domain: 'yelp.com',
    name: 'Yelp',
    submitUrl: 'https://biz.yelp.com/signup',
    automatable: false,
    instructions: 'Claim/create the business page. Email verification required.',
  },
  {
    domain: 'google.com',
    name: 'Google Business Profile',
    submitUrl: 'https://www.google.com/business/',
    automatable: false,
    instructions: 'Claim profile + verify by postcard or video. Critical for local SEO.',
  },
  {
    domain: 'bing.com',
    name: 'Bing Places',
    submitUrl: 'https://www.bingplaces.com/',
    automatable: false,
    instructions: 'Import from Google Business Profile if claimed there.',
  },
  {
    domain: 'mapsconnect.apple.com',
    name: 'Apple Maps Connect',
    submitUrl: 'https://mapsconnect.apple.com/',
    automatable: false,
    instructions: 'Apple ID required. Manual only — Apple has no public submission API.',
  },
  {
    domain: 'angi.com',
    name: 'Angi (formerly Angie\'s List / HomeAdvisor)',
    submitUrl: 'https://www.angi.com/businesscenter/',
    automatable: false,
    instructions: 'Trade-focused. Free profile; paid leads upsell — decline upsell unless purchased.',
  },
  {
    domain: 'houzz.com',
    name: 'Houzz',
    submitUrl: 'https://www.houzz.com/professionals/',
    automatable: false,
    instructions: 'Best fit for remodeling/landscape niches.',
  },
  {
    domain: 'bbb.org',
    name: 'Better Business Bureau',
    submitUrl: 'https://www.bbb.org/get-listed',
    automatable: false,
    instructions: 'Listing free; accreditation paid. Skip accreditation in v1.',
  },
  {
    domain: 'mapquest.com',
    name: 'MapQuest',
    submitUrl: 'https://business.mapquest.com/',
    automatable: false,
    instructions: 'Powered by Yext under the hood — listing flows through there.',
  },
  {
    domain: 'yellowpages.com',
    name: 'YellowPages',
    submitUrl: 'https://accounts.yellowpages.com/register',
    automatable: false,
    instructions: 'Free basic listing.',
  },
  {
    domain: 'manta.com',
    name: 'Manta',
    submitUrl: 'https://www.manta.com/claim',
    automatable: false,
    instructions: 'B2B-leaning. Free claim; paid upgrades.',
  },
  {
    domain: 'foursquare.com',
    name: 'Foursquare',
    submitUrl: 'https://foursquare.com/add-place',
    automatable: false,
    instructions: 'Powers many in-car nav systems.',
  },
  {
    domain: 'hotfrog.com',
    name: 'Hotfrog',
    submitUrl: 'https://www.hotfrog.com/AddYourBusiness.aspx',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'cylex.us.com',
    name: 'Cylex',
    submitUrl: 'https://www.cylex.us.com/company-add.html',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'merchantcircle.com',
    name: 'MerchantCircle',
    submitUrl: 'https://www.merchantcircle.com/signup',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'local.com',
    name: 'Local.com',
    submitUrl: 'https://www.local.com/business/add/',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'n49.com',
    name: 'n49',
    submitUrl: 'https://www.n49.com/biz/claim/',
    automatable: false,
    instructions: 'Free listing; review-focused.',
  },
  {
    domain: 'ezlocal.com',
    name: 'EZlocal',
    submitUrl: 'https://ezlocal.com/list-your-business',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'yellowbook.com',
    name: 'Yellowbook',
    submitUrl: 'https://www.yellowbook.com/',
    automatable: false,
    instructions: 'Currently redirects to Hibu — confirm before submitting duplicate.',
  },
  {
    domain: 'citysearch.com',
    name: 'Citysearch',
    submitUrl: 'https://citysearch.com/',
    automatable: false,
    instructions: 'Submission via Expressupdate / Data Axle network.',
  },
  {
    domain: 'brownbook.net',
    name: 'BrownBook',
    submitUrl: 'https://www.brownbook.net/business/add/',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'tupalo.com',
    name: 'Tupalo',
    submitUrl: 'https://tupalo.com/en/add-place',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'chamberofcommerce.com',
    name: 'ChamberofCommerce.com',
    submitUrl: 'https://www.chamberofcommerce.com/business-listings/',
    automatable: false,
    instructions: 'Free basic listing.',
  },
  {
    domain: 'elocal.com',
    name: 'eLocal',
    submitUrl: 'https://www.elocal.com/businesses/',
    automatable: false,
    instructions: 'Free listing; lead-gen upsell.',
  },
  {
    domain: 'getfave.com',
    name: 'GetFave',
    submitUrl: 'https://www.getfave.com/',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'showmelocal.com',
    name: 'Showmelocal',
    submitUrl: 'https://www.showmelocal.com/businessupdate.aspx',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'yellowbot.com',
    name: 'Yellowbot',
    submitUrl: 'https://www.yellowbot.com/signup.html',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'openstreetmap.org',
    name: 'OpenStreetMap',
    submitUrl: 'https://www.openstreetmap.org/',
    automatable: false,
    instructions:
      'Add a node with shop/amenity tags + name/address/phone/website. Manual via iD editor.',
  },
  {
    domain: 'tomtom.com',
    name: 'TomTom Map Maker',
    submitUrl: 'https://mapcreator.tomtom.com/',
    automatable: false,
    instructions: 'Add a POI for the business address.',
  },
  {
    domain: 'usaonline.us',
    name: 'USAonline',
    submitUrl: 'https://www.usaonline.us/business/add/',
    automatable: false,
    instructions: 'Free listing.',
  },
  {
    domain: 'topix.com',
    name: 'Topix',
    submitUrl: 'https://www.topix.com/business',
    automatable: false,
    instructions: 'Free listing; community-driven.',
  },
];

if (CITATION_DIRECTORIES.length !== 30) {
  // Compile-time-ish guard. Tests also assert this, but cheap to keep here.
  throw new Error(`Expected 30 citation directories; found ${CITATION_DIRECTORIES.length}`);
}
