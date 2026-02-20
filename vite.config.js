import { defineConfig } from 'vite';

// Derive base path automatically for GitHub Pages based on repo name.
// Example: owner/repo ⇒ base "/repo/" when running in GitHub Actions / Pages.
const repoName = process.env.GITHUB_REPOSITORY
  ? process.env.GITHUB_REPOSITORY.split('/')[1]
  : '';
const isCI = !!process.env.GITHUB_ACTIONS || !!process.env.GITHUB_REPOSITORY;
const baseForPages = repoName ? `/${repoName}/` : './';

export default defineConfig({
  base: isCI ? baseForPages : './',
  server: {
    port: 3000,
    open: true,
    fs: {
      allow: [
        // Keep project root accessible by Vite dev server
        '/Users/paukoh/vibe-coder',
        // Allow loading local art packs via /@fs during development
        '/Users/paukoh/Downloads/space_background_pack 3/Assets/Blue Version',
        '/Users/paukoh/Downloads/space_background_pack 3/Assets/Blue Version/layered'
      ]
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    copyPublicDir: true
  },
  optimizeDeps: {
    include: ['@stellar/freighter-api']
  }
});
