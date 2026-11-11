import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installLocalStorage, CORRUPT_JSON, seededRng, pick, HOSTILE_VALUES, isFiniteNumber } from './_hostile.js';

const { store } = installLocalStorage();

const SaveManager = (await import('../../systems/SaveManager.js')).default;
const RebirthManager = (await import('../../systems/RebirthManager.js')).default;
const RunModifiers = (await import('../../systems/RunModifiers.js')).default;
const LeaderboardManager = (await import('../../systems/LeaderboardManager.js')).default;
const { parseStoredSettings, DEFAULT_SETTINGS } = await import('../../utils/settings.js');

const quiet = () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
};

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  vi.restoreAllMocks();
  quiet();
});

function validSave(overrides = {}) {
  return {
    wave: 7, stage: 1,
    player: { level: 5, xp: 10, totalXP: 900, health: 80, maxHealth: 120, kills: 40, streak: 1 },
    weapons: { current: { type: 'basic' }, collected: ['basic', 'spread'] },
    modifiers: [], runSeed: 'abc', timestamp: Date.now(), version: 2,
    ...overrides
  };
}

describe('EVIL SaveManager with poisoned localStorage', () => {
  it.each(CORRUPT_JSON)('loadRun/hasSave/getSaveSummary never throw on %s', (raw) => {
    store[SaveManager.SAVE_KEY] = raw;
    expect(() => SaveManager.loadRun()).not.toThrow();
    expect(() => SaveManager.hasSave()).not.toThrow();
    expect(() => SaveManager.getSaveSummary()).not.toThrow();
  });

  it.each([
    ['missing player', { player: undefined }],
    ['player is a string', { player: 'hacker' }],
    ['missing weapons', { weapons: undefined }],
    ['collected not an array', { weapons: { current: null, collected: 'spread' } }],
    ['missing timestamp', { timestamp: undefined }],
    ['timestamp string', { timestamp: 'yesterday' }],
    ['NaN-ish wave', { wave: 'ten' }],
    ['negative wave', { wave: -5 }],
    ['health string', { player: { level: 1, xp: 0, totalXP: 0, health: 'full', maxHealth: 100, kills: 0, streak: 1 } }],
    ['level null', { player: { level: null, xp: 0, totalXP: 0, health: 1, maxHealth: 100, kills: 0, streak: 1 } }]
  ])('rejects a structurally invalid save (%s) instead of returning it', (_label, patch) => {
    store[SaveManager.SAVE_KEY] = JSON.stringify(validSave(patch));
    expect(SaveManager.loadRun()).toBeNull();
    expect(SaveManager.hasSave()).toBe(false);
    expect(SaveManager.getSaveSummary()).toBeNull();
  });

  it('still loads an honest save', () => {
    store[SaveManager.SAVE_KEY] = JSON.stringify(validSave());
    expect(SaveManager.loadRun()?.wave).toBe(7);
  });

  it('applySaveToScene never grants more HP than the scene maxHealth', () => {
    const save = validSave({ player: { level: 5, xp: 10, totalXP: 900, health: 1e9, maxHealth: 1e9, kills: 40, streak: 1 } });
    globalThis.window = { VIBE_CODER: {} };
    const scene = { player: { health: 100, maxHealth: 150 } };
    SaveManager.applySaveToScene(save, scene);
    expect(scene.player.health).toBeLessThanOrEqual(150);
    expect(scene.player.health).toBeGreaterThan(0);
    delete globalThis.window;
  });

  it('getTimeAgo never prints NaN', () => {
    for (const ts of [NaN, undefined, 'x', Infinity, -Infinity, Date.now() + 1e9]) {
      expect(SaveManager.getTimeAgo(ts)).not.toMatch(/NaN|Infinity|-/);
    }
  });
});

