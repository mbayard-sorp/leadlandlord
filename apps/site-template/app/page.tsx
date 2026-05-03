import { loadBundle } from '../lib/content';
import { ClassicHome } from '../components/variants/Classic';
import { ModernHome } from '../components/variants/Modern';
import { PremiumHome } from '../components/variants/Premium';
import { BrightHome } from '../components/variants/Bright';

export default function Home() {
  const bundle = loadBundle();
  switch (bundle.variant) {
    case 'modern':
      return <ModernHome bundle={bundle} />;
    case 'premium':
      return <PremiumHome bundle={bundle} />;
    case 'bright':
      return <BrightHome bundle={bundle} />;
    case 'classic':
    default:
      return <ClassicHome bundle={bundle} />;
  }
}

export function generateMetadata() {
  const bundle = loadBundle();
  const jsonLd = bundle.home.schema_org_jsonld;
  return {
    title: bundle.home.title,
    description: bundle.home.meta_description,
    openGraph: {
      title: bundle.home.title,
      description: bundle.home.meta_description,
      type: 'website',
      ...(bundle.hero_image_url ? { images: [{ url: bundle.hero_image_url }] } : {}),
    },
    other: jsonLd ? { 'application/ld+json': JSON.stringify(jsonLd) } : undefined,
  };
}
