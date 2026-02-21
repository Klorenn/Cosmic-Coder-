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
  // 2) Fallback: derive base from the main script URL (reliable on GitHub Pages when pathname is /)
  if (typeof document !== 'undefined') {
    const script = document.querySelector('script[type="module"][src]');
    if (script && script.src) {
      try {
        const u = new URL(script.src);
        const pathname = u.pathname || '';
        // e.g. /Cosmic-Coder-/assets/main-xxx.js -> base = /Cosmic-Coder-
        const segments = pathname.split('/').filter(Boolean);
        if (segments.length >= 2 && segments[0] && segments[1] === 'assets') {
          return '/' + segments[0];
        }
        if (segments.length >= 1 && segments[0]) {
          return '/' + segments[0];
        }
      } catch (_) {}
    }
  }
  // 3) Built app (local or root deploy): use Vite BASE_URL
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
