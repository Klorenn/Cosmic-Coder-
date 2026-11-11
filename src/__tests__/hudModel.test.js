import { describe, it, expect } from 'vitest';
import { buildHudModel, hpColor, formatNumber, formatSeconds, modeStyle, LOW_HP_PCT, abilityChipModel } from '../systems/hud/hudModel.js';

const ITEMS = {
  magnet: { id: 'magnet', duration: 8000, color: 0xff3366 },
  firewall: { id: 'firewall', duration: 15000, color: 0xff7700 }
};

const base = {
  hp: 70, maxHp: 140, shield: 0, xp: 120, xpNeeded: 300, level: 4,
  wave: 7, enemies: 12, score: 1234, kills: 56, hiWave: 9, mode: 'hunt',
  weapon: { type: 'spread', label: 'SPREAD', color: 0xff9900, remainingMs: Infinity, totalMs: Infinity },
  effects: [], revives: 0, boss: null
};

describe('hudModel / formatting', () => {
  it('formatNumber groups thousands and compacts millions', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(12345)).toBe('12,345');
    expect(formatNumber(2500000)).toBe('2.5M');
    expect(formatNumber(-3)).toBe('0');
    expect(formatNumber(NaN)).toBe('0');
    expect(formatNumber(12.7)).toBe('12');
  });

  it('formatSeconds rounds up and handles bad input', () => {
    expect(formatSeconds(7400)).toBe('8s');
    expect(formatSeconds(0)).toBe('0s');
    expect(formatSeconds(-50)).toBe('0s');
    expect(formatSeconds(Infinity)).toBe('');
    expect(formatSeconds(65000)).toBe('1:05');
  });

  it('hpColor is green from half up, amber at a quarter, rose when empty', () => {
    expect(hpColor(1)).toBe(0x34d399);
    expect(hpColor(0)).toBe(0xf43f5e);
    expect(hpColor(0.5)).toBe(0x34d399);
    const mid = hpColor(0.25);
    expect(mid).toBe(0xf59e0b);
    expect(hpColor(2)).toBe(0x34d399);
    expect(hpColor(NaN)).toBe(0xf43f5e);
  });

  it('modeStyle maps every autopilot mode and falls back to manual', () => {
    expect(modeStyle('hunt').key).toBe('mode_hunt');
    expect(modeStyle('evade').key).toBe('mode_evade');
    expect(modeStyle('idle').key).toBe('mode_idle');
    expect(modeStyle('collect')).toEqual({ key: 'mode_collect', color: 0xa5f3fc }); // light cyan
    expect(modeStyle('weird').key).toBe('mode_manual');
    expect(typeof modeStyle('hunt').color).toBe('number');
  });
});

