/**
 * Base path for runtime-loaded assets so the game works on
 * GitHub Pages (/repo-name/), Vite dev (localhost), and preview. All assets
 * live in public/ and are copied to dist at build time.
 */
export function getAssetBase() {
  // 1) Vite dev: current module is under /src/ → assets at origin root
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    try {
      const u = new URL(import.meta.url);
      const pathname = u.pathname || '';
      if (pathname.includes('/src/')) return '';
    } catch (_) {}
  }

  // 2) Page is on a subpath (e.g. GitHub Pages /Cosmic-Coder-/) → use it
  if (typeof window !== 'undefined' && window.location && window.location.pathname) {
    const path = window.location.pathname;
    const dir = path.replace(/\/index\.html$/i, '').replace(/\/$/, '') || '/';
    if (dir !== '/' && dir !== '') return dir;
  }

  // 3) Built bundle URL: /Cosmic-Coder-/assets/xxx.js → base = /Cosmic-Coder-
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    try {
      const u = new URL(import.meta.url);
      const pathname = u.pathname || '';
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && parts[1] === 'assets') return '/' + parts[0];
      if (parts.length >= 1 && parts[0] === 'assets') return '';
    } catch (_) {}
  }

  // 4) Vite BASE_URL (build)
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
  const path = base ? base + slash + relativePath : '/' + relativePath;
  return path;
}

/** URL for config.json (same origin, same base as assets). */
export function getConfigJsonUrl() {
  const base = getAssetBase();
  return (base ? base + '/' : '/') + 'config.json';
}
