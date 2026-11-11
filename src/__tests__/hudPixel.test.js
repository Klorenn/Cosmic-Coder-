import { describe, it, expect } from 'vitest';
import { artPxFor, snapPx, stepsFilled, ringCells, ringRuns, drawSegRing, discRows, drawPixelDisc, fadeSteps } from '../systems/hud/pixelShapes.js';
import { computeHudLayout } from '../systems/hud/hudLayout.js';
import { computeGameOverLayout } from '../systems/hud/gameOverLayout.js';

const recorder = () => {
  const rects = [];
  let style = null;
  return { rects, fillStyle(c, a) { style = { c, a }; }, fillRect(x, y, w, h) { rects.push({ x, y, w, h, ...style }); } };
};

describe('pixel HUD shapes (ui/arena-pixel-v3)', () => {
  it('art pixel = 2 css px, never below 1 logical unit', () => {
    expect(artPxFor(1)).toBe(2);
    expect(artPxFor(1.5)).toBe(3); // 1280 css window on the 1920 canvas
    expect(artPxFor(0.2)).toBe(1);
    expect(artPxFor(NaN)).toBe(2);
    expect(snapPx(10, 3)).toBe(9);
  });

  it('cooldown rings advance in 12 discrete steps', () => {
    expect(stepsFilled(0)).toBe(0);
    expect(stepsFilled(0.08)).toBe(0);
    expect(stepsFilled(0.5)).toBe(6);
    expect(stepsFilled(0.99)).toBe(11);
    expect(stepsFilled(1)).toBe(12);
    expect(stepsFilled(5)).toBe(12);
  });

  it('ring cells lie in the annulus and cover every segment', () => {
    const cells = ringCells(14, 2, 12);
    expect(cells.length).toBeGreaterThan(100);
    for (const c of cells) {
      const d = Math.hypot(c.x + 0.5, c.y + 0.5);
      expect(d).toBeLessThan(14);
      expect(d).toBeGreaterThanOrEqual(12);
    }
    expect(new Set(cells.map((c) => c.seg)).size).toBe(12);
    // gaps: a gap-less ring has strictly more cells
    expect(ringCells(14, 2, 12, 0).length).toBeGreaterThan(cells.length);
  });

  it('first segment starts at 12 o\'clock and goes clockwise', () => {
    const seg0 = ringCells(14, 2, 4).filter((c) => c.seg === 0);
    expect(seg0.every((c) => c.x >= 0 && c.y < 0)).toBe(true); // top-right quadrant
  });

  it('runs merge cells and respect the fill count', () => {
    const runs = ringRuns(14, 2, 12, 6);
    const cells = ringCells(14, 2, 12);
    expect(runs.reduce((a, r) => a + r.w, 0)).toBe(cells.length);
    expect(runs.length).toBeLessThan(cells.length / 2);
    expect(runs.filter((r) => r.on).reduce((a, r) => a + r.w, 0)).toBe(cells.filter((c) => c.seg < 6).length);
  });

  it('drawSegRing only paints off segments when an off colour is given', () => {
    const g = recorder();
    drawSegRing(g, 100, 100, { r: 10, filled: 3, P: 2, on: 0xff0000 });
    expect(g.rects.every((r) => r.c === 0xff0000)).toBe(true);
    const g2 = recorder();
    drawSegRing(g2, 100, 100, { r: 10, filled: 3, P: 2, on: 0xff0000, off: 0x111111 });
    expect(g2.rects.some((r) => r.c === 0x111111)).toBe(true);
    expect(g2.rects.every((r) => (r.x - 100) % 2 === 0 && r.h === 2)).toBe(true); // on the art grid
  });

  it('discs are symmetric and bevelled', () => {
    const rows = discRows(6);
    expect(rows.length).toBe(12);
    expect(rows[0].half).toBe(rows[rows.length - 1].half);
    const g = recorder();
    drawPixelDisc(g, 0, 0, { r: 6, P: 1, fill: 2, light: 3, dark: 1, outline: 0 });
    const colours = new Set(g.rects.map((r) => r.c));
    expect([0, 1, 2, 3].every((c) => colours.has(c))).toBe(true);
  });

  it('retro fade uses 0.25 alpha steps', () => {
    expect(fadeSteps()).toEqual([1, 0.75, 0.5, 0.25, 0]);
  });

  it('layouts expose an integer art pixel size', () => {
    const hud = computeHudLayout({ w: 1920, h: 1080, displayW: 1280, displayH: 720 });
    expect(hud.px).toBe(3);
    const phone = computeHudLayout({ w: 1920, h: 1080, displayW: 812, displayH: 457 });
    expect(Number.isInteger(phone.px)).toBe(true);
    expect(phone.px * (812 / 1920)).toBeGreaterThan(1.5);
    const go = computeGameOverLayout({ w: 1920, h: 1080, displayW: 1280, displayH: 720 });
    expect(Number.isInteger(go.px)).toBe(true);
    expect(go.px).toBeGreaterThanOrEqual(1);
  });
});