describe('buildHudModel', () => {
  it('computes hp / xp percentages and labels', () => {
    const m = buildHudModel(base, ITEMS);
    expect(m.hpPct).toBe(0.5);
    expect(m.hpText).toBe('70/140');
    expect(m.hpLow).toBe(false);
    expect(m.xpPct).toBeCloseTo(0.4);
    expect(m.xpText).toBe('120/300');
    expect(m.level).toBe(4);
    expect(m.mode.key).toBe('mode_hunt');
    expect(m.scoreText).toBe('1,234');
  });

  it('clamps hostile values (NaN, negative, overflow) to safe ranges', () => {
    const m = buildHudModel({ ...base, hp: -5, maxHp: 0, xp: 999, xpNeeded: NaN }, ITEMS);
    expect(m.hpPct).toBe(0);
    expect(m.xpPct).toBeGreaterThanOrEqual(0);
    expect(m.xpPct).toBeLessThanOrEqual(1);
    expect(Number.isFinite(m.hpPct)).toBe(true);
    const empty = buildHudModel(undefined, ITEMS);
    expect(empty.hpPct).toBe(0);
    expect(empty.buffs).toEqual([]);
  });

  it('flags low hp below the threshold', () => {
    const m = buildHudModel({ ...base, hp: Math.floor(140 * LOW_HP_PCT) - 1 }, ITEMS);
    expect(m.hpLow).toBe(true);
  });

  it('shield is a fraction of max hp, capped at 1', () => {
    expect(buildHudModel({ ...base, shield: 35 }, ITEMS).shieldPct).toBeCloseTo(0.25);
    expect(buildHudModel({ ...base, shield: 999 }, ITEMS).shieldPct).toBe(1);
    expect(buildHudModel({ ...base, shield: 0 }, ITEMS).shieldPct).toBe(0);
  });

  it('turns timed item effects into buffs with remaining fraction, sorted by time left', () => {
    const m = buildHudModel({ ...base, effects: [
      { id: 'firewall', type: 'shield', remaining: 12000 },
      { id: 'magnet', type: 'magnet', remaining: 2000 },
      { id: 'ghost', type: 'damage', remaining: 1000 }
    ] }, ITEMS);
    expect(m.buffs.map((b) => b.id)).toEqual(['magnet', 'firewall']);
    expect(m.buffs[0].pct).toBeCloseTo(0.25);
    expect(m.buffs[0].timeText).toBe('2s');
    expect(m.buffs[1].pct).toBeCloseTo(0.8);
    expect(m.buffs[0].color).toBe(0xff3366);
  });

  it('exposes revive availability', () => {
    expect(buildHudModel({ ...base, revives: 1 }, ITEMS).revive).toBe(true);
    expect(buildHudModel(base, ITEMS).revive).toBe(false);
  });

  it('weapon timer only for temporary weapons', () => {
    expect(buildHudModel(base, ITEMS).weapon.timerPct).toBe(null);
    const tmp = buildHudModel({ ...base, weapon: { ...base.weapon, remainingMs: 15000, totalMs: 30000 } }, ITEMS);
    expect(tmp.weapon.timerPct).toBeCloseTo(0.5);
    expect(tmp.weapon.timeText).toBe('15s');
    expect(tmp.weapon.label).toBe('SPREAD');
  });

  it('boss bar only when a live boss is present', () => {
    expect(buildHudModel(base, ITEMS).boss).toBe(null);
    const m = buildHudModel({ ...base, boss: { name: 'NULL POINTER', hp: 250, maxHp: 1000, color: 0xff0000 } }, ITEMS);
    expect(m.boss.pct).toBeCloseTo(0.25);
    expect(m.boss.name).toBe('NULL POINTER');
    expect(buildHudModel({ ...base, boss: { name: 'x', hp: 0, maxHp: 0 } }, ITEMS).boss.pct).toBe(0);
  });
});

describe('abilityChipModel', () => {
  const base = { name: 'Hot Reload', cooldownPct: 1, remainingMs: 0, ready: true, active: false, color: 0x3dff8a, key: 'SPACE' };

  it('returns null without an ability', () => {
    expect(abilityChipModel(null)).toBeNull();
    expect(abilityChipModel(undefined)).toBeNull();
  });

  it('ready ability: full ring, key hint, blinking', () => {
    const m = abilityChipModel(base, { now: 0 });
    expect(m.ringPct).toBe(1);
    expect(m.ready).toBe(true);
    expect(m.keyText).toBe('SPACE');
    expect(m.timeText).toBe('');
    expect(m.name).toBe('Hot Reload');
    expect(m.color).toBe(0x3dff8a);
    expect(m.blink).toBe(true);
  });

  it('soft ready pulse oscillates within [0.7, 1] when ready and stays 1 otherwise', () => {
    const alphas = [0, 100, 200, 300, 400].map((now) => abilityChipModel(base, { now }).alpha);
    alphas.forEach((a) => { expect(a).toBeGreaterThanOrEqual(0.7); expect(a).toBeLessThanOrEqual(1); });
    expect(new Set(alphas).size).toBeGreaterThan(1);
    expect(abilityChipModel({ ...base, ready: false, cooldownPct: 0.5, remainingMs: 4200 }, { now: 123 }).alpha).toBe(1);
  });

  it('cooling down: ring follows cooldownPct and shows whole seconds left', () => {
    const m = abilityChipModel({ ...base, ready: false, cooldownPct: 0.25, remainingMs: 4200 });
    expect(m.ringPct).toBe(0.25);
    expect(m.timeText).toBe('5s');
    expect(m.blink).toBe(false);
  });

  it('clamps garbage input', () => {
    const m = abilityChipModel({ name: 7, cooldownPct: NaN, remainingMs: -5, ready: false, color: 'x' });
    expect(m.ringPct).toBe(0);
    expect(m.name).toBe('7');
    expect(m.color).toBe(0x22d3ee);
    expect(m.keyText).toBe('SPACE');
    expect(m.timeText).toBe('0s');
    expect(abilityChipModel({ ...base, cooldownPct: 3 }).ringPct).toBe(1);
  });

  it('active ability is flagged and not blinking', () => {
    const m = abilityChipModel({ ...base, ready: false, active: true, cooldownPct: 0 });
    expect(m.active).toBe(true);
    expect(m.blink).toBe(false);
  });
});
