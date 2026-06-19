import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import { colorInput } from '@sanity/color-input';
import { presentationTool } from 'sanity/presentation';
import { schemaTypes } from '@leadlandlord/sanity-schema';
import { structure } from './structure';
import { resolve } from './presentation/resolve';

const projectId = process.env.SANITY_STUDIO_PROJECT_ID ?? 'ybdv5za2';

const presentation = presentationTool({
  resolve,
  previewUrl: {
    origin: process.env.SANITY_STUDIO_PREVIEW_ORIGIN ?? 'http://localhost:3001',
    previewMode: { enable: '/api/draft-mode/enable' },
  },
});

export default defineConfig([
  {
    name: 'production',
    title: 'LeadLandlord — Production',
    basePath: '/production',
    projectId,
    dataset: 'production',
    plugins: [structureTool({ structure }), visionTool(), colorInput(), presentation],
    schema: { types: schemaTypes },
  },
  {
    name: 'development',
    title: 'LeadLandlord — Development',
    basePath: '/development',
    projectId,
    dataset: 'development',
    plugins: [structureTool({ structure }), visionTool(), colorInput(), presentation],
    schema: { types: schemaTypes },
  },
]);
