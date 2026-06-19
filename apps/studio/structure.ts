import type { StructureResolver } from 'sanity/structure';

/**
 * Custom desk structure: group document types by business line.
 *
 * NOTE: with a custom structure, document types are NOT auto-listed — every
 * type you want visible must be added below. When a new document type is added
 * to the schema, add it here too or it won't appear in the Studio sidebar.
 */
export const structure: StructureResolver = (S) =>
  S.list()
    .title('Content')
    .items([
      S.listItem()
        .title('Rank & Rent')
        .child(
          S.list()
            .title('Rank & Rent')
            .items([
              S.documentTypeListItem('site').title('Sites'),
              S.documentTypeListItem('page').title('Pages'),
              S.documentTypeListItem('theme').title('Themes'),
              S.documentTypeListItem('siteDomain').title('Site Domains'),
              S.documentTypeListItem('keywordCluster').title('Keyword Clusters'),
              S.documentTypeListItem('review').title('Reviews'),
              S.divider(),
              S.documentTypeListItem('corporateSite').title('Corporate Sites'),
              S.documentTypeListItem('corporatePage').title('Corporate Pages'),
            ]),
        ),
      S.listItem()
        .title('Build & Sell')
        .child(
          S.list()
            .title('Build & Sell')
            .items([
              S.documentTypeListItem('buildsellSite').title('Sites'),
              S.documentTypeListItem('bsReview').title('Reviews'),
            ]),
        ),
    ]);
