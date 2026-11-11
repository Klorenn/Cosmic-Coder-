import { describe, it, expect } from 'vitest';
import {
  expectedDps, dpsProfile, SCENARIO_IDS, SCENARIOS, median, efficiency, inRadius, nicheIndex,
  baseMedians, WEAPON_TIERS, balanceTable
} from '../systems/weaponBalance.js';
import { WEAPONS, EVOLUTION_RECIPES } from '../data/weapons.js';

const meds = baseMedians(WEAPONS);

describe('weaponBalance — model', () => {
  it('has the four scenarios', () => {
    expect(SCENARIO_IDS).toEqual(['single', 'pack5', 'horde20', 'boss']);
  });
  it('DPS scales linearly with damage and attack rate', () => {
    const w = { ...WEAPONS.basic };
    const d1 = expectedDps(w, 'single');
    expect(expectedDps({ ...w, damage: w.damage * 2 }, 'single')).toBeCloseTo(d1 * 2);
    expect(expectedDps({ ...w, attackRate: w.attackRate * 2 }, 'single')).toBeCloseTo(d1 * 2);
  });
  it('multi-hit has diminishing returns', () => {
    expect(efficiency(1)).toBe(1);
    expect(efficiency(10)).toBeLessThan(10);
    expect(efficiency(10)).toBeGreaterThan(5);
  });
  it('AoE hits more enemies in a horde than alone', () => {
    expect(inRadius(100, SCENARIOS.single)).toBe(1);
    expect(inRadius(100, SCENARIOS.horde20)).toBeGreaterThan(2);
  });
  it('execute boosts DPS; crit-guaranteed sudo beats its non-crit self', () => {
    const rm = WEAPONS.rmrf;
    const noExec = { ...rm, power: { ...rm.power, execute: undefined } };
    expect(expectedDps(rm, 'single')).toBeGreaterThan(expectedDps(noExec, 'single'));
    const su = WEAPONS.sudo;
    expect(expectedDps(su, 'boss')).toBeGreaterThan(expectedDps({ ...su, power: {} }, 'boss'));
  });
  it('a single-target weapon is flat across scenarios; AoE peaks in crowds', () => {
    const b = dpsProfile(WEAPONS.basic);
    expect(b.single).toBeCloseTo(b.horde20);
    const a = dpsProfile(WEAPONS.aoe);
    expect(a.pack5).toBeGreaterThan(a.single * 2);
  });
  it('produces a table row per weapon', () => {
    const rows = balanceTable(WEAPONS);
    expect(rows).toHaveLength(Object.keys(WEAPONS).length);
    expect(rows[0]).toHaveProperty('bestScenario');
  });
});

describe('weaponBalance — every weapon is useful', () => {
  it('tiers cover every base weapon exactly once', () => {
    const ids = Object.values(WEAPON_TIERS).flat().sort();
    expect(ids).toEqual(Object.keys(WEAPONS).sort());
  });

  for (const [tier, ids] of Object.entries(WEAPON_TIERS)) {
    it(`${tier}: each base weapon's niche DPS is 0.8x-1.3x of its tier`, () => {
      const idx = Object.fromEntries(ids.map((id) => [id, nicheIndex(WEAPONS[id], meds)]));
      const top = Math.max(...Object.values(idx));
      const mid = median(Object.values(idx));
      for (const [id, v] of Object.entries(idx)) {
        expect(v, `${id} ${v.toFixed(2)} vs top ${top.toFixed(2)}`).toBeGreaterThanOrEqual(0.8 * top);
        expect(v, `${id} ${v.toFixed(2)} vs median ${mid.toFixed(2)}`).toBeLessThanOrEqual(1.3 * mid);
      }
    });
  }

  it('each evolution is 1.6x-2.4x its best component', () => {
    for (const [combo, evo] of Object.entries(EVOLUTION_RECIPES)) {
      const [a, b] = combo.split('+');
      const comp = Math.max(nicheIndex(WEAPONS[a], meds), nicheIndex(WEAPONS[b], meds));
      const ratio = nicheIndex(evo, meds) / comp;
      expect(ratio, `${evo.result} ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(1.6);
      expect(ratio, `${evo.result} ${ratio.toFixed(2)}`).toBeLessThanOrEqual(2.4);
    }
  });

  it('no weapon is below 0.6x the base median in EVERY scenario', () => {
    const all = { ...WEAPONS, ...Object.fromEntries(Object.values(EVOLUTION_RECIPES).map((r) => [r.result, r])) };
    for (const [id, w] of Object.entries(all)) {
      const p = dpsProfile(w);
      const useful = SCENARIO_IDS.some((s) => p[s] >= 0.6 * meds[s]);
      expect(useful, id).toBe(true);
    }
  });

  it('no base weapon is strictly dominated by a same-tier weapon in all scenarios', () => {
    const prof = Object.fromEntries(Object.entries(WEAPONS).map(([id, w]) => [id, dpsProfile(w)]));
    const tierOf = Object.fromEntries(Object.entries(WEAPON_TIERS).flatMap(([t, ids]) => ids.map((id) => [id, t])));
    for (const [a, pa] of Object.entries(prof)) {
      for (const [b, pb] of Object.entries(prof)) {
        if (a === b || tierOf[a] !== tierOf[b]) continue;
        const dominated = SCENARIO_IDS.every((s) => pb[s] >= pa[s] * 1.15);
        expect(dominated, `${a} dominated by ${b}`).toBe(false);
      }
    }
  });
});
