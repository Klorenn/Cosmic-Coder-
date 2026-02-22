/**
 * Wallet-backed progress API.
 * Loads/saves upgrades, legendaries, high wave/score, save state via server API.
 * Progress is keyed by wallet address — no cookies/localStorage.
 */

const PRODUCTION_API = 'https://cosmic-coder-zk-prover.onrender.com';

function getProgressApiUrl() {
  return (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_PROGRESS_API_URL) ||
    (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_ZK_PROVER_URL) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PROGRESS_API_URL) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ZK_PROVER_URL) ||
    PRODUCTION_API;
}

function isLocalhostUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch (_) {
    return false;
  }
}

export async function fetchProgress(address) {
  if (!address || typeof address !== 'string') return null;
  const base = getProgressApiUrl().replace(/\/$/, '');
  const path = `/player/${encodeURIComponent(address.trim())}/progress`;
  const url = `${base}${path}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (e) {
    // If configured URL is localhost and connection failed, retry with production
    if (isLocalhostUrl(url)) {
      try {
        const res = await fetch(`${PRODUCTION_API}${path}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data;
      } catch (_) {
        /* ignore */
      }
    }
    const msg = e?.message || '';
    if (/fetch|Failed to fetch|Connection refused|ERR_/i.test(msg)) {
      console.debug('Progress API fetch failed:', msg);
    } else {
      console.warn('Progress API fetch failed:', msg);
    }
    return null;
  }
}

export async function saveProgress(address, payload) {
  if (!address || typeof address !== 'string') return false;
  const base = getProgressApiUrl().replace(/\/$/, '');
  const path = `/player/${encodeURIComponent(address.trim())}/progress`;
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return false;
    await res.json();
    return true;
  } catch (e) {
    if (isLocalhostUrl(url)) {
      try {
        const res = await fetch(`${PRODUCTION_API}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) return false;
        await res.json();
        return true;
      } catch (_) {
        /* ignore */
      }
    }
    const msg = e?.message || '';
    if (/fetch|Failed to fetch|Connection refused|ERR_/i.test(msg)) {
      console.debug('Progress API save failed:', msg);
    } else {
      console.warn('Progress API save failed:', msg);
    }
    return false;
  }
}
