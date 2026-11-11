/**
 * SaveManager - Handles run persistence for Continue functionality
 * Auto-saves at wave completion, allows continuing from last checkpoint
 */
import { logger } from '../utils/log.js';

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonNeg = (v) => isFiniteNum(v) && v >= 0;

/**
 * Structural validation of an untrusted save blob (localStorage / wallet API).
 * Anything that would later crash applySaveToScene/getSaveSummary or inject NaN is rejected.
 */
export function isValidSave(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!isFiniteNum(data.timestamp)) return false;
  if (!Number.isInteger(data.wave) || data.wave < 1) return false;
  if (data.stage !== undefined && !isNonNeg(data.stage)) return false;
  const p = data.player;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (!Number.isInteger(p.level) || p.level < 1) return false;
  for (const k of ['xp', 'totalXP', 'kills']) if (!isNonNeg(p[k])) return false;
  if (!isFiniteNum(p.health) || p.health <= 0) return false;
  if (p.maxHealth !== undefined && !(isFiniteNum(p.maxHealth) && p.maxHealth > 0)) return false;
  if (p.streak !== undefined && !isNonNeg(p.streak)) return false;
  if (p.score !== undefined && !isNonNeg(p.score)) return false;
  const w = data.weapons;
  if (!w || typeof w !== 'object' || !Array.isArray(w.collected)) return false;
  if (w.collected.some((t) => typeof t !== 'string')) return false;
  if (w.current != null && (typeof w.current !== 'object' || typeof w.current.type !== 'string')) return false;
  return true;
}

export default class SaveManager {
  static SAVE_KEY = 'vibeCoderRunSave';

  /**
   * Save current run state
   * @param {object} data - Run data to save
   */
  static saveRun(data) {
    const saveData = {
      wave: data.wave,
      stage: data.stage,
      player: {
        level: data.player.level,
        xp: data.player.xp,
        totalXP: data.player.totalXP,
        score: data.player.score,
        health: data.player.health,
        maxHealth: data.player.maxHealth,
        kills: data.player.kills,
        streak: data.player.streak
      },
      weapons: {
        current: data.weapons.current,
        collected: Array.from(data.weapons.collected)
      },
      modifiers: data.modifiers || [],
      runSeed: data.runSeed || null,
      timestamp: Date.now(),
      version: 2
    };

    try {
      localStorage.setItem(this.SAVE_KEY, JSON.stringify(saveData));
      return true;
    } catch (e) {
      console.error('Failed to save run:', e);
      return false;
    }
  }

  /**
   * Load saved run state
   * @returns {object|null} Saved run data or null if none exists
   */
  static loadRun() {
    try {
      const saved = localStorage.getItem(this.SAVE_KEY);
      if (!saved) return null;

      const data = JSON.parse(saved);
      if (!isValidSave(data)) {
        logger.warn('Discarding corrupted run save');
        this.clearSave();
        return null;
      }

      // Check if save is too old (24 hours)
      const maxAge = 24 * 60 * 60 * 1000;
      if (Date.now() - data.timestamp > maxAge) {
        this.clearSave();
        return null;
      }

      return data;
    } catch (e) {
      logger.warn('Failed to load run:', e);
      try { this.clearSave(); } catch (_) { /* storage unavailable */ }
      return null;
    }
  }

  /**
   * Check if a saved run exists
   * @returns {boolean} True if valid save exists
   */
  static hasSave() {
    const save = this.loadRun();
    return save !== null;
  }

  /**
   * Get save summary for display
   * @returns {object|null} Summary with wave, stage, timestamp
   */
  static getSaveSummary() {
    const save = this.loadRun();
    if (!save) return null;

    return {
      wave: save.wave,
      stage: save.stage,
      level: save.player.level,
      kills: save.player.kills,
      timestamp: save.timestamp,
      timeAgo: this.getTimeAgo(save.timestamp)
    };
  }

  /**
   * Clear saved run
   */
  static clearSave() {
    localStorage.removeItem(this.SAVE_KEY);
  }

  /**
   * Restore save from wallet-backed data (called when loading progress from API).
   * @param {object} data - Same shape as saveRun output
   */
  static setFromWalletData(data) {
    if (!data || typeof data !== 'object') return;
    try {
      localStorage.setItem(this.SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to restore save from wallet:', e);
    }
  }

  /**
   * Get current save data for wallet persistence (server API).
   * @returns {object|null}
   */
  static getSaveDataForWallet() {
    const saved = localStorage.getItem(this.SAVE_KEY);
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch (_) {
      return null;
    }
  }

  /**
   * Get human-readable time ago string
   * @param {number} timestamp - Unix timestamp
   * @returns {string} Human-readable time ago
   */
  static getTimeAgo(timestamp) {
    const elapsed = Date.now() - timestamp;
    if (typeof timestamp !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) return 'just now';
    const seconds = Math.floor(elapsed / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  /**
   * Apply saved state to game objects
   * @param {object} save - Saved data from loadRun()
   * @param {object} scene - ArenaScene instance
   */
  static applySaveToScene(save, scene) {
    if (!save) return false;

    // Restore wave and stage
    scene.waveNumber = save.wave;
    scene.currentStage = save.stage;

    // Restore player stats
    const vibeState = window.VIBE_CODER;
    vibeState.level = save.player.level;
    vibeState.xp = save.player.xp;
    vibeState.totalXP = save.player.totalXP;
    // Older saves have no score: fall back to totalXP (score never below what was earned).
    vibeState.score = isNonNeg(save.player.score) ? save.player.score : save.player.totalXP;
    vibeState.kills = save.player.kills;
    vibeState.streak = save.player.streak;

    // Restore player health — never above the scene's computed max (a hand-edited save must not grant god mode)
    const sceneMax = scene.player && isFiniteNum(scene.player.maxHealth) && scene.player.maxHealth > 0
      ? scene.player.maxHealth
      : save.player.maxHealth;
    const restored = isFiniteNum(save.player.health) ? save.player.health : sceneMax;
    scene.player.health = isFiniteNum(sceneMax) ? Math.max(1, Math.min(sceneMax, restored)) : Math.max(1, restored);

    // Restore collected weapons
    scene.collectedWeapons = new Set(save.weapons.collected);

    // Restore current weapon if not basic
    if (save.weapons.current && save.weapons.current.type !== 'basic') {
      scene.currentWeapon = {
        type: save.weapons.current.type,
        duration: save.weapons.current.duration || 15000,
        isEvolved: save.weapons.current.isEvolved || false
      };
    }

    if (save.runSeed && typeof save.runSeed === 'string') {
      scene.runSeed = save.runSeed;
      scene.runSeedRestoredFromSave = true;
    }

    return true;
  }
}
