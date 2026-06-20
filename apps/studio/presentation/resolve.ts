import { defineLocations, type PresentationPluginOptions } from 'sanity/presentation';

export const resolve: PresentationPluginOptions['resolve'] = {
  locations: {
    buildsellSite: defineLocations({
      select: {
        businessName: 'businessName',
        buildsellSiteId: 'buildsellSiteId',
        slug: 'slug.current',
      },
      resolve: (doc) => ({
        locations: [
          // Primary: preview route renders the doc regardless of draftMode field.
          {
            title: doc?.businessName || 'Spec site',
            href: `/preview/${doc?.buildsellSiteId}`,
          },
          // Secondary: public live page (only meaningful when published + draftMode==false).
          ...(doc?.slug ? [{ title: 'Live page', href: `/buildsell/${doc.slug}` }] : []),
        ],
      }),
    }),
  },
};
