import { describe, it, expect } from 'vitest';
import { canTakeContactDamage, isInvulnerable } from '../systems/damageRules.js';
import { CONTACT_IFRAMES_MS } from '../config/balance.js';

describe('damageRules', () => {
  it('exposes a ~600 ms contact i-frame window', () => {
    expect(CONTACT_IFRAMES_MS).toBeGreaterThanOrEqual(400);
    expect(CONTACT_IFRAMES_MS).toBeLessThanOrEqual(1000);
  });

  it('allows the first hit ever', () => {
    expect(canTakeContactDamage(null, 0)).toBe(true);
    expect(canTakeContactDamage(undefined, 123)).toBe(true);
  });

  it('blocks hits inside the i-frame window', () => {
    expect(canTakeContactDamage(1000, 1000)).toBe(false);
    expect(canTakeContactDamage(1000, 1000 + CONTACT_IFRAMES_MS - 1)).toBe(false);
    expect(isInvulnerable(1000, 1001)).toBe(true);
  });

  it('allows hits once the window has elapsed', () => {
    expect(canTakeContactDamage(1000, 1000 + CONTACT_IFRAMES_MS)).toBe(true);
    expect(isInvulnerable(1000, 1000 + CONTACT_IFRAMES_MS)).toBe(false);
  });

  it('accepts a custom window', () => {
    expect(canTakeContactDamage(0, 50, 100)).toBe(false);
    expect(canTakeContactDamage(0, 100, 100)).toBe(true);
  });

  it('treats a clock going backwards (scene restart) as a fresh window', () => {
    expect(canTakeContactDamage(5000, 10)).toBe(true);
  });
});

import { applyDamage } from '../systems/damageRules.js';

describe('applyDamage', () => {
  it('subtracts damage from health', () => {
    expect(applyDamage(10, 3)).toEqual({ health: 7, shieldLeft: 0, died: false });
  });
  it('clamps health to 0 on overkill and flags death', () => {
    expect(applyDamage(3, 10)).toEqual({ health: 0, shieldLeft: 0, died: true });
  });
  it('dies at exactly 0', () => {
    expect(applyDamage(5, 5).died).toBe(true);
  });
  it('shield absorbs first, remainder hits health', () => {
    expect(applyDamage(10, 4, { shield: 6 })).toEqual({ health: 10, shieldLeft: 2, died: false });
    expect(applyDamage(10, 8, { shield: 3 })).toEqual({ health: 5, shieldLeft: 0, died: false });
  });
  it('never returns negative health or NaN for bad input', () => {
    for (const [h, d, s] of [[NaN, 2, 0], [5, NaN, 0], [undefined, undefined, undefined], [-7, 1, 0], [5, -3, 0], [5, 2, NaN]]) {
      const r = applyDamage(h, d, { shield: s });
      expect(Number.isNaN(r.health)).toBe(false);
      expect(Number.isNaN(r.shieldLeft)).toBe(false);
      expect(r.health).toBeGreaterThanOrEqual(0);
    }
    expect(applyDamage(-7, 1).health).toBe(0);
    expect(applyDamage(5, -3).health).toBe(5);
  });
});
