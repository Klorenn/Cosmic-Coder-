import { describe, it, expect } from 'vitest';
import { applyXPGain, spendXP, canSpendXP, getRunScore } from '../systems/scoreRules.js';

describe('scoreRules (score vs spendable XP)', () => {
  it('gaining XP raises both the spendable pool and the score', () => {
    const s = { totalXP: 0, score: 0 };
    applyXPGain(s, 120);
    expect(s.totalXP).toBe(120);
    expect(s.score).toBe(120);
  });

  it('spending XP lowers the pool but never the score', () => {
    const s = { totalXP: 600, score: 600 };
    expect(spendXP(s, 500)).toBe(true);
    expect(s.totalXP).toBe(100);
    expect(s.score).toBe(600);
    applyXPGain(s, 50);
    expect(s.totalXP).toBe(150);
    expect(s.score).toBe(650);
  });

  it('refuses to spend more than the pool', () => {
    const s = { totalXP: 499, score: 900 };
    expect(canSpendXP(s, 500)).toBe(false);
    expect(spendXP(s, 500)).toBe(false);
    expect(s.totalXP).toBe(499);
  });

  it('rejects bad amounts', () => {
    const s = { totalXP: 100, score: 100 };
    for (const bad of [-1, NaN, Infinity, '10', null]) {
      expect(canSpendXP(s, bad)).toBe(false);
      applyXPGain(s, bad);
    }
    expect(s).toEqual({ totalXP: 100, score: 100 });
  });

  it('initializes a missing score from totalXP (old saves)', () => {
    const s = { totalXP: 300 };
    applyXPGain(s, 10);
    expect(s.score).toBe(310);
    expect(getRunScore({ totalXP: 42 })).toBe(42);
  });

  it('run score is a non-negative integer', () => {
    expect(getRunScore({ score: 12.9, totalXP: 0 })).toBe(12);
    expect(getRunScore({ score: NaN })).toBe(0);
    expect(getRunScore(null)).toBe(0);
  });
});
