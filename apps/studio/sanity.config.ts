import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import { colorInput } from '@sanity/color-input';
import { schemaTypes } from '@leadlandlord/sanity-schema';
import { structure } from './structure';

const projectId = process.env.SANITY_STUDIO_PROJECT_ID ?? 'ybdv5za2';

export default defineConfig([
  {
    name: 'production',
    title: 'LeadLandlord — Production',
    basePath: '/production',
    projectId,
    dataset: 'production',
    plugins: [structureTool({ structure }), visionTool(), colorInput()],
    schema: { types: schemaTypes },
  },
  {
    name: 'development',
    title: 'LeadLandlord — Development',
    basePath: '/development',
    projectId,
    dataset: 'development',
    plugins: [structureTool({ structure }), visionTool(), colorInput()],
    schema: { types: schemaTypes },
  },
]);
