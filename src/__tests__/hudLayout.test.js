import { describe, it, expect } from 'vitest';
import { computeHudLayout, MIN_FONT_CSS_PX } from '../systems/hud/hudLayout.js';
import { isScreenSpace, routeObjectsToCameras } from '../systems/hud/cameraRouting.js';

const LOGICAL = { w: 1920, h: 1080 };
const VIEWPORTS = {
  desktop: { displayW: 1920, displayH: 1080 },
  laptop: { displayW: 1280, displayH: 720 },
  netbook: { displayW: 1024, displayH: 576 },
  phone: { displayW: 375, displayH: 211 }
};

describe('computeHudLayout (minimal HUD)', () => {
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const circleBox = (c) => ({ x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2 });

  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    it(`${name}: every font is at least ${MIN_FONT_CSS_PX} css px once the canvas is scaled`, () => {
      const L = computeHudLayout({ ...LOGICAL, ...vp });
      const cssPerLogical = vp.displayW / LOGICAL.w;
      for (const size of Object.values(L.font)) {
        expect(size * cssPerLogical).toBeGreaterThanOrEqual(MIN_FONT_CSS_PX - 0.01);
      }
    });

    it(`${name}: the three top readouts (vitals, wave, score) stay on screen and apart`, () => {
      const L = computeHudLayout({ ...LOGICAL, ...vp });
      const boxes = [L.vitals, L.wave, L.score, L.buffs, L.boss, circleBox(L.weapon), circleBox(L.ability)];
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(LOGICAL.w + 0.01);
        expect(b.y + b.h).toBeLessThanOrEqual(LOGICAL.h + 0.01);
      }
      expect(overlap(L.vitals, L.wave)).toBe(false);
      expect(overlap(L.wave, L.score)).toBe(false);
      expect(overlap(L.vitals, L.score)).toBe(false);
      expect(overlap(L.boss, L.buffs)).toBe(false);
      expect(overlap(circleBox(L.weapon), L.buffs)).toBe(false);
      expect(overlap(circleBox(L.ability), L.buffs)).toBe(false);
      expect(overlap(circleBox(L.weapon), L.vitals)).toBe(false);
    });

    it(`${name}: HP / XP / mode dot live inside the vitals panel`, () => {
      const L = computeHudLayout({ ...LOGICAL, ...vp });
      const { vitals: v } = L;
      const inside = (b) => b.x >= v.x && b.y >= v.y && b.x + b.w <= v.x + v.w + 0.01 && b.y + b.h <= v.y + v.h + 0.01;
      expect(inside(v.hp)).toBe(true);
      expect(inside(v.xp)).toBe(true);
      expect(inside(circleBox(v.portrait))).toBe(true);
      expect(inside(circleBox(v.modeDot))).toBe(true);
      expect(inside(circleBox(v.level))).toBe(true);
      expect(v.modeDot.r * 2 / L.k).toBeCloseTo(8, 5); // 8 css px dot
      expect(v.xp.h / L.k).toBeCloseTo(4, 5); // thin 4 css px XP bar
    });
  }

  it('icons are 36 css px on desktop and 32 on phones', () => {
    const d = computeHudLayout({ ...LOGICAL, ...VIEWPORTS.desktop });
    const p = computeHudLayout({ ...LOGICAL, ...VIEWPORTS.phone });
    expect(d.buffs.slot / d.k).toBe(36);
    expect(p.buffs.slot / p.k).toBe(32);
    expect(d.vitals.portrait.r * 2 / d.k).toBe(40);
  });

  it('wave readout is centred on screen when there is room', () => {
    const L = computeHudLayout({ ...LOGICAL, ...VIEWPORTS.desktop });
    expect(L.wave.x + L.wave.w / 2).toBeCloseTo(LOGICAL.w / 2, 5);
  });

  it('compact mode below 900 css px wide', () => {
    expect(computeHudLayout({ ...LOGICAL, ...VIEWPORTS.phone }).compact).toBe(true);
    expect(computeHudLayout({ ...LOGICAL, ...VIEWPORTS.netbook }).compact).toBe(false);
  });

  it('survives missing / zero display size', () => {
    const L = computeHudLayout({ w: 1920, h: 1080, displayW: 0, displayH: undefined });
    expect(Number.isFinite(L.font.wave)).toBe(true);
    expect(L.vitals.w).toBeGreaterThan(0);
  });
});

describe('cameraRouting', () => {
  it('isScreenSpace only for scrollFactor 0 on both axes', () => {
    expect(isScreenSpace({ scrollFactorX: 0, scrollFactorY: 0 })).toBe(true);
    expect(isScreenSpace({ scrollFactorX: 1, scrollFactorY: 1 })).toBe(false);
    expect(isScreenSpace({ scrollFactorX: 0, scrollFactorY: 1 })).toBe(false);
    expect(isScreenSpace(null)).toBe(false);
  });

  it('hides screen-space objects from the world camera and world objects from the UI camera', () => {
    const world = { scrollFactorX: 1, scrollFactorY: 1, cameraFilter: 0 };
    const hud = { scrollFactorX: 0, scrollFactorY: 0, cameraFilter: 0 };
    const other = { scrollFactorX: 1, scrollFactorY: 1, cameraFilter: 8 };
    const changed = routeObjectsToCameras([world, hud, other, null], 1, 2);
    expect(world.cameraFilter).toBe(2);
    expect(hud.cameraFilter).toBe(1);
    expect(other.cameraFilter).toBe(8 | 2);
    expect(changed).toBe(3);
    expect(routeObjectsToCameras([world, hud, other], 1, 2)).toBe(0);
  });

  it('screen-space backgrounds (negative depth) stay on the world camera, behind the world', () => {
    const bg = { scrollFactorX: 0, scrollFactorY: 0, depth: -9.5, cameraFilter: 0 };
    const overlay = { scrollFactorX: 0, scrollFactorY: 0, depth: 0, cameraFilter: 0 };
    routeObjectsToCameras([bg, overlay], 1, 2);
    expect(bg.cameraFilter).toBe(2);
    expect(overlay.cameraFilter).toBe(1);
  });

  it('explicit renderLayer wins over the heuristic', () => {
    const forcedUi = { scrollFactorX: 1, scrollFactorY: 1, depth: 0, renderLayer: 'ui', cameraFilter: 0 };
    const forcedWorld = { scrollFactorX: 0, scrollFactorY: 0, depth: 5, renderLayer: 'world', cameraFilter: 0 };
    routeObjectsToCameras([forcedUi, forcedWorld], 1, 2);
    expect(forcedUi.cameraFilter).toBe(1);
    expect(forcedWorld.cameraFilter).toBe(2);
  });

  it('re-routes an object whose scroll factor changed', () => {
    const o = { scrollFactorX: 1, scrollFactorY: 1, cameraFilter: 0 };
    routeObjectsToCameras([o], 1, 2);
    o.scrollFactorX = 0; o.scrollFactorY = 0;
    routeObjectsToCameras([o], 1, 2);
    expect(o.cameraFilter).toBe(1);
  });
});
