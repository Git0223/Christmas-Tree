import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: '0.0.0.0',
    port: 16000,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 16000,
    strictPort: true,
  },
});