describe('EVIL RebirthManager with poisoned localStorage', () => {
  const checkBounded = () => {
    const all = RebirthManager.getAllStatsMultiplier();
    const xp = RebirthManager.getXPMultiplier();
    const w = RebirthManager.getStartingWeaponCount();
    const maxLevel = RebirthManager.MILESTONES.length;
    expect(isFiniteNumber(all)).toBe(true);
    expect(all).toBeGreaterThanOrEqual(1);
    expect(all).toBeLessThanOrEqual(1 + maxLevel * RebirthManager.BONUSES.allStats + 1e-9);
    expect(isFiniteNumber(xp)).toBe(true);
    expect(xp).toBeGreaterThanOrEqual(1);
    expect(xp).toBeLessThanOrEqual(1 + maxLevel * RebirthManager.BONUSES.xpGain + 1e-9);
    expect(Number.isInteger(w)).toBe(true);
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThanOrEqual(3);
    const info = RebirthManager.getRebirthInfo();
    expect(typeof info.name).toBe('string');
    expect(Array.isArray(RebirthManager.getStartingWeapons())).toBe(true);
  };

  it.each(CORRUPT_JSON)('bonuses stay bounded and nothing throws for raw %s', (raw) => {
    store[RebirthManager.STORAGE_KEY] = raw;
    expect(checkBounded).not.toThrow();
  });

  it.each([-5, -0.5, 2.5, 6, 999, 1e12, 'abc', null, true, [3]])('rebirthLevel=%s is clamped into [0, max]', (lvl) => {
    store[RebirthManager.STORAGE_KEY] = JSON.stringify({ rebirthLevel: lvl, highestWave: -1, totalRebirths: 'x', lifetimeKills: null });
    checkBounded();
    const d = RebirthManager.load();
    expect(Number.isInteger(d.rebirthLevel)).toBe(true);
    for (const k of ['highestWave', 'totalRebirths', 'lifetimeKills']) {
      expect(isFiniteNumber(d[k])).toBe(true);
      expect(d[k]).toBeGreaterThanOrEqual(0);
    }
  });

  it('performRebirth with hostile kills/wave never stores NaN', () => {
    const rng = seededRng(4);
    for (let i = 0; i < 50; i++) {
      RebirthManager.performRebirth(pick(rng, [50, 100, 250, 1e9, ...HOSTILE_VALUES.filter((v) => typeof v !== 'symbol')]), pick(rng, HOSTILE_VALUES.filter((v) => typeof v !== 'symbol')));
      const d = RebirthManager.load();
      for (const k of ['rebirthLevel', 'highestWave', 'totalRebirths', 'lifetimeKills']) {
        expect(isFiniteNumber(d[k])).toBe(true);
        expect(d[k]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('EVIL RunModifiers', () => {
  it.each(CORRUPT_JSON.concat(['"vampiric_glass_cannon"', '"glass_cannon"']))('load() returns only real modifiers for raw %s', (raw) => {
    store[RunModifiers.STORAGE_KEY] = raw;
    const mods = RunModifiers.load();
    expect(Array.isArray(mods)).toBe(true);
    if (!raw.startsWith('[')) expect(mods).toEqual([]);
  });

  it('getCombinedEffects tolerates garbage and keeps multipliers finite & > 0', () => {
    const garbage = [null, undefined, 'x', 42, {}, [null, { effects: null }, { effects: { damageMultiplier: NaN, xpMult: -2, projectileCount: 'lots', vampiricEnemies: 'yes' } }]];
    for (const g of garbage) {
      let c;
      expect(() => { c = RunModifiers.getCombinedEffects(g); }).not.toThrow();
      for (const [k, v] of Object.entries(c)) {
        if (k === 'vampiricEnemies') expect(typeof v).toBe('boolean');
        else { expect(isFiniteNumber(v)).toBe(true); expect(v).toBeGreaterThan(0); }
      }
    }
  });
});

describe('EVIL LeaderboardManager local storage', () => {
  it.each(['[null]', '[1,"a",null,{}]', '[{"name":null,"score":"x","wave":{}}]', '{', '1e400'])('getTop/addEntry never throw on %s', (raw) => {
    store.cosmicCoderLeaderboard = raw;
    expect(() => LeaderboardManager.getTop()).not.toThrow();
    expect(() => LeaderboardManager.addEntry('evil', 3, 20)).not.toThrow();
    for (const e of LeaderboardManager.getTop()) {
      expect(isFiniteNumber(e.score)).toBe(true);
      expect(isFiniteNumber(e.wave)).toBe(true);
      expect(typeof e.name).toBe('string');
    }
  });

  it('addEntry with hostile wave/score stores finite, non-negative numbers', () => {
    for (const v of [NaN, -1, Infinity, 'x', null, undefined]) {
      LeaderboardManager.addEntry(v, v, v);
    }
    for (const e of LeaderboardManager.load()) {
      expect(isFiniteNumber(e.score)).toBe(true);
      expect(isFiniteNumber(e.wave)).toBe(true);
      expect(e.score).toBeGreaterThanOrEqual(0);
    }
  });

  it('submitOnChain refuses rule-breaking runs before touching the network', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    globalThis.fetch = fetchSpy;
    for (const [wave, score] of [[NaN, 100], [10, 1], [0, 0], [5, -10], [3, Infinity], ['5', '100']]) {
      const r = await LeaderboardManager.submitOnChain('GEVIL', wave, score, 'evil');
      expect(r.success).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    delete globalThis.fetch;
  });
});

describe('EVIL settings parsing (vibeCoderSettings)', () => {
  it.each([...CORRUPT_JSON, null, ''])('parseStoredSettings never throws and returns sane values for %s', (raw) => {
    let s;
    expect(() => { s = parseStoredSettings(raw); }).not.toThrow();
    for (const k of ['masterVolume', 'sfxVolume', 'menuMusicVolume', 'gameplayMusicVolume', 'xpPenaltyOnDeath']) {
      expect(isFiniteNumber(s[k])).toBe(true);
      expect(s[k]).toBeGreaterThanOrEqual(0);
      expect(s[k]).toBeLessThanOrEqual(1);
    }
    for (const k of ['autoMove', 'sfxEnabled', 'musicEnabled', 'immortalMode']) expect(typeof s[k]).toBe('boolean');
    expect(typeof s.playerName).toBe('string');
    expect(['en', 'es']).toContain(s.language);
  });

  it('clamps absurd values and coerces wrong types', () => {
    const s = parseStoredSettings(JSON.stringify({
      masterVolume: 99, sfxVolume: -3, musicVolume: 'loud', xpPenaltyOnDeath: 5,
      playerName: { evil: true }, immortalMode: 'yes', language: 'klingon', autoMove: 0
    }));
    expect(s.masterVolume).toBe(1);
    expect(s.sfxVolume).toBe(0);
    expect(s.menuMusicVolume).toBe(DEFAULT_SETTINGS.menuMusicVolume);
    expect(s.xpPenaltyOnDeath).toBe(1);
    expect(s.playerName).toBe('');
    expect(s.immortalMode).toBe(DEFAULT_SETTINGS.immortalMode);
    expect(s.language).toBe('en');
    expect(s.autoMove).toBe(DEFAULT_SETTINGS.autoMove);
  });

  it('keeps honest settings and truncates long names', () => {
    const s = parseStoredSettings(JSON.stringify({ masterVolume: 0.3, language: 'es', playerName: 'x'.repeat(50), sfxEnabled: false }));
    expect(s.masterVolume).toBe(0.3);
    expect(s.language).toBe('es');
    expect(s.playerName).toHaveLength(20);
    expect(s.sfxEnabled).toBe(false);
  });
});
