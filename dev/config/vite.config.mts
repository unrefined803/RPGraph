import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite's dev server serves local (non-`node_modules`) `.cjs` files completely
 * unprocessed — the CommonJS-to-ESM interop it applies elsewhere only runs
 * during dependency pre-bundling of `node_modules` packages. The two shared
 * `.cjs` modules under `shared/` are also `require()`d directly by the
 * Electron main process, so they can't just become `.mjs`/`.ts`. Rewrite
 * their trailing `module.exports`/`require` statements to native ESM only
 * for `vite dev`; the production build (Rolldown) already interops CJS
 * correctly, so this plugin doesn't run there.
 */
const localCjsExportStatement = /\bmodule\.exports\s*=\s*\{([^}]*)\};?\s*$/;

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: mode === 'profiling'
      ? [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }]
      : [],
  },
  plugins: [
    react(),
    {
      name: 'local-cjs-dev-interop',
      apply: 'serve',
      transform(code, id) {
        if (id.endsWith('/shared/agency-tags.cjs') || id.endsWith('/shared/reasoning.cjs')) {
          return code.replace(localCjsExportStatement, 'export { $1 };');
        }
        if (id.endsWith('/shared/character-container.cjs')) {
          return code
            .replace(
              "const formatVersions = require('../src/storybook/formatVersions.json');",
              "import formatVersions from '../src/storybook/formatVersions.json';",
            )
            .replace(
              "const { validateCharacterAgency } = require('./agency-tags.cjs');",
              "import { validateCharacterAgency } from './agency-tags.cjs';",
            )
            .replace(localCjsExportStatement, 'export { $1 };');
        }
        return null;
      },
    },
  ],
  base: './',
  build: {
    chunkSizeWarningLimit: 3000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              debugName: 'vendor-chunks',
              name(id) {
                if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
                  return 'react-vendor';
                }
                if (
                  id.includes('/node_modules/@xyflow/') ||
                  id.includes('/node_modules/d3-') ||
                  id.includes('/node_modules/zustand/') ||
                  id.includes('/node_modules/classcat/') ||
                  id.includes('/node_modules/use-sync-external-store/')
                ) {
                  return 'xyflow-vendor';
                }
                return null;
              },
            },
          ],
        },
      },
    },
  },
}));
