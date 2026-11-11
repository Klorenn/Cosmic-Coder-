import { describe, it, expect } from 'vitest';
import {
  createStatus, applyOnHit, tickStatus, speedMultiplier, damageTakenMult, dominantStatus,
  critFor, hitReady, chainDamage, canSplit, spiralAngles, fanAngles, pickTarget,
  inArc, onLine, STATUS_TINTS, isCcImmune
} from '../systems/weaponEffects.js';
import { WEAPONS, EVOLUTION_RECIPES, getWeaponDef } from '../data/weapons.js';

const rng0 = () => 0; // always procs / crits
const rng1 = () => 0.999; // never procs / crits
const hit = (o = {}) => ({ damage: 100, critChance: 0.1, rng: rng1, hpBefore: 1000, maxHp: 1000, ...o });

describe('weaponEffects — crit', () => {
  it('basic gets +10% crit over the base chance', () => {
    expect(critFor(getWeaponDef('basic'), 0.1).chance).toBeCloseTo(0.2);
  });
  it('sudo always crits for x2.5', () => {
    const c = critFor(getWeaponDef('sudo'), 0.1);
    expect(c.chance).toBe(1);
    expect(c.mult).toBe(2.5);
    const r = applyOnHit(getWeaponDef('sudo'), createStatus(), hit());
    expect(r.isCrit).toBe(true);
    expect(r.damage).toBe(250);
  });
  it('default crit multiplier is x2', () => {
    const r = applyOnHit(getWeaponDef('spread'), createStatus(), hit({ rng: rng0 }));
    expect(r.isCrit).toBe(true);
    expect(r.damage).toBe(200);
  });
});

describe('weaponEffects — on-hit statuses', () => {
  it('freeze slows 50% for 2 s and 3 stacks freeze for 1 s', () => {
    const w = getWeaponDef('freeze');
    let s = createStatus();
    s = applyOnHit(w, s, hit()).state;
    expect(speedMultiplier(s)).toBeCloseTo(0.5);
    expect(s.slowMs).toBe(2000);
    s = applyOnHit(w, s, hit()).state;
    const third = applyOnHit(w, s, hit());
    expect(third.applied).toContain('freeze');
    expect(speedMultiplier(third.state)).toBe(0);
    expect(third.state.frozenMs).toBe(1000);
    expect(third.state.freezeStacks).toBe(0);
  });
  it('bosses and mini-bosses never freeze or slow', () => {
    const w = getWeaponDef('freeze');
    let s = createStatus();
    for (let i = 0; i < 5; i++) s = applyOnHit(w, s, hit({ isBoss: true })).state;
    expect(speedMultiplier(s, true)).toBe(1);
    expect(isCcImmune({ isBoss: true })).toBe(true);
    expect(isCcImmune({ isMiniBoss: true })).toBe(true);
    expect(isCcImmune({})).toBe(false);
  });
  it('ring of fire burns for 4 s and the DoT ticks with integer damage', () => {
    const r = applyOnHit(getWeaponDef('ringoffire'), createStatus(), hit());
    expect(r.state.burnMs).toBe(4000);
    expect(r.state.burnDps).toBeGreaterThan(0);
    let s = r.state;
    let total = 0;
    for (let i = 0; i < 40; i++) { const t = tickStatus(s, 100); s = t.state; total += t.damage; }
    expect(Number.isInteger(total)).toBe(true);
    expect(total).toBeGreaterThanOrEqual(Math.floor(r.state.burnDps * 4) - 1);
    expect(s.burnMs).toBe(0);
    expect(tickStatus(s, 100).damage).toBe(0);
  });
  it('kunai applies a 3 s bleed', () => {
    const r = applyOnHit(getWeaponDef('kunai'), createStatus(), hit());
    expect(r.state.bleedMs).toBe(3000);
    expect(dominantStatus(r.state)).toBe('bleeding');
  });
  it('rapid marks on a 20% roll: +20% damage taken for 3 s', () => {
    const w = getWeaponDef('rapid');
    const miss = applyOnHit(w, createStatus(), hit({ rng: () => 0.5 }));
    expect(miss.state.markMs).toBe(0);
    const marked = applyOnHit(w, createStatus(), hit({ rng: () => 0.15 }));
    expect(marked.state.markMs).toBe(3000);
    expect(damageTakenMult(marked.state)).toBeCloseTo(1.2);
    const next = applyOnHit(getWeaponDef('basic'), marked.state, hit());
    expect(next.damage).toBe(120);
  });
  it('rm -rf executes below 20% HP (bosses below 8%)', () => {
    const w = getWeaponDef('rmrf');
    const exec = applyOnHit(w, createStatus(), hit({ damage: 10, hpBefore: 200, maxHp: 1000 }));
    expect(exec.executed).toBe(true);
    expect(exec.damage).toBeGreaterThanOrEqual(200);
    const bossNo = applyOnHit(w, createStatus(), hit({ damage: 10, hpBefore: 150, maxHp: 1000, isBoss: true }));
    expect(bossNo.executed).toBe(false);
    const bossYes = applyOnHit(w, createStatus(), hit({ damage: 10, hpBefore: 85, maxHp: 1000, isBoss: true }));
    expect(bossYes.executed).toBe(true);
  });
  it('pierce ramps +15% per enemy already pierced; bounce +10% per bounce', () => {
    expect(applyOnHit(getWeaponDef('pierce'), createStatus(), hit({ pierceIndex: 2 })).damage).toBe(130);
    expect(applyOnHit(getWeaponDef('bounce'), createStatus(), hit({ bounceIndex: 3 })).damage).toBe(130);
  });
  it('status ticks down and clears', () => {
    let s = applyOnHit(getWeaponDef('freeze'), createStatus(), hit()).state;
    s = tickStatus(s, 2500).state;
    expect(speedMultiplier(s)).toBe(1);
    expect(dominantStatus(s)).toBe(null);
  });
  it('applyOnHit is pure (does not mutate the input state)', () => {
    const s = createStatus();
    applyOnHit(getWeaponDef('freeze'), s, hit());
    expect(s).toEqual(createStatus());
  });
  it('status tints: blue frozen, orange burning, red bleeding, white marked', () => {
    expect(STATUS_TINTS.frozen).toBe(0x60a5fa);
    expect(STATUS_TINTS.burning).toBe(0xf97316);
    expect(STATUS_TINTS.bleeding).toBe(0xdc2626);
    expect(STATUS_TINTS.marked).toBe(0xffffff);
  });
});

