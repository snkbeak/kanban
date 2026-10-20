// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://kanban.sneakybeak.net',
  output: 'static',
  trailingSlash: 'never',
});
