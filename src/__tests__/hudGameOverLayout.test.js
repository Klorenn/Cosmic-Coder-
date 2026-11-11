import { describe, it, expect } from 'vitest';
import { computeGameOverLayout } from '../systems/hud/gameOverLayout.js';

const VIEWPORTS = [
  // [label, css display width, css display height]  (canvas is 1920x1080 FIT)
  ['desktop 1920', 1920, 1080],
  ['desktop 1280', 1280, 720],
  ['small 1024', 1024, 576],
  ['phone landscape 812x375', 667, 375],
  ['phone portrait 375x812', 375, 211]
];

const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r, p) => r.x >= p.x - 0.5 && r.y >= p.y - 0.5 && r.x + r.w <= p.x + p.w + 0.5 && r.y + r.h <= p.y + p.h + 0.5;

describe('computeGameOverLayout', () => {
  it.each(VIEWPORTS)('%s: panel fits the screen and holds every block', (_l, dW, dH) => {
    const L = computeGameOverLayout({ w: 1920, h: 1080, displayW: dW, displayH: dH });
    const { panel } = L;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.w).toBeLessThanOrEqual(1920);
    expect(panel.y + panel.h).toBeLessThanOrEqual(1080);
    expect(L.cards).toHaveLength(4);
    for (const c of L.cards) expect(inside(c, panel)).toBe(true);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(rectsOverlap(L.cards[i], L.cards[j])).toBe(false);
    for (const b of [L.buttons.primary, L.buttons.secondary]) {
      expect(inside(b, panel)).toBe(true);
      for (const c of L.cards) expect(rectsOverlap(b, c)).toBe(false);
    }
    expect(rectsOverlap(L.buttons.primary, L.buttons.secondary)).toBe(false);
    expect(L.status.y).toBeLessThan(panel.y + panel.h);
    expect(L.status.y).toBeGreaterThan(L.buttons.primary.y + L.buttons.primary.h - 1);
  });

  it('wide screens: one row of 4 stat cards, buttons side by side, panel max 720x520 css', () => {
    const L = computeGameOverLayout({ w: 1920, h: 1080, displayW: 1280, displayH: 720 });
    expect(L.compact).toBe(false);
    expect(new Set(L.cards.map((c) => Math.round(c.y))).size).toBe(1);
    expect(Math.round(L.buttons.primary.y)).toBe(Math.round(L.buttons.secondary.y));
    expect(L.panel.w / L.k).toBeLessThanOrEqual(720.5);
    expect(L.panel.h / L.k).toBeLessThanOrEqual(520.5);
    expect(L.buttons.primary.h / L.k).toBeGreaterThanOrEqual(44);
  });

  it('narrow screens (<900 css): 92% panel, 2x2 stats, stacked buttons >= 48 css px', () => {
    const L = computeGameOverLayout({ w: 1920, h: 1080, displayW: 667, displayH: 375 });
    expect(L.compact).toBe(true);
    expect(L.panel.w / L.k).toBeCloseTo(667 * 0.92, 0);
    expect(new Set(L.cards.map((c) => Math.round(c.y))).size).toBe(2);
    expect(new Set(L.cards.map((c) => Math.round(c.x))).size).toBe(2);
    expect(L.buttons.secondary.y).toBeGreaterThan(L.buttons.primary.y);
    expect(L.buttons.primary.h / L.k).toBeGreaterThanOrEqual(48);
    expect(L.buttons.secondary.h / L.k).toBeGreaterThanOrEqual(48);
  });

  it('very short canvases scale the whole panel down instead of overflowing', () => {
    const L = computeGameOverLayout({ w: 1920, h: 1080, displayW: 375, displayH: 211 });
    expect(L.u).toBeLessThan(1);
    expect(L.panel.h).toBeLessThanOrEqual(1080);
  });

  it('survives garbage input', () => {
    const L = computeGameOverLayout({ w: NaN, h: -1, displayW: 0, displayH: undefined });
    expect(Number.isFinite(L.panel.w)).toBe(true);
    expect(Number.isFinite(L.k)).toBe(true);
  });
});