describe('weaponEffects — helpers', () => {
  it('hitReady respects the cooldown', () => {
    expect(hitReady(undefined, 0, 200)).toBe(true);
    expect(hitReady(100, 250, 200)).toBe(false);
    expect(hitReady(100, 300, 200)).toBe(true);
  });
  it('chain lightning loses 15% per jump', () => {
    expect(chainDamage(100, 0, 0.15)).toBe(100);
    expect(chainDamage(100, 2, 0.15)).toBe(72);
  });
  it('forkbomb splits for 2 generations max', () => {
    const w = getWeaponDef('forkbomb');
    expect(canSplit(w, 0)).toBe(true);
    expect(canSplit(w, 1)).toBe(true);
    expect(canSplit(w, 2)).toBe(false);
    expect(canSplit(getWeaponDef('basic'), 0)).toBe(false);
  });
  it('spiral angles cover the full circle and rotate per volley', () => {
    const a = spiralAngles(8, 0, 0.35);
    expect(a).toHaveLength(8);
    expect(a[1] - a[0]).toBeCloseTo(Math.PI / 4);
    expect(spiralAngles(8, 1, 0.35)[0]).toBeCloseTo(0.35);
  });
  it('fan angles are centred on the aim', () => {
    const a = fanAngles(1, 5, 0.2);
    expect(a[2]).toBeCloseTo(1);
    expect(a[0]).toBeCloseTo(0.6);
    expect(fanAngles(1, 1, 0.2)).toEqual([1]);
  });
  it('homing prefers elites/bosses in range, else nearest', () => {
    const c = [{ id: 'a', dist: 50 }, { id: 'b', dist: 200, elite: true }, { id: 'c', dist: 400, elite: true }];
    expect(pickTarget(c, { preferElite: true, range: 300 }).id).toBe('b');
    expect(pickTarget(c, { preferElite: false, range: 300 }).id).toBe('a');
    expect(pickTarget([], { preferElite: true })).toBe(null);
  });
  it('arc and line hit tests', () => {
    expect(inArc(0, 0, 0, 160, 100, 50, 10)).toBe(true);
    expect(inArc(0, 0, 0, 160, 100, -50, 0)).toBe(false);
    expect(inArc(0, 0, 0, 360, 100, -50, 0)).toBe(true);
    expect(inArc(0, 0, 0, 160, 100, 150, 0)).toBe(false);
    expect(onLine(0, 0, 0, 300, 20, 250, 10)).toBe(true);
    expect(onLine(0, 0, 0, 300, 20, 250, 40)).toBe(false);
    expect(onLine(0, 0, 0, 300, 20, -20, 0)).toBe(false);
  });
});

describe('weapon powers — every weapon has a distinct power', () => {
  const all = { ...WEAPONS, ...Object.fromEntries(Object.values(EVOLUTION_RECIPES).map((r) => [r.result, r])) };
  it('every base and evolved weapon declares a power with a description', () => {
    for (const [id, w] of Object.entries(all)) {
      expect(w.power, id).toBeTruthy();
      expect(typeof w.power.desc, id).toBe('string');
    }
  });
  it('no two weapons share an identical power signature', () => {
    const sigs = Object.entries(all).map(([, w]) => JSON.stringify({ ...w.power, desc: undefined }));
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});
