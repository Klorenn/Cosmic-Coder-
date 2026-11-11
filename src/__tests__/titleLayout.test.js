import { describe, it, expect } from 'vitest';
import { visibleRect, cornerAnchors, menuRowSpacing, cssPerUnit } from '../scenes/title/titleLayout.js';

describe('visibleRect', () => {
  it('is the whole canvas without zoom', () => {
    expect(visibleRect(1920, 1080, 1)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });
  it('is the centred 1/zoom window when the camera zooms (corners would be cropped otherwise)', () => {
    const r = visibleRect(1920, 1080, 1.8);
    expect(r.w).toBeCloseTo(1920 / 1.8);
    expect(r.h).toBeCloseTo(600);
    expect(r.x + r.w / 2).toBeCloseTo(960);
    expect(r.y + r.h / 2).toBeCloseTo(540);
  });
  it('survives garbage', () => {
    expect(visibleRect(NaN, -1, 0)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });
});

describe('cornerAnchors', () => {
  it('offsets every corner from the visible rect', () => {
    const a = cornerAnchors({ x: 100, y: 50, w: 800, h: 400 }, 20, 30);
    expect(a.topLeft).toEqual({ x: 120, y: 80 });
    expect(a.topRight).toEqual({ x: 880, y: 80 });
    expect(a.bottomLeft).toEqual({ x: 120, y: 420 });
    expect(a.bottomRight).toEqual({ x: 880, y: 420 });
    expect(a.bottomCenter).toEqual({ x: 500, y: 420 });
  });
});

describe('cssPerUnit', () => {
  it('combines FIT scale and camera zoom', () => {
    expect(cssPerUnit(1920, 1920, 1)).toBe(1);
    expect(cssPerUnit(960, 1920, 1.5)).toBeCloseTo(0.75);
    expect(cssPerUnit(undefined, 1920, 1)).toBe(1);
  });
});

describe('menuRowSpacing', () => {
  const base = { base: 32, minTouchCss: 48 };
  it('keeps the original 32px spacing on desktop (48 css px already met)', () => {
    expect(menuRowSpacing({ ...base, rows: 8, available: 600, cssPerUnit: 1.6 })).toBe(32);
  });
  it('grows toward a 48 css px touch target on small screens', () => {
    const s = menuRowSpacing({ ...base, rows: 8, available: 800, cssPerUnit: 0.625 });
    expect(s * 0.625).toBeGreaterThanOrEqual(48 - 0.01);
  });
  it('never grows beyond the space available for the rows', () => {
    const s = menuRowSpacing({ ...base, rows: 8, available: 300, cssPerUnit: 0.625 });
    expect(s * 8).toBeLessThanOrEqual(300 + 0.01);
    expect(s).toBeGreaterThanOrEqual(32);
  });
  it('never shrinks below the base spacing', () => {
    expect(menuRowSpacing({ ...base, rows: 8, available: 100, cssPerUnit: 0.3 })).toBe(32);
  });
});
