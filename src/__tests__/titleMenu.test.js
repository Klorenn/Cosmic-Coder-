import { describe, it, expect } from 'vitest';
import { TITLE_MENU_OPTIONS, menuHintKey, compactNumber } from '../scenes/title/titleMenu.js';

describe('TITLE_MENU_OPTIONS', () => {
  it('has at most 8 items, START_GAME first; DOCUMENTATION moved into CREDITS', () => {
    expect(TITLE_MENU_OPTIONS.length).toBeLessThanOrEqual(8);
    expect(TITLE_MENU_OPTIONS[0]).toBe('START_GAME');
    expect(TITLE_MENU_OPTIONS).not.toContain('DOCUMENTATION');
    for (const o of ['UPGRADES', 'WEAPONS', 'CHARACTER', 'LEADERBOARD', 'SETTINGS', 'CONTROLS', 'CREDITS']) {
      expect(TITLE_MENU_OPTIONS).toContain(o);
    }
  });
});

describe('menuHintKey', () => {
  it('only START_GAME carries a one-line hint', () => {
    expect(menuHintKey('START_GAME')).toBe('title.play_hint');
    for (const o of TITLE_MENU_OPTIONS.slice(1)) expect(menuHintKey(o)).toBe(null);
    expect(menuHintKey(undefined)).toBe(null);
  });
});

describe('compactNumber', () => {
  it('keeps small numbers and abbreviates large ones', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(1234)).toBe('1.2K');
    expect(compactNumber(12000)).toBe('12K');
    expect(compactNumber(1250000)).toBe('1.3M');
    expect(compactNumber(-5)).toBe('0');
    expect(compactNumber(NaN)).toBe('0');
    expect(compactNumber('77')).toBe('77');
  });
});
