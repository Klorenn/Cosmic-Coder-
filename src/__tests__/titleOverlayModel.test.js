import { describe, it, expect } from 'vitest';
import {
  overlayFrame, overlayChromeH, gridLayout, gridMove, clampScroll, scrollToReveal, formatCost, levelDots,
  upgradeIconKind, keycapMetrics, PIXEL_ICONS, pixelIconCells, characterProfile, zkWeaponState, canPurchase, wrapIndex
} from '../scenes/title/overlayModel.js';

describe('overlayFrame', () => {
  const view = { x: 0, y: 0, w: 1920, h: 1080 };
  it('caps the panel to max css size times the unit and centres it in the view', () => {
    const f = overlayFrame(view, 1.5, { maxW: 880, maxH: 600, margin: 16 });
    expect(f.w).toBe(880 * 1.5);
    expect(f.h).toBe(600 * 1.5);
    expect(f.x + f.w / 2).toBe(960);
    expect(f.y + f.h / 2).toBe(540);
  });
  it('shrinks to the visible window minus the margin on small screens', () => {
    const small = { x: 426, y: 240, w: 1067, h: 600 };
    const f = overlayFrame(small, 1.6, { maxW: 880, maxH: 600, margin: 12 });
    expect(f.w).toBeCloseTo(1067 - 2 * 12 * 1.6);
    expect(f.h).toBeCloseTo(600 - 2 * 12 * 1.6);
    expect(f.x).toBeCloseTo(426 + 12 * 1.6);
  });
  it('survives garbage', () => {
    const f = overlayFrame(null, NaN, {});
    expect(f.w).toBeGreaterThan(0);
    expect(f.h).toBeGreaterThan(0);
  });
});

describe('overlayChromeH', () => {
  it('is header + gap + footer (or bottom padding)', () => {
    expect(overlayChromeH(84)).toBe(60 + 14 + 84 + 8);
    expect(overlayChromeH(0)).toBe(60 + 14 + 20);
  });
});

describe('gridLayout', () => {
  it('fits as many columns as allowed by the minimum cell width', () => {
    const g = gridLayout({ width: 1000, count: 7, cellMin: 220, gap: 20, cellH: 100 });
    expect(g.cols).toBe(4);
    expect(g.rows).toBe(2);
    expect(g.cellW * g.cols + g.gap * (g.cols - 1)).toBeCloseTo(1000);
    expect(g.contentH).toBe(2 * 100 + 20);
  });
  it('never uses more columns than items and caps at maxCols', () => {
    expect(gridLayout({ width: 2000, count: 3, cellMin: 100, gap: 10, cellH: 50 }).cols).toBe(3);
    expect(gridLayout({ width: 2000, count: 9, cellMin: 100, gap: 10, cellH: 50, maxCols: 5 }).cols).toBe(5);
  });
  it('caps cell width at cellMax and centres the grid', () => {
    const g = gridLayout({ width: 1000, count: 2, cellMin: 100, cellMax: 200, gap: 20, cellH: 50 });
    expect(g.cellW).toBe(200);
    expect(g.offsetX).toBe((1000 - 420) / 2);
  });
  it('places cells row-major', () => {
    const g = gridLayout({ width: 300, count: 5, cellMin: 90, gap: 15, cellH: 40 });
    expect(g.cols).toBe(3);
    const c4 = g.cell(4);
    expect(c4.x).toBeCloseTo(g.offsetX + (g.cellW + 15));
    expect(c4.y).toBe(40 + 15);
    expect(c4.w).toBe(g.cellW);
    expect(c4.h).toBe(40);
  });
  it('always has at least one column even when narrower than cellMin', () => {
    const g = gridLayout({ width: 50, count: 4, cellMin: 200, gap: 10, cellH: 30 });
    expect(g.cols).toBe(1);
    expect(g.cellW).toBe(50);
  });
  it('empty grid is zero height', () => {
    expect(gridLayout({ width: 500, count: 0, cellMin: 100, gap: 10, cellH: 30 }).contentH).toBe(0);
  });
});

describe('gridMove', () => {
  it('left/right step and wrap over the whole list', () => {
    expect(gridMove(0, 'left', 3, 7)).toBe(6);
    expect(gridMove(6, 'right', 3, 7)).toBe(0);
    expect(gridMove(2, 'right', 3, 7)).toBe(3);
  });
  it('up/down jump a row and clamp to the last item', () => {
    expect(gridMove(1, 'down', 3, 7)).toBe(4);
    expect(gridMove(4, 'down', 3, 7)).toBe(6);
    expect(gridMove(6, 'down', 3, 7)).toBe(6);
    expect(gridMove(4, 'up', 3, 7)).toBe(1);
    expect(gridMove(1, 'up', 3, 7)).toBe(1);
  });
  it('handles empty lists', () => {
    expect(gridMove(0, 'right', 3, 0)).toBe(0);
  });
});

