// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://kanban.sneakybeak.net',
  output: 'static',
  trailingSlash: 'never',
  vite: {
    // Astro 7.4's Windows dev runner misses these transitive CommonJS dependencies.
    // https://github.com/withastro/astro/blob/main/reference/optimize-deps.md
    environments: {
      ssr: { optimizeDeps: { include: ['picomatch', 'yaml', 'p-queue'] } },
    },
    server: {
      proxy: {
        '/api': {
          target: process.env.API_ORIGIN || 'http://127.0.0.1:8000',
          changeOrigin: false,
          proxyTimeout: 25000,
        },
      },
    },
  },
});
