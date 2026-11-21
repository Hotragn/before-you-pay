import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        panel: resolve(import.meta.dirname, 'panel.html'),
        demo: resolve(import.meta.dirname, 'demo-store/index.html'),
        eval: resolve(import.meta.dirname, 'eval.html'),
        demoTerms: resolve(import.meta.dirname, 'demo-store/terms.html'),
      },
    },
  },
  optimizeDeps: { include: ['firebase/app', 'firebase/app-check', 'firebase/ai', 'firebase/auth', 'firebase/firestore', 'firebase/remote-config'] },
  test: { environment: 'jsdom' },
});
