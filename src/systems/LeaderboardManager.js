/**
 * LeaderboardManager - Local + on-chain (wallet identity).
 * With wallet: submit and fetch from API (Stellar address = identity).
 * Without: local-only fallback.
 */
const STORAGE_KEY = 'cosmicCoderLeaderboard';
const LOCAL_GAMES_KEY = 'cosmicCoderGamesPlayed';
const MAX_ENTRIES = 10;

function getLeaderboardApiUrl() {
  if (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_LEADERBOARD_URL) return window.__VITE_CONFIG__.VITE_LEADERBOARD_URL.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_API_URL) return window.__VITE_CONFIG__.VITE_API_URL.replace(/\/$/, '');
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_LEADERBOARD_URL) return import.meta.env.VITE_LEADERBOARD_URL;
  return 'https://cosmic-coder-zk-prover.onrender.com';
}

function shortAddress(address, chars = 8) {
  if (!address || address.length <= chars * 2) return address || '???';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export default class LeaderboardManager {
  /**
   * Local entries (legacy)
   * @returns {Array<{ name: string, wave: number, score: number, date: number }>}
   */
  static load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        return Array.isArray(data) ? data : [];
      }
    } catch (e) {
      console.warn('Leaderboard load failed:', e);
    }
    return [];
  }

  static save(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    } catch (e) {
      console.warn('Leaderboard save failed:', e);
    }
  }

  /** Borra el leaderboard local (solo localStorage). El on-chain no se modifica. */
  static reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Leaderboard reset failed:', e);
    }
  }

  /**
   * Add entry locally (fallback when no wallet)
   */
  static addEntry(name, wave, score) {
    const entries = this.load();
    const displayName = (name || 'Anonymous').trim() || 'Anonymous';
    entries.push({
      name: displayName.slice(0, 20),
      wave: Math.max(0, wave),
      score: Math.max(0, Math.floor(score)),
      date: Date.now()
    });
    entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.wave !== a.wave) return b.wave - a.wave;
      return b.date - a.date;
    });
    this.save(entries);
    return entries;
  }

  /**
   * Submit score to on-chain leaderboard (Stellar address = identity).
   * @param {string} address - Stellar public key
   * @param {number} wave
   * @param {number} score
   * @returns {Promise<{ success: boolean, entries?: Array }>}
   */
  static async submitOnChain(address, wave, score, name = '') {
    if (!address) return { success: false };
    try {
      const res = await fetch(`${getLeaderboardApiUrl()}/leaderboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: String(address),
          name: (name != null ? String(name) : '').trim().slice(0, 20),
          wave: Math.max(0, Math.floor(wave)),
          score: Math.max(0, Math.floor(score))
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn('[Leaderboard] submit failed:', res.status, data);
      }
      return res.ok ? { success: true, entries: data.entries } : { success: false };
    } catch (e) {
      console.warn('Leaderboard submitOnChain failed:', e);
      return { success: false };
    }
  }

  /**
   * Fetch top entries from on-chain leaderboard API.
   * @returns {Promise<Array<{ rank: number, name: string, wave: number, score: number }>>}
   */
  static async fetchOnChain() {
    try {
      const res = await fetch(`${getLeaderboardApiUrl()}/leaderboard`);
      const data = await res.json().catch(() => ({}));
      const entries = Array.isArray(data.entries) ? data.entries : [];
      return entries.map((e, i) => ({
        rank: i + 1,
        address: e.address ? String(e.address) : '',
        name: (e.name ? String(e.name) : (e.address ? shortAddress(e.address) : '???')).slice(0, 20),
        wave: e.wave ?? 0,
        score: e.score ?? 0,
        gamesPlayed: e.games_played ?? e.gamesPlayed ?? 0
      }));
    } catch (e) {
      console.warn('[Leaderboard] fetch failed:', e);
      return [];
    }
  }

  /**
   * Get local games-played count for a wallet (only this player sees their own count).
   * @param {string} address - Stellar public key
   * @returns {number}
   */
  static getLocalGamesPlayed(address) {
    if (!address) return 0;
    try {
      const raw = localStorage.getItem(LOCAL_GAMES_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const count = map[String(address)];
      return typeof count === 'number' && count >= 0 ? count : 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Increment local games-played for a wallet (call when a game is submitted / game over).
   * @param {string} address - Stellar public key
   */
  static incrementLocalGamesPlayed(address) {
    if (!address) return;
    try {
      const raw = localStorage.getItem(LOCAL_GAMES_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const key = String(address);
      map[key] = (map[key] ?? 0) + 1;
      localStorage.setItem(LOCAL_GAMES_KEY, JSON.stringify(map));
    } catch (e) {
      console.warn('LeaderboardManager.incrementLocalGamesPlayed failed:', e);
    }
  }

  /**
   * Get top N for display (local only).
   */
  static getTop(n = MAX_ENTRIES) {
    const entries = this.load().slice(0, n);
    return entries.map((e, i) => ({
      rank: i + 1,
      name: e.name,
      wave: e.wave,
      score: e.score
    }));
  }
}
