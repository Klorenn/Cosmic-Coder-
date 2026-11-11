import { describe, it, expect } from 'vitest';
import { abbrevAddress, leaderboardName, medalTier, prepareLeaderboard, nudgeUnit, PIXEL_ICONS } from '../scenes/title/overlayModel.js';
import titleEn from '../locales/title.en.js';
import titleEs from '../locales/title.es.js';

const G1 = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ';
const G2 = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1234';

describe('abbrevAddress', () => {
  it('keeps the first char and the last four', () => {
    expect(abbrevAddress(G1)).toBe('G…WXYZ');
  });
  it('handles empty and short values', () => {
    expect(abbrevAddress('')).toBe('???');
    expect(abbrevAddress(null)).toBe('???');
    expect(abbrevAddress('GABC')).toBe('GABC');
  });
});

describe('leaderboardName', () => {
  it('uses the player name when it is a real name', () => {
    expect(leaderboardName('kL0REN', G1)).toBe('kL0REN');
  });
  it('falls back to the abbreviated wallet for empty or address-like names', () => {
    expect(leaderboardName('', G1)).toBe('G…WXYZ');
    expect(leaderboardName('GAAAAA...WXYZ', G1)).toBe('G…WXYZ');
    expect(leaderboardName(G2, G2)).toBe('G…1234');
    expect(leaderboardName('', '')).toBe('???');
  });
  it('caps names at 20 chars', () => {
    expect(leaderboardName('x'.repeat(40), G1)).toHaveLength(20);
  });
});

describe('medalTier', () => {
  it('maps the podium only', () => {
    expect([1, 2, 3, 4, 0, '2'].map(medalTier)).toEqual(['gold', 'silver', 'bronze', null, null, 'silver']);
  });
});

describe('prepareLeaderboard', () => {
  it('keeps the best run per wallet, drops zero scores and walletless rows, sorts and renumbers', () => {
    const rows = prepareLeaderboard([
      { wallet: G1, name: 'a', bestScore: 100, bestWave: 3 },
      { wallet: G1.toLowerCase(), name: 'a2', bestScore: 300, bestWave: 5 },
      { wallet: G2, name: 'b', score: 300, wave: 7 },
      { wallet: 'GZERO', name: 'z', bestScore: 0 },
      { wallet: '', name: 'local', bestScore: 999 },
      null, 'junk'
    ]);
    expect(rows.map((r) => r.name)).toEqual(['b', 'a2']);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(rows[0].bestScore).toBe(300);
    expect(rows[0].bestWave).toBe(7);
  });
  it('survives garbage input', () => {
    expect(prepareLeaderboard(undefined)).toEqual([]);
  });
});

describe('nudgeUnit', () => {
  it('steps, clamps and snaps to 5 %', () => {
    expect(nudgeUnit(0.5, 0.05)).toBe(0.55);
    expect(nudgeUnit(0.98, 0.05)).toBe(1);
    expect(nudgeUnit(0.02, -0.05)).toBe(0);
    expect(nudgeUnit(NaN, 0.05)).toBe(0.05);
  });
});

describe('overlay B assets', () => {
  it('new pixel icons are 9x9', () => {
    ['note', 'speaker', 'globe', 'expand', 'user', 'gamepad', 'gear', 'branch'].forEach((n) => {
      expect(PIXEL_ICONS[n], n).toHaveLength(9);
      PIXEL_ICONS[n].forEach((r) => expect(r).toHaveLength(9));
    });
  });
  it('en and es title locales define the same keys', () => {
    expect(Object.keys(titleEs.title).sort()).toEqual(Object.keys(titleEn.title).sort());
  });
});
