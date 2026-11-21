import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        panel: resolve(import.meta.dirname, 'panel.html'),
        demo: resolve(import.meta.dirname, 'demo-store/index.html'),
      },
    },
  },
  test: { environment: 'jsdom' },
});
