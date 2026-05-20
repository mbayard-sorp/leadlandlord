import { defineCliConfig } from 'sanity/cli';

export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID ?? 'ybdv5za2',
    dataset: process.env.SANITY_STUDIO_DATASET ?? 'production',
  },
  studioHost: 'leadlandlord',
  deployment: { appId: 'yp7vadspb24kswudt5i3o6gf', autoUpdates: true },
});
