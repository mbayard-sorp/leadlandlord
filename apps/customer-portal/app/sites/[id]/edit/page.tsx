/**
 * Site editor — M3 curated text editor with draft/save/publish + live preview.
 *
 * Auth: `requireCustomerSiteAccess(id)` is called first — fail-closed.
 * The guard is the authoritative boundary; if it throws, the user never
 * reaches the editor content.
 *
 * Layout (rendered by EditorShell):
 *   LEFT  (42%) — curated form, grouped by section, only present sections
 *   RIGHT (58%) — live preview iframe proxied to site-host
 *
 * The iframe points at `/api/draft-mode/enable?redirect=/preview/<docId>`,
 * rewritten (next.config.ts) to site-host, which sets the draft-mode cookie
 * and redirects to the preview route mounting SanityLive. After each
 * successful save, EditorShell increments a refreshKey to reload the iframe.
 */

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@leadlandlord/db/client';
import { buildsellSites } from '@leadlandlord/db/schema';
import { requireCustomerSiteAccess, UnauthorizedError } from '@/lib/auth-guard';
import { getEditableDoc, buildsellSiteDocId } from '@/lib/sanity-write';
import {
  topLevelFields,
  sectionDefs,
  extractFormValues,
  serviceCardFields,
  aboutStatFields,
  processStepFields,
  footerColumnFields,
  toClientSection,
  toClientField,
  type SectionDef,
} from '@/lib/fields';
import EditorShell from '@/components/EditorShell';
import SiteNav from '@/components/SiteNav';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditPage({ params }: Props) {
  const { id } = await params;

  // 1. Auth — fail-closed. Called before any Sanity or DB read.
  try {
    await requireCustomerSiteAccess(id);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect('/login');
    }
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-fg)' }}>
            Access denied
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            You do not have access to this site.
          </p>
          <a href="/dashboard" className="inline-block mt-4 text-sm" style={{ color: 'var(--color-accent)' }}>
            Back to dashboard
          </a>
        </div>
      </main>
    );
  }

  // 2. Load site row from Postgres for the page header.
  const db = getDb();
  const [siteRow] = await db
    .select({ businessName: buildsellSites.businessName, slug: buildsellSites.slug })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, id))
    .limit(1);

  // 3. Load current editable doc from Sanity (draft preferred over published).
  const doc = await getEditableDoc(id);
  const sanityDocId = buildsellSiteDocId(id); // bs-site-<uuid>

  // 4. Prefill form values from the doc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docAny = doc as Record<string, any> | null;
  const initialValues = docAny ? extractFormValues(docAny) : {};

  // 5. Build the section list — static defs merged with dynamic sub-array
  //    fields, filtered to only sections present in the doc.
  const presentSectionKeys = new Set<string>();
  if (docAny && Array.isArray(docAny.sections)) {
    for (const s of docAny.sections as Array<{ _key?: string }>) {
      if (s._key) presentSectionKeys.add(s._key);
    }
  }

  const enrichedSections: SectionDef[] = sectionDefs
    // ugc is optional — only show if the section exists in the doc
    .filter((s) => (s.sectionKey === 'ugc' ? presentSectionKeys.has('ugc') : true))
    .map((s) => {
      if (!docAny) return s;
      switch (s.sectionKey) {
        case 'services':
          return { ...s, fields: [...s.fields, ...serviceCardFields(docAny)] };
        case 'about':
          return { ...s, fields: [...s.fields, ...aboutStatFields(docAny)] };
        case 'process':
          return { ...s, fields: [...s.fields, ...processStepFields(docAny)] };
        case 'footer':
          return { ...s, fields: [...s.fields, ...footerColumnFields(docAny)] };
        default:
          return s;
      }
    });

  // 6. Derive initial image thumbnails from the doc (server-side only).
  //    Sanity CDN URL format:
  //      https://cdn.sanity.io/images/<projectId>/<dataset>/<hash>-<WxH>.<ext>
  //    asset._ref format: "image-<hash>-<WxH>-<ext>"
  function assetRefToUrl(ref: string | undefined): string | undefined {
    if (!ref) return undefined;
    const projectId = process.env.SANITY_PROJECT_ID ?? process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '';
    const dataset = process.env.SANITY_DATASET ?? process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';
    const refPart = ref.replace(/^image-/, '');
    const lastDash = refPart.lastIndexOf('-');
    if (lastDash === -1) return undefined;
    const withoutExt = refPart.substring(0, lastDash);
    const ext = refPart.substring(lastDash + 1);
    return `https://cdn.sanity.io/images/${projectId}/${dataset}/${withoutExt}.${ext}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function imageRef(obj: any): string | undefined {
    return obj?.asset?._ref as string | undefined;
  }

  const heroSection = docAny?.sections?.find((s: { _key?: string }) => s._key === 'hero');
  const aboutSection = docAny?.sections?.find((s: { _key?: string }) => s._key === 'about');

  const initialThumbnails: Record<string, string | undefined> = {
    'logo':        assetRefToUrl(imageRef(docAny?.logo)),
    'favicon':     assetRefToUrl(imageRef(docAny?.favicon)),
    'hero.image':  assetRefToUrl(imageRef(heroSection?.image)),
    'about.image': assetRefToUrl(imageRef(aboutSection?.image)),
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <SiteNav
        siteId={id}
        businessName={siteRow?.businessName ?? 'Site Editor'}
        activeSection="edit"
      />

      {/* Two-pane editor shell (client component owns refreshKey + iframe) */}
      {doc ? (
        <EditorShell
          siteId={id}
          sanityDocId={sanityDocId}
          initialValues={initialValues}
          sections={enrichedSections.map(toClientSection)}
          topLevelFields={topLevelFields.map(toClientField)}
          initialThumbnails={initialThumbnails}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <p className="font-medium mb-1" style={{ color: 'var(--color-fg)' }}>
              Site content not yet available
            </p>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              The site may still be building. Refresh in a minute.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
