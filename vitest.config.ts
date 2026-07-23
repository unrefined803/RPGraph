import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Reuse Vite's transform pipeline so tests handle `import.meta.glob` and
// transitive `.tsx` imports (e.g. Card.tsx via coreDefinitions.ts) without the
// old SSR-build-then-run trick. `environment: 'node'` — no component/DOM tests.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
});
