import { describe, it, expect } from 'vitest';
import { validateGameRules, MIN_SCORE_PER_WAVE } from '../../zk/gameProof.js';
import { seededRng, pick, HOSTILE_VALUES, FUZZ_ITERATIONS } from './_hostile.js';

describe('EVIL zk/gameProof.validateGameRules', () => {
  it('accepts honest runs', () => {
    expect(validateGameRules(1, 5).valid).toBe(true);
    expect(validateGameRules(10, 50).valid).toBe(true);
    expect(validateGameRules(10000, 1e12).valid).toBe(true);
  });

  it.each([
    ['score < wave*5', 10, 49],
    ['wave 0', 0, 100],
    ['negative wave', -3, 100],
    ['negative score', 1, -1],
    ['score overflow', 1, 1e12 + 1],
    ['score Infinity', 1, Infinity],
    ['wave overflow', 10001, 1e9],
    ['NaN wave', NaN, 100],
    ['NaN score', 5, NaN],
    ['both NaN', NaN, NaN],
    ['fractional wave', 1.5, 100],
    ['fractional score', 2, 10.5],
    ['string wave', '5', 100],
    ['string score', 5, '100'],
    ['null wave', null, 100],
    ['object score', 5, { valueOf: () => 100 }],
    ['array wave', [5], 100],
    ['boolean wave', true, 100],
    ['unsafe integer score', 1, 2 ** 60]
  ])('rejects %s', (_label, wave, score) => {
    const r = validateGameRules(wave, score);
    expect(r.valid).toBe(false);
    expect(typeof r.reason).toBe('string');
  });

  it('property: valid => finite integers with score >= wave*MIN_SCORE_PER_WAVE (never throws)', () => {
    const rng = seededRng(3);
    for (let i = 0; i < FUZZ_ITERATIONS * 5; i++) {
      const wave = rng() < 0.5 ? Math.floor(rng() * 12000) - 100 : pick(rng, HOSTILE_VALUES.filter((v) => typeof v !== 'symbol'));
      const score = rng() < 0.5 ? Math.floor(rng() * 1e6) - 1000 : pick(rng, HOSTILE_VALUES.filter((v) => typeof v !== 'symbol'));
      let r;
      expect(() => { r = validateGameRules(wave, score); }).not.toThrow();
      if (r.valid) {
        expect(Number.isInteger(wave) && Number.isInteger(score)).toBe(true);
        expect(wave).toBeGreaterThanOrEqual(1);
        expect(score).toBeGreaterThanOrEqual(wave * MIN_SCORE_PER_WAVE);
      }
    }
  });

  it('does not throw on Symbol input', () => {
    expect(() => validateGameRules(Symbol('w'), 5)).not.toThrow();
    expect(validateGameRules(Symbol('w'), 5).valid).toBe(false);
  });
});
