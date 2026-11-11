import { describe, it, expect } from 'vitest';
import { computeHudLayout, hudArtPx, logicalPerArt, HUD_ART } from '../systems/hud/hudLayout.js';
import { isScreenSpace, routeObjectsToCameras } from '../systems/hud/cameraRouting.js';

const LOGICAL = { w: 1920, h: 1080 };
// Rendered canvas (Scale.FIT keeps 16:9): window -> display size in css px.
const fit = (ww, wh) => { const s = Math.min(ww / 1920, wh / 1080); return { displayW: 1920 * s, displayH: 1080 * s }; };
const VIEWPORTS = {
  '1920x1080': fit(1920, 1080),
  '1280x720': fit(1280, 720),
  '800x346 (user panel)': fit(800, 346),
  '812x375': fit(812, 375),
  '375x812': fit(375, 812),
  '2560x1440': fit(2560, 1440)
};

describe('hudArtPx (css px per HUD art pixel)', () => {
  it('scales by rendered height: <480 -> 1, <1440 -> 2, >=1440 -> 3', () => {
    expect(hudArtPx(615, 346)).toBe(1);
    expect(hudArtPx(375, 211)).toBe(1);
    expect(hudArtPx(667, 375)).toBe(1);
    expect(hudArtPx(853, 479)).toBe(1);
    expect(hudArtPx(854, 480)).toBe(2);
    expect(hudArtPx(1280, 720)).toBe(2);
    expect(hudArtPx(1920, 1080)).toBe(2); // 1080p must NOT jump to 3
    expect(hudArtPx(2400, 1350)).toBe(2);
    expect(hudArtPx(2560, 1440)).toBe(3);
    expect(hudArtPx(3840, 2160)).toBe(3);
  });

  it('falls back to 2 for missing sizes', () => {
    expect(hudArtPx(0, 0)).toBe(2);
    expect(hudArtPx(NaN, undefined)).toBe(2);
  });

  it('logical units per art px never drop below one css px per art px', () => {
    expect(logicalPerArt(2, 1)).toBe(2);
    expect(logicalPerArt(2, 1.5)).toBe(3);
    expect(logicalPerArt(1, 1920 / 615)).toBe(3); // user panel: 3.12 logical per css px
    expect(logicalPerArt(3, 0.75)).toBe(2); // 1440p: canvas upscaled
    expect(logicalPerArt(1, 0.2)).toBe(1);
    expect(logicalPerArt(1, NaN)).toBe(1);
  });
});

