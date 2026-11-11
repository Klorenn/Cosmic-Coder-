import { describe, it, expect } from 'vitest';
import { WEAPONS, EVOLUTION_RECIPES, findEvolution, getWeaponDef, cloneWeapons } from '../data/weapons.js';
import {
  ENEMIES, MINI_BOSSES, BOSSES,
  getBossForWave, getMiniBossForWave, isBossWave, isMiniBossWave, nextMiniBossAction
} from '../data/enemies.js';
import { STAGES, getStageIndexForWave } from '../data/stages.js';
import { effectiveWeight } from '../systems/spawnDirector.js';

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

describe('weapons data', () => {
  it('keeps the 16 legacy base weapon ids (TitleScene/main.js compatibility)', () => {
    const legacy = ['basic', 'spread', 'pierce', 'orbital', 'rapid', 'homing', 'bounce', 'aoe', 'freeze',
      'rmrf', 'sudo', 'forkbomb', 'sword', 'spear', 'boomerang', 'kunai'];
    legacy.forEach((id) => expect(WEAPONS[id]).toBeDefined());
  });

  it('every weapon has a numeric color, damage and attackRate', () => {
    Object.values(WEAPONS).forEach((w) => {
      expect(typeof w.color).toBe('number');
      expect(w.damage).toBeGreaterThanOrEqual(0);
      expect(w.attackRate).toBeGreaterThanOrEqual(0);
    });
  });

  it('every recipe references two distinct existing base weapons', () => {
    Object.keys(EVOLUTION_RECIPES).forEach((combo) => {
      const parts = combo.split('+');
      expect(parts).toHaveLength(2);
      expect(parts[0]).not.toBe(parts[1]);
      parts.forEach((p) => expect(WEAPONS[p]).toBeDefined());
    });
  });

  it('evolution results are unique and never collide with a base weapon id', () => {
    const results = Object.values(EVOLUTION_RECIPES).map((r) => r.result);
    expect(new Set(results).size).toBe(results.length);
    results.forEach((r) => expect(WEAPONS[r]).toBeUndefined());
  });

  it('no duplicate unordered recipe pairs', () => {
    const keys = Object.keys(EVOLUTION_RECIPES).map((k) => k.split('+').sort().join('+'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has at least 4 evolutions that involve a melee weapon', () => {
    const melee = ['sword', 'spear', 'boomerang', 'kunai'];
    const meleeRecipes = Object.keys(EVOLUTION_RECIPES).filter((k) => k.split('+').some((p) => melee.includes(p)));
    expect(meleeRecipes.length).toBeGreaterThanOrEqual(4);
  });

  it('evolutions only use specials already rendered by ArenaScene', () => {
    const known = [undefined, 'homing', 'bounce', 'aoe', 'aura', 'freeze', 'freezeAoe'];
    Object.values(EVOLUTION_RECIPES).forEach((r) => expect(known).toContain(r.special));
  });

  it('findEvolution returns the recipe when both parts are collected and one was just picked up', () => {
    const evo = findEvolution(new Set(['basic', 'sword', 'spear']), 'spear');
    expect(evo).not.toBeNull();
    expect(evo.result).toBe(EVOLUTION_RECIPES['sword+spear'].result);
    expect(findEvolution(new Set(['basic', 'sword']), 'sword')).toBeNull();
    expect(findEvolution(new Set(['sword', 'spear', 'rapid']), 'rapid')).toBeNull();
  });

  it('getWeaponDef resolves base and evolved weapons, falls back to basic', () => {
    expect(getWeaponDef('spread')).toBe(WEAPONS.spread);
    expect(getWeaponDef('laserbeam').name).toBe('LASER BEAM');
    expect(getWeaponDef('nope')).toBe(WEAPONS.basic);
  });

  it('cloneWeapons returns an independent copy (scene mutates it on evolution)', () => {
    const c = cloneWeapons();
    c.newThing = { color: 1 };
    c.basic.damage = 99;
    expect(WEAPONS.newThing).toBeUndefined();
    expect(WEAPONS.basic.damage).toBe(1);
  });
});

describe('enemies data', () => {
  const entries = Object.entries(ENEMIES);

  it('every enemy has waveMin >= 1 and positive health/damage/xp, non-negative speed', () => {
    entries.forEach(([, e]) => {
      expect(e.waveMin).toBeGreaterThanOrEqual(1);
      expect(e.health).toBeGreaterThan(0);
      expect(e.damage).toBeGreaterThan(0);
      expect(e.xpValue).toBeGreaterThan(0);
      expect(e.speed).toBeGreaterThanOrEqual(0);
      expect(typeof e.behavior).toBe('string');
    });
  });

  it('only stationary behaviors have speed 0', () => {
    entries.filter(([, e]) => e.speed === 0).forEach(([, e]) => {
      expect(['deathzone', 'blocker']).toContain(e.behavior);
    });
  });

  it('early enemies (waveMin 1-5): at least 6 new types, trash/normal, with a v2 sprite', () => {
    const early = ['typo', 'null-byte', 'pop-up', 'spam-bot', 'cookie', 'lag-spike'];
    early.forEach((id) => {
      const e = ENEMIES[id];
      expect(e, id).toBeDefined();
      expect(e.waveMin).toBeGreaterThanOrEqual(1);
      expect(e.waveMin).toBeLessThanOrEqual(5);
      expect(['trash', 'normal']).toContain(e.tier);
      expect(e.texture).toBe(`enemy-${id}-v2`);
    });
  });

  it('spawn pool variety: wave 1 >= 3 types, wave 3 >= 5, wave 5 >= 7; bug is < 50 % of wave 1', () => {
    const pool = (w) => entries.filter(([, e]) => effectiveWeight(e, w) > 0).map(([id]) => id);
    expect(pool(1).length).toBeGreaterThanOrEqual(3);
    expect(pool(1).length).toBeLessThanOrEqual(5);
    expect(pool(3).length).toBeGreaterThanOrEqual(5);
    expect(pool(5).length).toBeGreaterThanOrEqual(7);
    const trash1 = entries.filter(([, e]) => e.tier === 'trash' && effectiveWeight(e, 1) > 0);
    const bugShareOfTrash = effectiveWeight(ENEMIES.bug, 1) / trash1.reduce((a, [, e]) => a + effectiveWeight(e, 1), 0);
    expect(bugShareOfTrash * 0.7).toBeLessThan(0.5);
  });

  it('segfault damage typo is fixed', () => {
    expect(ENEMIES.segfault.damage).toBeLessThan(50);
  });

  it('no enemy damage/health/speed is more than 3x the median of regular enemies', () => {
    const regular = entries.map(([, e]) => e);
    const dmgMed = median(regular.map((e) => e.damage));
    const hpMed = median(regular.map((e) => e.health));
    const spdMed = median(regular.filter((e) => e.speed > 0).map((e) => e.speed));
    regular.forEach((e) => {
      expect(e.damage).toBeLessThanOrEqual(dmgMed * 3);
      expect(e.health).toBeLessThanOrEqual(hpMed * 3);
      expect(e.speed).toBeLessThanOrEqual(spdMed * 3);
    });
  });

  it('bosses are sorted by wave, waves are multiples of 20, positive stats', () => {
    const list = Object.values(BOSSES);
    for (let i = 1; i < list.length; i++) expect(list[i].wave).toBeGreaterThan(list[i - 1].wave);
    list.forEach((b) => {
      expect(b.wave % 20).toBe(0);
      expect(b.health).toBeGreaterThan(0);
      expect(b.damage).toBeGreaterThan(0);
    });
  });

  it('has at least 4 mini-bosses with distinct abilities, sorted by minWave on mini-boss waves', () => {
    const list = Object.values(MINI_BOSSES);
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(new Set(list.map((m) => m.ability)).size).toBe(list.length);
    for (let i = 1; i < list.length; i++) expect(list[i].minWave).toBeGreaterThan(list[i - 1].minWave);
    list.forEach((m) => {
      expect(isMiniBossWave(m.minWave)).toBe(true);
      expect(m.health).toBeGreaterThan(0);
      expect(m.abilityCooldown).toBeGreaterThan(0);
    });
  });

  it('ids are unique across enemies, mini-bosses and bosses', () => {
    const ids = [...Object.keys(ENEMIES), ...Object.keys(MINI_BOSSES), ...Object.keys(BOSSES)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('wave schedule helpers', () => {
    expect(isBossWave(20)).toBe(true);
    expect(isBossWave(30)).toBe(false);
    expect(isMiniBossWave(10)).toBe(true);
    expect(isMiniBossWave(30)).toBe(true);
    expect(isMiniBossWave(20)).toBe(false);
    expect(isMiniBossWave(5)).toBe(false);
    expect(getBossForWave(20)).toBe('boss-stackoverflow');
    expect(getBossForWave(40)).toBe('boss-nullpointer');
    expect(getBossForWave(60)).toBe('boss-memoryleakprime');
    expect(getBossForWave(80)).toBe('boss-kernelpanic');
    expect(getBossForWave(200)).toBe('boss-kernelpanic');
    expect(getMiniBossForWave(10)).toBe('miniboss-deadlock');
    const ids = new Set([10, 30, 50, 70, 110, 150].map(getMiniBossForWave));
    expect(ids.size).toBeGreaterThanOrEqual(4);
  });

  it('nextMiniBossAction respects cooldown and range', () => {
    const def = MINI_BOSSES['miniboss-deadlock'];
    expect(nextMiniBossAction(def, { now: 100, lastAbilityTime: 0, distToPlayer: 50 })).toBeNull();
    const t = def.abilityCooldown + 1;
    expect(nextMiniBossAction(def, { now: t, lastAbilityTime: 0, distToPlayer: 50 })).toBe(def.ability);
    expect(nextMiniBossAction(def, { now: t, lastAbilityTime: 0, distToPlayer: def.abilityRange + 1 })).toBeNull();
  });
});

describe('stages data', () => {
  it('has strictly increasing startWave beginning at 1 and unique keys', () => {
    expect(STAGES[0].startWave).toBe(1);
    for (let i = 1; i < STAGES.length; i++) expect(STAGES[i].startWave).toBeGreaterThan(STAGES[i - 1].startWave);
    expect(new Set(STAGES.map((s) => s.stageKey)).size).toBe(STAGES.length);
  });

  it('getStageIndexForWave maps waves to stages', () => {
    expect(getStageIndexForWave(1)).toBe(0);
    expect(getStageIndexForWave(24)).toBe(0);
    expect(getStageIndexForWave(25)).toBe(1);
    expect(getStageIndexForWave(999)).toBe(STAGES.length - 1);
  });
});
