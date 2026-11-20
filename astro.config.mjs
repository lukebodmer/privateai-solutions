import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import rehypePlatformIcons from './src/lib/rehypePlatformIcons.mjs';

// `astro build` starts a Vite server of its own and pre-bundles dependencies
// in production mode. In the dev server's cache that would hand a running
// `pnpm dev` production React, and the admin island fails on its first hook.
const building = process.argv.includes('build');

export default defineConfig({
  integrations: [tailwind(), react(), mdx(), sitemap({ filter: page => !page.includes('/admin') })],
  site: 'https://privateai.solutions',
  markdown: { rehypePlugins: [rehypePlatformIcons] },
  vite: {
    cacheDir: building ? 'node_modules/.vite-build' : 'node_modules/.vite',
  },
});
