import { describe, it, expect } from 'vitest';
import { CHARACTERS, CHARACTER_IDS, getCharacterAbility } from '../data/characters.js';
import {
  createAbilityState, canActivate, activate, tick, cooldownPct, cooldownRemaining, isActive,
  shouldAutoUse, buildSnapshot, contactLockTimestamp, knockbackVector, dashDirection,
  dashEndpoint, distanceToSegment, abilityDamage, enemiesInRadius
} from '../systems/abilities/abilityRules.js';
import abilitiesEn from '../locales/abilities.en.js';
import abilitiesEs from '../locales/abilities.es.js';

/** Seeded LCG so fuzz-style tests are deterministic. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);

describe('characters data integrity', () => {
  it('ids match VIBE_CHARACTERS (vibecoder, destroyer, swordsman)', () => {
    expect(CHARACTER_IDS).toEqual(['vibecoder', 'destroyer', 'swordsman']);
    Object.entries(CHARACTERS).forEach(([k, c]) => expect(c.id).toBe(k));
  });

  it('each character has one ability with positive cooldown, SPACE key and finite params', () => {
    const abilityIds = new Set();
    for (const c of Object.values(CHARACTERS)) {
      const a = c.ability;
      expect(typeof a.id).toBe('string');
      expect(abilityIds.has(a.id)).toBe(false);
      abilityIds.add(a.id);
      expect(a.cooldownMs).toBeGreaterThan(0);
      expect(a.key).toBe('SPACE');
      expect(a.name_key).toMatch(/^abilities\.[a-z_]+\.name$/);
      expect(a.desc_key).toMatch(/^abilities\.[a-z_]+\.desc$/);
      expect(isFiniteNum(a.color)).toBe(true);
      Object.values(a.params).forEach((v) => expect(isFiniteNum(v)).toBe(true));
    }
  });

  it('matches the design numbers', () => {
    expect(CHARACTERS.vibecoder.ability).toMatchObject({ id: 'HOT_RELOAD', cooldownMs: 25000 });
    expect(CHARACTERS.vibecoder.ability.params).toMatchObject({ healPct: 0.3, iFrameMs: 2000, attackRateMult: 1.25, buffMs: 6000 });
    expect(CHARACTERS.destroyer.ability).toMatchObject({ id: 'RM_RF', cooldownMs: 30000 });
    expect(CHARACTERS.destroyer.ability.params).toMatchObject({ radius: 260, damageMult: 4, bossDamageMult: 2, knockbackPx: 150 });
    expect(CHARACTERS.swordsman.ability).toMatchObject({ id: 'SYNC_DASH', cooldownMs: 12000 });
    expect(CHARACTERS.swordsman.ability.params).toMatchObject({ distance: 220, durationMs: 350, trailMs: 1500, trailTickMs: 250, trailDamageMult: 0.5 });
  });

  it('getCharacterAbility falls back to vibecoder for unknown ids', () => {
    expect(getCharacterAbility('nope').id).toBe('HOT_RELOAD');
    expect(getCharacterAbility(undefined).id).toBe('HOT_RELOAD');
    expect(getCharacterAbility('swordsman').id).toBe('SYNC_DASH');
  });

  it('locales define name/desc for every ability in en and es', () => {
    for (const c of Object.values(CHARACTERS)) {
      for (const loc of [abilitiesEn, abilitiesEs]) {
        const [, id, field] = c.ability.name_key.split('.');
        expect(typeof loc.abilities[id][field]).toBe('string');
        expect(typeof loc.abilities[id].desc).toBe('string');
        expect(loc.abilities[id].desc.length).toBeGreaterThan(10);
      }
    }
    expect(typeof abilitiesEn.abilities.ready).toBe('string');
    expect(typeof abilitiesEs.abilities.ready).toBe('string');
  });
});

describe('ability state / cooldown', () => {
  it('starts ready and goes on cooldown after activation', () => {
    const s0 = createAbilityState('vibecoder');
    expect(s0.abilityId).toBe('HOT_RELOAD');
    expect(canActivate(s0, 0)).toBe(true);
    expect(cooldownPct(s0, 0)).toBe(1);
    const s1 = activate(s0, 1000);
    expect(s1).not.toBe(s0);
    expect(s1.uses).toBe(1);
    expect(canActivate(s1, 1000)).toBe(false);
    expect(cooldownPct(s1, 1000)).toBe(0);
    expect(cooldownRemaining(s1, 1000)).toBe(25000);
    expect(cooldownPct(s1, 1000 + 12500)).toBeCloseTo(0.5);
    expect(canActivate(s1, 26000 - 1)).toBe(false);
    expect(canActivate(s1, 26000)).toBe(true);
  });

  it('activate on cooldown returns the same state unchanged', () => {
    const s1 = activate(createAbilityState('destroyer'), 0);
    const s2 = activate(s1, 5000);
    expect(s2).toBe(s1);
    expect(s2.uses).toBe(1);
  });

  it('tracks an active window (i-frames / dash)', () => {
    const s = activate(createAbilityState('swordsman'), 100);
    expect(isActive(s, 100)).toBe(true);
    expect(isActive(s, 449)).toBe(true);
    expect(isActive(s, 450)).toBe(false);
    const v = activate(createAbilityState('vibecoder'), 0);
    expect(isActive(v, 1999)).toBe(true);
    expect(isActive(v, 2000)).toBe(false);
    const d = activate(createAbilityState('destroyer'), 0);
    expect(isActive(d, 0)).toBe(false);
  });

  it('unknown character falls back to vibecoder', () => {
    expect(createAbilityState('ghost').characterId).toBe('vibecoder');
  });

  it('tolerates non-monotonic now: a backwards clock keeps the remaining cooldown', () => {
    let s = activate(createAbilityState('swordsman'), 50000); // ready at 62000
    s = tick(s, 55000); // 7000 remaining
    s = tick(s, 100); // clock reset (scene restart)
    expect(cooldownRemaining(s, 100)).toBe(7000);
    expect(canActivate(s, 7099)).toBe(false);
    expect(canActivate(s, 7100)).toBe(true);
  });

  it('remaining cooldown never exceeds cooldownMs even without tick on a backwards jump', () => {
    const s = activate(createAbilityState('swordsman'), 50000);
    expect(cooldownRemaining(s, 0)).toBe(12000);
    expect(cooldownPct(s, 0)).toBe(0);
  });

  it('never yields NaN with garbage input (seeded fuzz)', () => {
    const rng = seeded(1337);
    const garbage = [NaN, Infinity, -Infinity, undefined, null, 'x', {}, -5];
    for (let i = 0; i < 300; i++) {
      const id = ['vibecoder', 'destroyer', 'swordsman', 'zzz'][Math.floor(rng() * 4)];
      let s = createAbilityState(id);
      for (let k = 0; k < 10; k++) {
        const now = rng() < 0.2 ? garbage[Math.floor(rng() * garbage.length)] : Math.floor(rng() * 100000);
        s = rng() < 0.5 ? tick(s, now) : activate(s, now);
        const pct = cooldownPct(s, now);
        const rem = cooldownRemaining(s, now);
        expect(isFiniteNum(pct)).toBe(true);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(1);
        expect(isFiniteNum(rem)).toBe(true);
        expect(isFiniteNum(s.readyAt)).toBe(true);
        expect(typeof canActivate(s, now)).toBe('boolean');
      }
    }
  });

  it('null state is handled', () => {
    expect(canActivate(null, 0)).toBe(false);
    expect(cooldownPct(null, 0)).toBe(0);
    expect(tick(null, 0)).toBe(null);
    expect(activate(null, 0)).toBe(null);
  });
});

describe('shouldAutoUse', () => {
  const calm = { hpPct: 1, enemiesNear200: 0, enemiesNear120: 0, nearestDist: Infinity, bossNear: false };

  it('VibeCoder heals at HP <= 45%', () => {
    expect(shouldAutoUse('vibecoder', { ...calm, hpPct: 0.46 })).toBe(false);
    expect(shouldAutoUse('vibecoder', { ...calm, hpPct: 0.45 })).toBe(true);
    expect(shouldAutoUse('vibecoder', { ...calm, hpPct: 0.1 })).toBe(true);
  });

  it('VoidNull fires with >= 6 enemies within 200px or a boss < 150px', () => {
    expect(shouldAutoUse('destroyer', { ...calm, enemiesNear200: 5 })).toBe(false);
    expect(shouldAutoUse('destroyer', { ...calm, enemiesNear200: 6 })).toBe(true);
    expect(shouldAutoUse('destroyer', { ...calm, bossNear: true })).toBe(true);
    expect(shouldAutoUse('destroyer', { ...calm, bossNear: 149 })).toBe(true);
    expect(shouldAutoUse('destroyer', { ...calm, bossNear: 150 })).toBe(false);
  });

  it('SyncStorm dashes at HP <= 60% with enemy < 90px, or >= 4 enemies < 120px', () => {
    expect(shouldAutoUse('swordsman', { ...calm, hpPct: 0.6, nearestDist: 89 })).toBe(true);
    expect(shouldAutoUse('swordsman', { ...calm, hpPct: 0.61, nearestDist: 50 })).toBe(false);
    expect(shouldAutoUse('swordsman', { ...calm, hpPct: 0.5, nearestDist: 90 })).toBe(false);
    expect(shouldAutoUse('swordsman', { ...calm, enemiesNear120: 4 })).toBe(true);
    expect(shouldAutoUse('swordsman', { ...calm, enemiesNear120: 3 })).toBe(false);
  });

  it('returns false for invalid snapshots or unknown characters', () => {
    expect(shouldAutoUse('vibecoder', null)).toBe(false);
    expect(shouldAutoUse('vibecoder', { hpPct: NaN })).toBe(false);
    expect(shouldAutoUse('destroyer', { enemiesNear200: NaN })).toBe(false);
    expect(shouldAutoUse('nobody', { ...calm, hpPct: 0 })).toBe(false);
  });
});

describe('buildSnapshot', () => {
  it('counts enemies by radius, nearest and boss distance', () => {
    const snap = buildSnapshot({
      player: { x: 0, y: 0 }, hp: 30, maxHp: 120,
      enemies: [
        { x: 100, y: 0 }, { x: 0, y: 150 }, { x: 300, y: 0 },
        { x: 50, y: 0, active: false }, { x: NaN, y: 0 },
        { x: 0, y: -140, isBoss: true }
      ]
    });
    expect(snap.hpPct).toBeCloseTo(0.25);
    expect(snap.enemiesNear120).toBe(1);
    expect(snap.enemiesNear200).toBe(3);
    expect(snap.nearestDist).toBe(100);
    expect(snap.bossNear).toBe(140);
    expect(snap.nearest).toEqual({ x: 100, y: 0 });
  });

  it('is safe with no player / no enemies / bad hp', () => {
    const s = buildSnapshot({ player: null, hp: NaN, maxHp: 0, enemies: null });
    expect(s.hpPct).toBe(1);
    expect(s.enemiesNear200).toBe(0);
    expect(s.nearestDist).toBe(Infinity);
    expect(s.bossNear).toBe(Infinity);
    expect(s.nearest).toBe(null);
  });
});

describe('geometry helpers', () => {
  it('contactLockTimestamp keeps contact damage blocked until `until`', () => {
    const W = 600;
    // far from the end: lock at now (blocks the next W ms, refreshed each frame)
    expect(contactLockTimestamp(1000, 3000, W)).toBe(1000);
    // inside the last W ms: lock so it expires exactly at `until`
    expect(contactLockTimestamp(2700, 3000, W)).toBe(2400);
    // never in the future (damageRules treats future as clock reset)
    expect(contactLockTimestamp(1000, 1200, W)).toBeLessThanOrEqual(1000);
    expect(contactLockTimestamp(NaN, 1, W)).toBe(null);
  });

  it('knockbackVector pushes away from the player with fixed length', () => {
    const v = knockbackVector(0, 0, 3, 4, 150);
    expect(v.dx).toBeCloseTo(90);
    expect(v.dy).toBeCloseTo(120);
    const same = knockbackVector(5, 5, 5, 5, 150);
    expect(Math.hypot(same.dx, same.dy)).toBeCloseTo(150);
    expect(knockbackVector(NaN, 0, 1, 1, 150)).toEqual({ dx: 0, dy: 0 });
  });

  it('dashDirection uses velocity, else away from nearest enemy, else facing', () => {
    expect(dashDirection({ vx: 0, vy: -200 }, { x: 0, y: 0 }, null, 1)).toEqual({ dx: 0, dy: -1 });
    const away = dashDirection({ vx: 0, vy: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    expect(away.dx).toBeCloseTo(-1);
    expect(away.dy).toBeCloseTo(0);
    expect(dashDirection({ vx: 0, vy: 0 }, { x: 0, y: 0 }, null, -1)).toEqual({ dx: -1, dy: 0 });
    expect(dashDirection(null, null, null, undefined)).toEqual({ dx: 1, dy: 0 });
  });

  it('dashEndpoint clamps to bounds', () => {
    expect(dashEndpoint({ x: 100, y: 100 }, { dx: 1, dy: 0 }, 220)).toEqual({ x: 320, y: 100 });
    expect(dashEndpoint({ x: 100, y: 100 }, { dx: -1, dy: 0 }, 220, { x: 0, y: 0, width: 1000, height: 1000 }, 16))
      .toEqual({ x: 16, y: 100 });
  });

  it('distanceToSegment', () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    expect(distanceToSegment(-4, 3, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(distanceToSegment(2, 0, 0, 0, 0, 0)).toBeCloseTo(2);
    expect(distanceToSegment(NaN, 0, 0, 0, 1, 0)).toBe(Infinity);
  });

  it('abilityDamage floors, applies boss mult and never NaN', () => {
    expect(abilityDamage(20, 4, false)).toBe(80);
    expect(abilityDamage(20, 4, true, 2)).toBe(40);
    expect(abilityDamage(25, 0.5)).toBe(12);
    expect(abilityDamage(NaN, 4)).toBe(1);
    expect(abilityDamage(0.1, 0.5)).toBe(1);
  });

  it('enemiesInRadius filters active, finite, within radius', () => {
    const list = [{ x: 10, y: 0 }, { x: 300, y: 0 }, { x: 5, y: 5, active: false }, null, { x: NaN, y: 1 }];
    expect(enemiesInRadius(list, 0, 0, 260)).toEqual([{ x: 10, y: 0 }]);
    expect(enemiesInRadius(null, 0, 0, 260)).toEqual([]);
  });
});
