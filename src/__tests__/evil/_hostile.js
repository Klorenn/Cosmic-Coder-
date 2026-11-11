/**
 * Shared hostile-input helpers for the Evil Player Vitest suite.
 * Not a test file (no .test.js suffix) so Vitest does not collect it.
 */
import { vi } from 'vitest';

/** Deterministic PRNG (mulberry32). Same seed -> same sequence -> reproducible fuzz. */
export function seededRng(seed = 0xC0FFEE) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scalar garbage every public entry point should survive. */
export const HOSTILE_NUMBERS = [NaN, -1, -Infinity, Infinity, 0, -0, 1e12, -1e12, 1e308, Number.MAX_SAFE_INTEGER, 0.5, -0.0001];
export const HOSTILE_VALUES = [
  ...HOSTILE_NUMBERS,
  '', 'abc', '10', '1e3', 'NaN', null, undefined, true, false,
  {}, [], [1, 2], { valueOf: () => 42 }, Symbol.for('evil'), () => 1
];

/** Corrupted JSON payloads to drop into localStorage. */
export const CORRUPT_JSON = [
  '{', '}{', 'undefined', 'NaN', 'null', '0', '-1', '"string"', '[]', '[null]', '{}', 'true',
  '{"__proto__":{"polluted":1}}', '{"rebirthLevel":"abc"}', '1e400', '{"a":1e400}'
];

/** Pick a random hostile value with the given rng. */
export function pick(rng, list = HOSTILE_VALUES) {
  return list[Math.floor(rng() * list.length)];
}

/** True when n is a finite number (rejects NaN, ±Infinity and non-numbers). */
export function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/** In-memory localStorage installed on globalThis; returns the backing store for direct poisoning. */
export function installLocalStorage() {
  const store = {};
  const mock = {
    getItem: vi.fn((k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null)),
    setItem: vi.fn((k, v) => { store[k] = String(v); }),
    removeItem: vi.fn((k) => { delete store[k]; }),
    clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); })
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true, writable: true });
  return { store, mock };
}

/** Number of property-style iterations per fuzz loop. */
export const FUZZ_ITERATIONS = 400;
