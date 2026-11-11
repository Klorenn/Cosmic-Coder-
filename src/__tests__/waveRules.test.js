import { describe, it, expect } from 'vitest';
import { WAVE_DURATION_MS, waveForTime, waveStartMs, waveStatScale } from '../systems/waveRules.js';

describe('waveRules (time-driven waves, Vampire Survivors style)', () => {
  it('a wave lasts 45-60 s', () => {
    expect(WAVE_DURATION_MS).toBeGreaterThanOrEqual(45000);
    expect(WAVE_DURATION_MS).toBeLessThanOrEqual(60000);
  });

  it('waveForTime maps the run clock to a 1-based wave', () => {
    expect(waveForTime(0)).toBe(1);
    expect(waveForTime(WAVE_DURATION_MS - 1)).toBe(1);
    expect(waveForTime(WAVE_DURATION_MS)).toBe(2);
    expect(waveForTime(10 * WAVE_DURATION_MS + 5)).toBe(11);
    expect(waveStartMs(11)).toBe(10 * WAVE_DURATION_MS);
  });

  it('garbage times fall back to wave 1', () => {
    for (const v of [NaN, -1, undefined, null, 'x', -Infinity]) expect(waveForTime(v)).toBe(1);
  });

  it('stats scale gently: +8% hp and +4% damage per wave', () => {
    const s1 = waveStatScale(1);
    expect(s1.health).toBe(1);
    expect(s1.damage).toBe(1);
    expect(waveStatScale(11).health).toBeCloseTo(1.8, 6);
    expect(waveStatScale(11).damage).toBeCloseTo(1.4, 6);
    for (let w = 1; w < 50; w++) {
      expect(waveStatScale(w + 1).health).toBeGreaterThanOrEqual(waveStatScale(w).health);
      expect(waveStatScale(w + 1).speed).toBeGreaterThanOrEqual(waveStatScale(w).speed);
    }
    const g = waveStatScale(NaN);
    expect(g).toEqual(waveStatScale(1));
  });
});
