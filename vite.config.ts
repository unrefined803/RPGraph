import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id) {
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
        },
      },
    },
  },
});
