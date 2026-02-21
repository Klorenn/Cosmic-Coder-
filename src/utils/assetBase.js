/**
 * Base path for runtime-loaded assets (sprites, audio) so the game works on
 * GitHub Pages (/repo-name/), Vercel (/), and local dev. All assets must live
 * in public/ and are copied to dist at build time — no paths outside the repo.
 * Prefer Vite's BASE_URL when built so deploy always matches the build base.
 */
export function getAssetBase() {
  // 1) Runtime: if we're on a subpath (e.g. GitHub Pages /repo-name/), use it so assets never 404
  if (typeof window !== 'undefined' && window.location && window.location.pathname) {
    const path = window.location.pathname;
    const dir = path.replace(/\/index\.html$/i, '').replace(/\/$/, '') || '/';
    if (dir !== '/' && dir !== '') return dir;
  }
  // 2) Built app (local or root deploy): use Vite BASE_URL
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) {
    const b = String(import.meta.env.BASE_URL || '');
    const trimmed = b.endsWith('/') ? b.slice(0, -1) : b;
    if (trimmed && trimmed !== '.' && trimmed !== '') return trimmed;
  }
  return '';
}

export function getAssetPath(relativePath) {
  const base = getAssetBase();
  const slash = relativePath.startsWith('/') ? '' : '/';
  return base + slash + relativePath;
}

/** URL for config.json (same origin, same base as assets — for deploy). */
export function getConfigJsonUrl() {
  const base = getAssetBase();
  return (base ? base + '/' : '/') + 'config.json';
}
