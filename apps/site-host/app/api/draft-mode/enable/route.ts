import { defineEnableDraftMode } from 'next-sanity/draft-mode';
import { sanityStega } from '@/lib/sanity';

export const { GET } = defineEnableDraftMode({
  client: sanityStega.withConfig({ token: process.env.SANITY_API_READ_TOKEN }),
});
