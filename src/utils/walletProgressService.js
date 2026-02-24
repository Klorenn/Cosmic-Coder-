/**
 * Wallet-backed progress service.
 * Loads/saves upgrades, legendaries, high wave/score, save state via API.
 * Fallback: high score / high wave persisted to localStorage when API fails or no wallet.
 */

import * as stellarWallet from './stellarWallet.js';
import { fetchProgress, saveProgress as apiSaveProgress } from './walletProgressApi.js';

const LOCAL_PROGRESS_KEY = 'cosmicCoderProgressLocal';

/** Global store for high wave/score and selected character (set on load) */
export const progressStore = {
  highWave: 0,
  highScore: 0,
  selectedCharacter: 'vibecoder'
};

function loadLocalProgress() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_PROGRESS_KEY) : null;
    if (!raw) return null;
    const o = JSON.parse(raw);
    return {
      highWave: typeof o.highWave === 'number' ? o.highWave : 0,
      highScore: typeof o.highScore === 'number' ? o.highScore : 0
    };
  } catch (_) {
    return null;
  }
}

function saveLocalProgress(highWave, highScore) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify({
      highWave: typeof highWave === 'number' ? highWave : 0,
      highScore: typeof highScore === 'number' ? highScore : 0
    }));
  } catch (_) {}
}

/** Hydrate progressStore from localStorage (e.g. when no wallet or before API load). Call at app/scene init. */
export function hydrateProgressFromLocal() {
  const local = loadLocalProgress();
  if (local) {
    progressStore.highWave = local.highWave;
    progressStore.highScore = local.highScore;
  }
}

/**
 * Load progress from API and hydrate VIBE_UPGRADES, VIBE_LEGENDARIES, SaveManager, progressStore.
 * @param {string} address - Wallet address
 * @returns {Promise<boolean>} true if loaded, false if failed or no data
 */
export async function loadProgressForWallet(address) {
  if (!address) {
    const local = loadLocalProgress();
    if (local) {
      progressStore.highWave = local.highWave;
      progressStore.highScore = local.highScore;
    }
    return false;
  }
  const data = await fetchProgress(address);
  if (!data) {
    const local = loadLocalProgress();
    if (local) {
      progressStore.highWave = local.highWave;
      progressStore.highScore = local.highScore;
    }
    return false;
  }

  const upgrades = data.upgrades;
  const legendaries = data.legendaries;

  if (upgrades && typeof upgrades === 'object') {
    window.VIBE_UPGRADES.levels = upgrades.levels || {};
    window.VIBE_UPGRADES.currency = typeof upgrades.currency === 'number' ? upgrades.currency : 0;
    for (const key of Object.keys(window.VIBE_UPGRADES.upgrades)) {
      if (window.VIBE_UPGRADES.levels[key] === undefined) window.VIBE_UPGRADES.levels[key] = 0;
    }
  }

  if (legendaries && typeof legendaries === 'object') {
    window.VIBE_LEGENDARIES.unlocked = Array.isArray(legendaries.unlocked) ? legendaries.unlocked : [];
    window.VIBE_LEGENDARIES.equipped = legendaries.equipped || null;
  }

  progressStore.highWave = typeof data.highWave === 'number' ? data.highWave : 0;
  progressStore.highScore = typeof data.highScore === 'number' ? data.highScore : 0;
  const validChars = ['vibecoder', 'destroyer', 'swordsman'];
  progressStore.selectedCharacter = validChars.includes(data.selectedCharacter) ? data.selectedCharacter : 'vibecoder';
  if (typeof window !== 'undefined') window.VIBE_SELECTED_CHARACTER = progressStore.selectedCharacter;

  if (data.saveState && typeof data.saveState === 'object') {
    const SaveManager = (await import('../systems/SaveManager.js')).default;
    SaveManager.setFromWalletData(data.saveState);
  } else {
    const SaveManager = (await import('../systems/SaveManager.js')).default;
    SaveManager.clearSave();
  }

  return true;
}

