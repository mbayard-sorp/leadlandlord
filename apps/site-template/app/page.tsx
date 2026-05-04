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
  return {
    title: bundle.home.title,
    description: bundle.home.meta_description,
    alternates: { canonical: '/' },
    openGraph: {
      title: bundle.home.title,
      description: bundle.home.meta_description,
      type: 'website',
      url: '/',
      ...(bundle.hero_image_url ? { images: [{ url: bundle.hero_image_url }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: bundle.home.title,
      description: bundle.home.meta_description,
      ...(bundle.hero_image_url ? { images: [bundle.hero_image_url] } : {}),
    },
  };
}