describe('wrapIndex', () => {
  it('wraps both ways', () => {
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(1, 0)).toBe(0);
  });
});

describe('scroll helpers', () => {
  it('clampScroll keeps the content inside the viewport', () => {
    expect(clampScroll(-20, 500, 300)).toBe(0);
    expect(clampScroll(400, 500, 300)).toBe(200);
    expect(clampScroll(50, 200, 300)).toBe(0);
  });
  it('scrollToReveal scrolls the minimum to show an item', () => {
    expect(scrollToReveal(0, 300, 350, 100, 10, 1000)).toBe(160);
    expect(scrollToReveal(200, 300, 100, 50, 10, 1000)).toBe(90);
    expect(scrollToReveal(100, 300, 150, 50, 10, 1000)).toBe(100);
  });
});

describe('formatCost / canPurchase', () => {
  it('compacts big costs and marks maxed', () => {
    expect(formatCost(150)).toBe('150');
    expect(formatCost(1537)).toBe('1.5K');
    expect(formatCost(Infinity)).toBe('MAX');
    expect(formatCost(10, true)).toBe('MAX');
  });
  it('canPurchase needs currency and a free level', () => {
    expect(canPurchase(100, 100, 0, 5)).toBe(true);
    expect(canPurchase(99, 100, 0, 5)).toBe(false);
    expect(canPurchase(1000, 100, 5, 5)).toBe(false);
    expect(canPurchase(1000, Infinity, 1, 5)).toBe(false);
  });
});

describe('levelDots', () => {
  it('returns one flag per level', () => {
    expect(levelDots(2, 5)).toEqual([true, true, false, false, false]);
  });
  it('clamps garbage', () => {
    expect(levelDots(9, 3)).toEqual([true, true, true]);
    expect(levelDots(-1, 2)).toEqual([false, false]);
    expect(levelDots(1, NaN)).toEqual([]);
  });
});

describe('pixel icons', () => {
  it('every upgrade key maps to a defined icon', () => {
    ['damage', 'health', 'speed', 'attackRate', 'xpGain', 'critChance', 'weaponDuration', 'unknown'].forEach((k) => {
      expect(PIXEL_ICONS[upgradeIconKind(k)]).toBeDefined();
    });
  });
  it('every icon is a square matrix', () => {
    Object.entries(PIXEL_ICONS).forEach(([name, rows]) => {
      rows.forEach((r) => expect(r.length, name).toBe(rows.length));
    });
  });
  it('pixelIconCells lists only painted cells with their shade', () => {
    const cells = pixelIconCells('heart');
    expect(cells.length).toBeGreaterThan(10);
    cells.forEach((c) => expect(['main', 'hi', 'lo']).toContain(c.shade));
    expect(pixelIconCells('nope')).toEqual([]);
  });
});

describe('characterProfile', () => {
  it('gives a role and three 0..1 bars for every character', () => {
    ['vibecoder', 'destroyer', 'swordsman'].forEach((id) => {
      const p = characterProfile(id);
      expect(typeof p.role).toBe('string');
      [p.hp, p.dmg, p.spd].forEach((v) => { expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1); });
    });
  });
  it('unknown ids fall back to vibecoder', () => {
    expect(characterProfile('x')).toEqual(characterProfile('vibecoder'));
  });
});

describe('zkWeaponState', () => {
  it('mirrors the old gallery rules', () => {
    expect(zkWeaponState({ unlocked: true, gamesPlayed: 0, score: 0, threshold: 100 })).toEqual({ state: 'unlocked' });
    expect(zkWeaponState({ unlocked: false, gamesPlayed: 1, score: 0, threshold: 100 })).toEqual({ state: 'play_more', remaining: 2 });
    expect(zkWeaponState({ unlocked: false, gamesPlayed: 3, score: 50, threshold: 100 })).toEqual({ state: 'score_low', need: 100 });
    expect(zkWeaponState({ unlocked: false, gamesPlayed: 5, score: 150, threshold: 100 })).toEqual({ state: 'unlockable' });
  });
});

describe('keycapMetrics', () => {
  it('width is text + 2 * padding (>= 4 art px) at a fixed 14 art px height', () => {
    const m = keycapMetrics(25);
    expect(m.w).toBeGreaterThanOrEqual(25 + 8);
    expect(m.h).toBe(14);
  });
  it('never pads below 4 art px, even if asked', () => {
    expect(keycapMetrics(10, { pad: 1 }).w).toBe(18);
  });
  it('respects a minimum width for one-letter caps', () => {
    expect(keycapMetrics(5, { minW: 12 }).w).toBe(13);
    expect(keycapMetrics(1, { minW: 12 }).w).toBe(12);
  });
});
