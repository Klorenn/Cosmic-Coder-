import { getLeaderboardUrl } from '../config/runtime.js';
import { validateGameRules } from '../zk/gameProof.js';
import { logger } from '../utils/log.js';
/**
 * LeaderboardManager - Single on-chain/API leaderboard (no local/Anonymous list).
 * Submit and fetch from backend API (Stellar address = identity). Everyone can view
 * the same leaderboard without logging in. Backend should persist to Supabase so
 * results are always active (see docs/SUPABASE_COSMIC_CODER_SETUP.md).
 */
const STORAGE_KEY = 'cosmicCoderLeaderboard';
const LOCAL_GAMES_KEY = 'cosmicCoderGamesPlayed';
const MAX_ENTRIES = 10;

function getLeaderboardApiUrl() {
  return getLeaderboardUrl();
}

const finiteNonNeg = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Drop corrupted local entries (null, primitives) and coerce fields so sort/getTop never throw or show NaN. */
function sanitizeEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  return {
    name: typeof e.name === 'string' && e.name.trim() ? e.name.slice(0, 20) : 'Anonymous',
    wave: Math.floor(finiteNonNeg(e.wave)),
    score: Math.floor(finiteNonNeg(e.score)),
    date: finiteNonNeg(e.date)
  };
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
        return Array.isArray(data) ? data.map(sanitizeEntry).filter(Boolean) : [];
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
    const displayName = (typeof name === 'string' ? name : '').trim() || 'Anonymous';
    entries.push({
      name: displayName.slice(0, 20),
      wave: Math.floor(finiteNonNeg(wave)),
      score: Math.floor(finiteNonNeg(score)),
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
    // Never send a run that breaks the game rules (NaN, score < wave*5, overflow...) to the network.
    const rules = validateGameRules(wave, score);
    if (!rules.valid) {
      logger.warn('[Leaderboard] submit rejected locally:', rules.reason);
      return { success: false, reason: rules.reason };
    }
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
   * If API returns empty, returns local entries (localStorage) so rankings are visible after playing.
   * @returns {Promise<Array<{ rank: number, name: string, wave: number, score: number, address?: string }>>}
   */
  static async fetchOnChain() {
    try {
      const res = await fetch(`${getLeaderboardApiUrl()}/leaderboard`);
      const data = await res.json().catch(() => ({}));
      const entries = Array.isArray(data.entries) ? data.entries : [];
      if (entries.length > 0) {
        return entries.map((e, i) => ({
          rank: i + 1,
          address: e.address ? String(e.address) : '',
          name: (e.name ? String(e.name) : (e.address ? shortAddress(e.address) : '???')).slice(0, 20),
          wave: e.wave ?? 0,
          score: e.score ?? 0,
          gamesPlayed: e.games_played ?? e.gamesPlayed ?? 0
        }));
      }
      const local = this.load();
      if (local.length > 0) {
        return local.map((e, i) => ({
          rank: i + 1,
          address: '',
          name: (e.name || 'Anonymous').slice(0, 20),
          wave: e.wave ?? 0,
          score: e.score ?? 0,
          gamesPlayed: 0
        }));
      }
      return [];
    } catch (e) {
      console.warn('[Leaderboard] fetch failed:', e);
      const local = this.load();
      if (local.length > 0) {
        return local.map((e, i) => ({
          rank: i + 1,
          address: '',
          name: (e.name || 'Anonymous').slice(0, 20),
          wave: e.wave ?? 0,
          score: e.score ?? 0,
          gamesPlayed: 0
        }));
      }
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
