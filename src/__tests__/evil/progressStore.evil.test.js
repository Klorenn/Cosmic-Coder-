import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installLocalStorage, CORRUPT_JSON, isFiniteNumber } from './_hostile.js';

const { store } = installLocalStorage();
vi.mock('@stellar/freighter-api', () => ({ default: {} }));
const { progressStore, hydrateProgressFromLocal } = await import('../../utils/walletProgressService.js');

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  progressStore.highWave = 0;
  progressStore.highScore = 0;
});

describe('EVIL progressStore local hydration (cosmicCoderProgressLocal)', () => {
  it.each([
    ...CORRUPT_JSON,
    '{"highWave":1e400,"highScore":1e400}',
    '{"highWave":-5,"highScore":-1}',
    '{"highWave":2.7,"highScore":"999"}'
  ])('high wave/score stay finite, integer and >= 0 for %s', (raw) => {
    store.cosmicCoderProgressLocal = raw;
    expect(() => hydrateProgressFromLocal()).not.toThrow();
    for (const k of ['highWave', 'highScore']) {
      expect(isFiniteNumber(progressStore[k])).toBe(true);
      expect(Number.isInteger(progressStore[k])).toBe(true);
      expect(progressStore[k]).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps an honest record', () => {
    store.cosmicCoderProgressLocal = '{"highWave":12,"highScore":340}';
    hydrateProgressFromLocal();
    expect(progressStore.highWave).toBe(12);
    expect(progressStore.highScore).toBe(340);
  });
});