/**
 * Save current progress to API (upgrades, legendaries, highWave, highScore, saveState).
 * @param {string} address - Wallet address
 * @param {object} [extra] - Optional { highWave, highScore, saveState } to override current
 * @returns {Promise<boolean>}
 */
export async function saveProgressToWallet(address, extra = {}) {
  if (!address) return false;
  const payload = {
    upgrades: { levels: window.VIBE_UPGRADES?.levels || {}, currency: window.VIBE_UPGRADES?.currency ?? 0 },
    legendaries: { unlocked: window.VIBE_LEGENDARIES?.unlocked || [], equipped: window.VIBE_LEGENDARIES?.equipped ?? null },
    highWave: extra.highWave ?? progressStore.highWave,
    highScore: extra.highScore ?? progressStore.highScore,
    saveState: extra.saveState ?? (await import('../systems/SaveManager.js')).default.getSaveDataForWallet?.() ?? null,
    selectedCharacter: extra.selectedCharacter ?? progressStore.selectedCharacter ?? window.VIBE_SELECTED_CHARACTER ?? 'vibecoder'
  };
  const ok = await apiSaveProgress(address, payload);
  if (ok && extra.highWave != null) progressStore.highWave = extra.highWave;
  if (ok && extra.highScore != null) progressStore.highScore = extra.highScore;
  if (ok && extra.selectedCharacter != null) {
    progressStore.selectedCharacter = extra.selectedCharacter;
    if (typeof window !== 'undefined') window.VIBE_SELECTED_CHARACTER = extra.selectedCharacter;
  }
  const hw = extra.highWave ?? progressStore.highWave;
  const hs = extra.highScore ?? progressStore.highScore;
  if (!ok) saveLocalProgress(hw, hs);
  else saveLocalProgress(hw, hs);
  return ok;
}

/**
 * Reset progress to empty when wallet disconnects.
 */
export function resetProgressForDisconnect() {
  const upgrades = window.VIBE_UPGRADES?.upgrades;
  if (upgrades) {
    window.VIBE_UPGRADES.levels = {};
    for (const key of Object.keys(upgrades)) {
      window.VIBE_UPGRADES.levels[key] = 0;
    }
    window.VIBE_UPGRADES.currency = 0;
  }
  window.VIBE_LEGENDARIES.unlocked = [];
  window.VIBE_LEGENDARIES.equipped = null;
  progressStore.highWave = 0;
  progressStore.highScore = 0;
  progressStore.selectedCharacter = 'vibecoder';
  if (typeof window !== 'undefined') window.VIBE_SELECTED_CHARACTER = 'vibecoder';
  import('../systems/SaveManager.js').then(({ default: SaveManager }) => SaveManager.clearSave());
}

/**
 * Persist current state to API if wallet connected. Call after upgrades/legendaries changes.
 */
export async function persistIfWalletConnected() {
  const addr = await stellarWallet.getAddress();
  if (!addr) return false;
  return saveProgressToWallet(addr);
}

/** Character ids in order for cycling */
const CHAR_ORDER = ['vibecoder', 'destroyer', 'swordsman'];

/**
 * Select character and persist to wallet. Returns new character id.
 */
export async function selectCharacter(charId) {
  const valid = CHAR_ORDER.includes(charId);
  const id = valid ? charId : 'vibecoder';
  progressStore.selectedCharacter = id;
  window.VIBE_SELECTED_CHARACTER = id;
  const addr = await stellarWallet.getAddress();
  if (addr) await saveProgressToWallet(addr, { selectedCharacter: id });
  return id;
}

/**
 * Cycle to next/prev character. dir: 1 = next, -1 = prev.
 */
export function cycleCharacter(dir) {
  const idx = CHAR_ORDER.indexOf(progressStore.selectedCharacter);
  const nextIdx = (idx + dir + CHAR_ORDER.length) % CHAR_ORDER.length;
  return selectCharacter(CHAR_ORDER[nextIdx]);
}
