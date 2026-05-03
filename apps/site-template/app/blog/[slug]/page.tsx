import { notFound } from 'next/navigation';
import { loadBundle } from '../../../lib/content';
import { SiteShell } from '../../../components/SiteShell';
import { PageBody } from '../../../components/PageBody';

interface Params {
  params: Promise<{ slug: string }>;
}

export default async function BlogPostPage({ params }: Params) {
  const { slug } = await params;
  const bundle = loadBundle();
  const page = bundle.blog_posts.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) notFound();
  return (
    <SiteShell
      businessName={bundle.business_name}
      niche={bundle.niche}
      city={bundle.city}
      state={bundle.state}
      navServices={bundle.services.map((s) => ({ slug: s.slug, title: s.title }))}
      navAreas={bundle.service_areas.map((a) => ({ slug: a.slug, title: a.title }))}
    >
      <PageBody page={page} />
    </SiteShell>
  );
}

export async function generateStaticParams() {
  const bundle = loadBundle();
  return bundle.blog_posts.map((p) => ({ slug: slugFromUrl(p.slug) }));
}

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const bundle = loadBundle();
  const page = bundle.blog_posts.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) return {};
  return { title: page.title, description: page.meta_description };
}

function slugFromUrl(url: string): string {
  return url.replace(/^\/blog\//, '').replace(/\/$/, '');
}
