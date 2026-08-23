import type { StructureBuilder, StructureResolver, StructureResolverContext } from 'sanity/structure';

/**
 * Custom desk structure: group document types by business line.
 *
 * NOTE: with a custom structure, document types are NOT auto-listed — every
 * type you want visible must be added below. When a new document type is added
 * to the schema, add it here too or it won't appear in the Studio sidebar.
 *
 * Custom Sites is a per-site tree (Custom Sites → <Site Name> → content
 * folders): every cs* content type carries a `site` reference, so each folder
 * filters on `site._ref` and new docs created inside a folder get the site
 * pre-set via the initial value templates in ./templates.ts. Adding custom
 * site #3 needs no structure change — the tree is driven by the csSite
 * documents themselves. A new cs* CONTENT TYPE, however, must be added to
 * CUSTOM_SITE_CHILD_TYPES below AND to ./templates.ts, or it won't appear
 * inside the site folders.
 *
 * Sites differ in which types they actually use — the legal site has no
 * journey stages or assessments, the financial one has no badges — so a site's
 * folders are split: the ones holding content first, then the unused ones
 * under a divider, still reachable for authoring the first document.
 */

/** The cs* content types shown inside each site folder, in display order. */
const CUSTOM_SITE_CHILD_TYPES: ReadonlyArray<{ type: string; title: string; ordering?: string }> = [
  { type: 'csPage', title: 'Pages' },
  { type: 'csPracticeArea', title: 'Services', ordering: 'order' },
  { type: 'csAttorney', title: 'Team' },
  { type: 'csPublication', title: 'Publications & Episodes' },
  { type: 'csJourneyStage', title: 'Journey Stages', ordering: 'order' },
  { type: 'csCaseStudy', title: 'Case Studies', ordering: 'order' },
  { type: 'csAssessment', title: 'Assessments' },
  { type: 'csTestimonial', title: 'Testimonials', ordering: 'order' },
  { type: 'csBadge', title: 'Badges', ordering: 'order' },
];

/** One content-type folder inside a site, scoped and pre-parameterized. */
function customSiteTypeFolder(
  S: StructureBuilder,
  siteId: string,
  { type, title, ordering }: { type: string; title: string; ordering?: string },
) {
  let list = S.documentList()
    .title(title)
    .schemaType(type)
    .filter('_type == $type && site._ref == $siteId')
    .params({ type, siteId })
    .initialValueTemplates([S.initialValueTemplateItem(`${type}-for-site`, { siteId })]);
  if (ordering) {
    list = list.defaultOrdering([{ field: ordering, direction: 'asc' }]);
  }
  return S.listItem().title(title).id(type).child(list);
}

async function customSiteFolder(
  S: StructureBuilder,
  context: StructureResolverContext,
  siteDocId: string,
) {
  // Drafts of a csSite doc surface with a `drafts.` prefix, but every child
  // doc's `site._ref` points at the published id — filter on that.
  const siteId = siteDocId.replace(/^drafts\./, '');
  const client = context.getClient({ apiVersion: '2024-01-01' });
  // One round trip for the pane title plus the per-type counts that decide
  // which folders lead and which sit under the divider.
  const { name, counts } = await client.fetch<{ name: string | null; counts: Record<string, number> }>(
    `{
      "name": *[_id == $siteId][0].name,
      "counts": {${CUSTOM_SITE_CHILD_TYPES.map(({ type }) => `"${type}": count(*[_type == "${type}" && site._ref == $siteId])`).join(', ')}}
    }`,
    { siteId },
  );

  const used = CUSTOM_SITE_CHILD_TYPES.filter(({ type }) => (counts?.[type] ?? 0) > 0);
  const unused = CUSTOM_SITE_CHILD_TYPES.filter(({ type }) => (counts?.[type] ?? 0) === 0);

  return S.list()
    .title(name ?? 'Site Content')
    .items([
      S.listItem()
        .title('Site Settings')
        .id('settings')
        .child(S.document().schemaType('csSite').documentId(siteId)),
      S.divider(),
      ...used.map((child) => customSiteTypeFolder(S, siteId, child)),
      ...(unused.length ? [S.divider()] : []),
      ...unused.map((child) => customSiteTypeFolder(S, siteId, child)),
    ]);
}

export const structure: StructureResolver = (S, context) =>
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
      S.listItem()
        .title('Custom Sites')
        .child(
          S.documentTypeList('csSite')
            .title('Custom Sites')
            .child((siteDocId) => customSiteFolder(S, context, siteDocId)),
        ),
    ]);
