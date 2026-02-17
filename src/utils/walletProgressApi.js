/**
 * Wallet-backed progress API.
 * Loads/saves upgrades, legendaries, high wave/score, save state via server API.
 * Progress is keyed by wallet address — no cookies/localStorage.
 */

const PROGRESS_API_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PROGRESS_API_URL) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ZK_PROVER_URL) ||
  'http://localhost:3333';

export async function fetchProgress(address) {
  if (!address || typeof address !== 'string') return null;
  const url = `${PROGRESS_API_URL.replace(/\/$/, '')}/player/${encodeURIComponent(address.trim())}/progress`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('Progress API fetch failed:', e.message);
    return null;
  }
}

export async function saveProgress(address, payload) {
  if (!address || typeof address !== 'string') return false;
  const url = `${PROGRESS_API_URL.replace(/\/$/, '')}/player/${encodeURIComponent(address.trim())}/progress`;
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
    console.warn('Progress API save failed:', e.message);
    return false;
  }
}
