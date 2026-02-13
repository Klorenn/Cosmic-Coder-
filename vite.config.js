import { defineConfig } from 'vite';

export default defineConfig({
  // Use repo name for GitHub Pages, relative path for local
  base: process.env.GITHUB_ACTIONS ? '/vibe-coder/' : './',
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  optimizeDeps: {
    include: [
      '@creit.tech/stellar-wallets-kit',
      '@stellar/freighter-api',
      'buffer'
    ]
  }
});