describe('computeHudLayout (pixel HUD v4, scaled by viewport)', () => {
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const circleBox = (c) => ({ x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2 });

  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const L = computeHudLayout({ ...LOGICAL, ...vp });
    const cssPerLogical = vp.displayW / LOGICAL.w;

    it(`${name}: one art px ~= hudArtPx css px (integer logical units)`, () => {
      expect(L.art).toBe(hudArtPx(vp.displayW, vp.displayH));
      expect(Number.isInteger(L.px)).toBe(true);
      const css = L.px * cssPerLogical;
      expect(Math.abs(css - L.art)).toBeLessThan(0.5);
    });

    it(`${name}: top-left panel stays under 12% of the screen height`, () => {
      expect(L.vitals.h / LOGICAL.h).toBeLessThanOrEqual(0.12);
    });

    it(`${name}: widgets stay on screen and apart`, () => {
      const boxes = [L.vitals, L.wave, L.score, L.buffs, L.boss, circleBox(L.weapon), circleBox(L.ability)];
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(LOGICAL.w + 0.01);
        expect(b.y + b.h).toBeLessThanOrEqual(LOGICAL.h + 0.01);
      }
      expect(overlap(L.vitals, L.wave)).toBe(false);
      expect(overlap(L.wave, L.score)).toBe(false);
      expect(overlap(L.boss, L.buffs)).toBe(false);
      expect(overlap(circleBox(L.weapon), L.buffs)).toBe(false);
      expect(overlap(circleBox(L.ability), L.buffs)).toBe(false);
      expect(overlap(circleBox(L.weapon), L.vitals)).toBe(false);
    });

    it(`${name}: geometry sits on the art grid`, () => {
      const P = L.px;
      const vals = [L.vitals.x, L.vitals.y, L.vitals.w, L.vitals.h, L.vitals.hp.x, L.vitals.hp.y, L.vitals.hp.w, L.vitals.num.x, L.vitals.num.y,
        L.vitals.xp.y, L.wave.cx, L.wave.y, L.score.right, L.weapon.x, L.weapon.y, L.ability.x, L.ability.y, L.buffs.x, L.buffs.y, L.boss.barY];
      for (const v of vals) expect(v % P).toBe(0);
    });
  }

  it('art-pixel footprint matches the spec', () => {
    const L = computeHudLayout({ ...LOGICAL, ...VIEWPORTS['1920x1080'] });
    const a = (v) => v / L.px;
    expect(a(L.vitals.portrait.s)).toBe(HUD_ART.portrait);
    expect(HUD_ART.portrait).toBe(20);
    expect(a(L.vitals.hp.w)).toBe(96);
    expect(a(L.vitals.hp.h)).toBe(8);
    expect(a(L.vitals.xp.h)).toBe(3);
    expect(a(L.vitals.level.h)).toBe(12);
    expect(a(L.weapon.r) * 2).toBe(20);
    expect(a(L.ability.r) * 2).toBe(20);
    expect(a(L.boss.w)).toBe(160);
    expect(a(L.boss.barH)).toBe(6);
    expect(a(L.pad)).toBe(6);
    expect(a(L.wave.h)).toBe(20); // 2x number at art 2
    expect(a(L.score.h)).toBe(12);
  });

  it('1080p HUD is discreet: vitals panel <= 5% of the height, 2 css px per art px', () => {
    const L = computeHudLayout({ ...LOGICAL, ...VIEWPORTS['1920x1080'] });
    expect(L.art).toBe(2);
    expect(L.vitals.h / LOGICAL.h).toBeLessThanOrEqual(0.05);
  });

  it('user panel 800x346: whole HUD under 15% of the screen, 1x labels only', () => {
    const L = computeHudLayout({ ...LOGICAL, ...VIEWPORTS['800x346 (user panel)'] });
    expect(L.art).toBe(1);
    expect(L.labels).toBe(false);
    expect(L.compact).toBe(true);
    expect(L.vitals.level).toBe(null);
    expect(L.vitals.modeDot).toBe(null);
    expect(L.fontScale.wave).toBe(1);
    expect(L.wave.h / L.px).toBe(12);
    const area = (b) => b.w * b.h;
    const disc = (c) => (2 * c.r) ** 2;
    const total = area(L.vitals) + area(L.wave) + area(L.score) + area(L.buffs) + area(L.boss) + disc(L.weapon) + disc(L.ability);
    expect(total / (LOGICAL.w * LOGICAL.h)).toBeLessThan(0.15);
    expect(L.vitals.h / LOGICAL.h).toBeLessThan(0.12);
  });

  it('labels and the 2x wave number come back from 480 css px tall', () => {
    const L = computeHudLayout({ ...LOGICAL, ...VIEWPORTS['1280x720'] });
    expect(L.labels).toBe(true);
    expect(L.fontScale.wave).toBe(2);
    expect(L.vitals.level).not.toBe(null);
  });

  it('touch: the weapon disc moves under the vitals (joystick owns the corner)', () => {
    const L = computeHudLayout({ ...LOGICAL, ...VIEWPORTS['812x375'], touch: true });
    expect(L.weapon.y - L.weapon.r).toBeGreaterThanOrEqual(L.vitals.y + L.vitals.h);
    expect(L.weapon.y).toBeLessThan(LOGICAL.h / 2);
  });

  it('wave chip slides into the free strip when the centre is taken', () => {
    const L = computeHudLayout({ w: 1920, h: 1080, displayW: 300, displayH: 169 });
    expect(L.wave.x).toBeGreaterThanOrEqual(L.vitals.x + L.vitals.w);
    expect(L.wave.x + L.wave.w).toBeLessThanOrEqual(L.score.x);
  });

  it('wave readout is centred on screen', () => {
    const L = computeHudLayout({ ...LOGICAL, ...VIEWPORTS['1920x1080'] });
    expect(Math.abs(L.wave.cx - LOGICAL.w / 2)).toBeLessThanOrEqual(L.px);
  });

  it('survives missing / zero display size', () => {
    const L = computeHudLayout({ w: 1920, h: 1080, displayW: 0, displayH: undefined });
    expect(L.px).toBeGreaterThanOrEqual(1);
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
