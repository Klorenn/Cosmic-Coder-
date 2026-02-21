import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Derive base path automatically for GitHub Pages based on repo name.
// Example: owner/repo ⇒ base "/repo/" when running in GitHub Actions / Pages.
const repoName = process.env.GITHUB_REPOSITORY
  ? process.env.GITHUB_REPOSITORY.split('/')[1]
  : '';
const isCI = !!process.env.GITHUB_ACTIONS || !!process.env.GITHUB_REPOSITORY;
const baseForPages = repoName ? `/${repoName}/` : './';

export default defineConfig({
  base: isCI ? baseForPages : './',
  resolve: {
    alias: [
      {
        find: /^pino$/,
        replacement: fileURLToPath(new URL('./src/shims/pino-browser-shim.js', import.meta.url))
      }
    ]
  },
  server: {
    port: 3001,
    open: true,
    fs: {
      allow: [
        // Keep project root accessible by Vite dev server
        '/Users/paukoh/Cosmic-Coder-',
        // Allow loading local art packs via /@fs during development
        '/Users/paukoh/Downloads/space_background_pack 3/Assets/Blue Version',
        '/Users/paukoh/Downloads/space_background_pack 3/Assets/Blue Version/layered'
      ]
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    copyPublicDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        docs: fileURLToPath(new URL('./docs/index.html', import.meta.url))
      }
    }
  },
  optimizeDeps: {
    include: ['@stellar/freighter-api'],
    exclude: [
      '@noir-lang/noir_js',
      '@noir-lang/acvm_js',
      '@noir-lang/noirc_abi',
      '@aztec/bb.js'
    ]
  }
});
