import { describe, it, expect } from 'vitest';
import { zkStatusLabel, formatVersion, shortWallet } from '../scenes/title/titleStatus.js';
import titleEn from '../locales/title.en.js';
import titleEs from '../locales/title.es.js';

describe('zkStatusLabel (honest ranked labelling)', () => {
  it('says RANKED: UNVERIFIED (warn) whenever isRankedVerified() is false, whatever the prover state', () => {
    for (const st of [null, { configured: false }, { configured: true, proverHealthy: true }, { configured: true, proverHealthy: false }]) {
      expect(zkStatusLabel(st, false)).toEqual({ text: 'RANKED: UNVERIFIED', tone: 'warn' });
    }
  });
  it('keeps the original ZK labels once ranked runs are verified', () => {
    expect(zkStatusLabel(null, true)).toEqual({ text: 'ZK: ...', tone: 'muted' });
    expect(zkStatusLabel({ configured: false }, true)).toEqual({ text: 'ZK: OFF', tone: 'muted' });
    expect(zkStatusLabel({ configured: true, proverHealthy: true }, true)).toEqual({ text: 'ZK: READY', tone: 'ok' });
    expect(zkStatusLabel({ configured: true, proverHealthy: false }, true)).toEqual({ text: 'ZK: SLEEPING', tone: 'warn' });
  });
});

describe('formatVersion / shortWallet', () => {
  it('formats the version', () => {
    expect(formatVersion('0.7.6')).toBe('v0.7.6');
    expect(formatVersion('')).toBe('');
    expect(formatVersion(undefined)).toBe('');
  });
  it('abbreviates a Stellar address', () => {
    expect(shortWallet('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW')).toBe('GABC…TUVW');
    expect(shortWallet('')).toBe('');
    expect(shortWallet(null)).toBe('');
  });
});

describe('title locales', () => {
  const flatten = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flatten(v, `${p}${k}.`) : [`${p}${k}`]));
  it('en and es export { title } with the same keys and non-empty strings', () => {
    expect(Object.keys(titleEn)).toEqual(['title']);
    expect(Object.keys(titleEs)).toEqual(['title']);
    expect(flatten(titleEs.title).sort()).toEqual(flatten(titleEn.title).sort());
    for (const loc of [titleEn, titleEs]) {
      for (const k of flatten(loc.title)) {
        const v = k.split('.').reduce((o, p) => o[p], loc.title);
        expect(typeof v).toBe('string');
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });
  it('the START hint never claims on-chain verification and stays one short line', () => {
    for (const loc of [titleEn, titleEs]) {
      expect(loc.title.play_hint.toLowerCase()).not.toMatch(/verif|proof|prueba/);
      expect(loc.title.play_hint.length).toBeLessThanOrEqual(32);
    }
  });
});
