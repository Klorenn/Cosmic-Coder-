#!/usr/bin/env node
/**
 * Deterministic generator for the PIXEL UI kit (ui/pixel-kit-v3). No downloads, no antialiasing:
 * every pixel is placed on an integer grid and written with sharp from raw RGBA.
 *
 *   public/assets/UI/pixel/ui-pixel.png + ui-pixel.json   atlas (Phaser JSON hash): 9-slice skins + icons
 *   public/assets/UI/pixel/pixel.png + pixel.xml          bitmap font "pixel" (5x7 caps, descenders, ES accents)
 *   public/assets/UI/pixel/ui-dither.png                  2x2 checker for dithered dims (TileSprite)
 *   public/assets/UI/pixel/ui-manifest.json               slices + icon names (read by tests / docs)
 *
 *   node scripts/assets/gen-ui.mjs           # write everything
 *   node scripts/assets/gen-ui.mjs --sheet   # also scripts/evil-player/reports/ui-sheet.png (4x preview)
 *
 * Icons are drawn as shapes in a 14-unit design space and rasterised by pixel-centre sampling at 14 px
 * (16 px icon) and 22 px (24 px icon); then auto-shaded (top/left light, bottom/right dark) and outlined
 * with a 1 px ink outline. `-m` frames are greyscale ramps meant to be tinted at runtime.
 * gen-items.mjs reuses renderIcon()/paintBox() for the 32x32 item pickups.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/assets/UI/pixel');

// ---------------------------------------------------------------- palette
export const PAL = {
  ink: '#0f1228', night: '#1a1f3d', dusk: '#262d58', slate: '#3b4489',
  periw: '#7b86d9', mist: '#b5bcff', white: '#ffffff',
  cyan: '#4fe3ff', cyanD: '#1aa3c9', violet: '#a66bff', violetD: '#6b3fd1',
  amber: '#ffc14d', amberD: '#d98a1e', green: '#5df28a', greenD: '#2fa65a',
  red: '#ff5c7a', redD: '#c0304f', magenta: '#ff6be6'
};

/** Colour ramps (light, base, dark) per family. Light tones are the only additions to the 18-colour palette. */
export const FAM = {
  cyan: { l: '#b0f3ff', b: PAL.cyan, d: PAL.cyanD },
  violet: { l: '#d4b8ff', b: PAL.violet, d: PAL.violetD },
  amber: { l: '#ffe3a3', b: PAL.amber, d: PAL.amberD },
  green: { l: '#b4f9c9', b: PAL.green, d: PAL.greenD },
  red: { l: '#ffb0bf', b: PAL.red, d: PAL.redD },
  magenta: { l: '#ffc2f4', b: PAL.magenta, d: '#b33aa3' },
  steel: { l: PAL.white, b: PAL.mist, d: PAL.periw },
  slate: { l: PAL.periw, b: PAL.slate, d: PAL.dusk },
  bronze: { l: '#f7b77a', b: '#c8732e', d: '#7d4216' },
  wood: { l: PAL.amber, b: PAL.amberD, d: '#8a4f12' },
  mono: { l: '#ffffff', b: '#cccccc', d: '#8e8e8e' },
  mono2: { l: '#a8a8a8', b: '#848484', d: '#5c5c5c' }
};

// ---------------------------------------------------------------- raster core
export class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.c = new Array(w * h).fill(null); }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.in(x, y) ? this.c[y * this.w + x] : null; }
  set(x, y, v) { if (this.in(x, y)) this.c[y * this.w + x] = v; }
  rect(x, y, w, h, v) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v); }
  blit(src, ox, oy) { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const v = src.get(x, y); if (v) this.set(ox + x, oy + y, v); } }
  rows(list, ox, oy, map) { list.forEach((row, y) => [...row].forEach((ch, x) => { if (map[ch]) this.set(ox + x, oy + y, map[ch]); })); }
}

const rgba = (hex) => {
  const s = hex.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255];
};

export function gridToRaw(g) {
  const buf = Buffer.alloc(g.w * g.h * 4);
  g.c.forEach((v, i) => { if (v) rgba(v).forEach((b, k) => { buf[i * 4 + k] = b; }); });
  return buf;
}
export async function gridToPng(g, scale = 1) {
  let img = sharp(gridToRaw(g), { raw: { width: g.w, height: g.h, channels: 4 } });
  if (scale !== 1) img = sharp(await img.png().toBuffer()).resize(g.w * scale, g.h * scale, { kernel: 'nearest' });
  return img.png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Bevelled box. rings[i] paints depth i (0 = outermost): a colour, or { t, l, b, r } per side (missing
 * side = fill). Corners are chamfered by `chamfer` px (pixel-rounded). Side priority on corners: t, b, l, r.
 */
export function paintBox(g, x0, y0, w, h, { chamfer = 1, rings = [], fill = null } = {}) {
  const x1 = x0 + w - 1; const y1 = y0 + h - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = y - y0; const b = y1 - y; const l = x - x0; const r = x1 - x;
      const dx = Math.min(l, r); const dy = Math.min(t, b);
      const depth = Math.min(dx, dy, dx + dy - chamfer);
      if (depth < 0) continue;
      let col = fill;
      const ring = rings[depth];
      if (ring) {
        if (typeof ring === 'string') col = ring;
        else {
          const m = Math.min(t, b, l, r);
          const side = t === m ? 't' : b === m ? 'b' : l === m ? 'l' : 'r';
          col = ring[side] ?? fill;
        }
      }
      if (col) g.set(x, y, col);
    }
  }
}

// ---------------------------------------------------------------- shape predicates (14-unit design space)
const R = (x0, y0, x1, y1) => (X, Y) => X >= x0 && X < x1 && Y >= y0 && Y < y1;
const C = (cx, cy, r) => (X, Y) => (X - cx) ** 2 + (Y - cy) ** 2 <= r * r;
const E = (cx, cy, rx, ry) => (X, Y) => ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 <= 1;
const RING = (cx, cy, r0, r1) => (X, Y) => { const d = Math.hypot(X - cx, Y - cy); return d >= r0 && d <= r1; };
const P = (pts) => (X, Y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
    if ((yi > Y) !== (yj > Y) && X < ((xj - xi) * (Y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const segDist = (X, Y, [ax, ay], [bx, by]) => {
  const vx = bx - ax; const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((X - ax) * vx + (Y - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(X - (ax + t * vx), Y - (ay + t * vy));
};
const L = (pts, w) => (X, Y) => { for (let i = 0; i < pts.length - 1; i++) if (segDist(X, Y, pts[i], pts[i + 1]) <= w / 2) return true; return false; };
const AND = (...fs) => (X, Y) => fs.every((f) => f(X, Y));
const OR = (...fs) => (X, Y) => fs.some((f) => f(X, Y));
const NOT = (f) => (X, Y) => !f(X, Y);
const starPts = (cx, cy, R1, R2, n, rot = -Math.PI / 2) => Array.from({ length: n * 2 }, (_, i) => {
  const a = rot + (i * Math.PI) / n; const r = i % 2 ? R2 : R1;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
});
const polar = (cx, cy, fn) => (X, Y) => fn(Math.hypot(X - cx, Y - cy), Math.atan2(Y - cy, X - cx));

/**
 * Icon shapes. Materials: m / s / a = auto-shaded families from `fam`; 'm.l' 'm.b' 'm.d' force a tone;
 * 'w' white, 'k' ink detail; null clears. Each draw(p) paints in order.
 */
export const ICONS = {
  heart: { fam: { m: 'red' }, draw: (p) => { p('m', OR(C(4.4, 5, 3.3), C(9.6, 5, 3.3), P([[1.2, 5.8], [12.8, 5.8], [7, 12.8]]))); p('w', R(3, 3, 5, 5)); } },
  star: { fam: { m: 'amber' }, draw: (p) => { p('m', P(starPts(7, 7.6, 6.9, 3, 5))); p('w', R(6, 3, 7, 5)); } },
  sword: {
    fam: { m: 'steel', s: 'wood', a: 'violet' },
    draw: (p) => {
      p('m', L([[4.6, 9.4], [12.4, 1.6]], 2.9));
      p('m.l', L([[5.6, 8.0], [11.6, 2.0]], 0.7));
      p('s', L([[2, 7.6], [6.4, 12]], 2));
      p('a', L([[1.2, 12.8], [3.6, 10.4]], 2));
    }
  },
  shield: {
    fam: { m: 'cyan', s: 'steel' },
    draw: (p) => {
      p('m', P([[1.2, 2], [7, 0.6], [12.8, 2], [12.8, 7.2], [7, 13.4], [1.2, 7.2]]));
      p('s', OR(R(6.2, 3, 7.8, 10.6), R(3.6, 5, 10.4, 6.6)));
    }
  },
  bolt: { fam: { m: 'amber' }, draw: (p) => { p('m', P([[9, 0.4], [2.2, 8], [6.4, 8], [4.6, 13.6], [11.8, 5.4], [7.6, 5.4], [10.2, 0.4]])); } },
  clock: {
    fam: { m: 'green', s: 'steel' },
    draw: (p) => { p('m', C(7, 7, 6.4)); p('s.l', C(7, 7, 4.6)); p('k', OR(R(6.4, 3.2, 7.6, 7.6), R(6.4, 6.4, 10, 7.6))); }
  },
  hourglass: {
    fam: { m: 'steel', s: 'wood', a: 'amber' },
    draw: (p) => {
      p('m', P([[3, 2.2], [11, 2.2], [7.8, 7], [11, 11.8], [3, 11.8], [6.2, 7]]));
      p('a.b', OR(P([[4.6, 3.4], [9.4, 3.4], [7, 6.2]]), P([[3.8, 11.8], [10.2, 11.8], [7, 8.8]])));
      p('s', OR(R(1.6, 0.6, 12.4, 2.4), R(1.6, 11.6, 12.4, 13.4)));
    }
  },
  crosshair: {
    fam: { m: 'red' },
    draw: (p) => {
      p('m', OR(RING(7, 7, 3.7, 5.5), R(6.2, 0.2, 7.8, 4), R(6.2, 10, 7.8, 13.8), R(0.2, 6.2, 4, 7.8), R(10, 6.2, 13.8, 7.8)));
      p('w', R(6.2, 6.2, 7.8, 7.8));
    }
  },
  lock: {
    fam: { m: 'amber', s: 'steel' },
    draw: (p) => {
      p('s', AND(RING(7, 5.4, 2.4, 4.2), (X, Y) => Y < 6.4));
      p('s', OR(R(2.8, 5, 4.6, 7), R(9.4, 5, 11.2, 7)));
      p('m', R(1.6, 6.4, 12.4, 13.4));
      p('k', OR(C(7, 9, 1.2), R(6.4, 9, 7.6, 11.6)));
    }
  },
  check: { fam: { m: 'green' }, draw: (p) => { p('m', L([[1.8, 7.4], [5.2, 10.8], [12.2, 3]], 3)); } },
  close: { fam: { m: 'steel' }, draw: (p) => { p('m', OR(L([[2.4, 2.4], [11.6, 11.6]], 2.8), L([[11.6, 2.4], [2.4, 11.6]], 2.8))); } },
  'arrow-right': { fam: { m: 'steel' }, draw: (p) => { p('m', P([[6.4, 1.2], [12.8, 7], [6.4, 12.8], [6.4, 9.2], [1.2, 9.2], [1.2, 4.8], [6.4, 4.8]])); } },
  'arrow-left': { rot: 180, base: 'arrow-right' },
  'arrow-up': { rot: 270, base: 'arrow-right' },
  'arrow-down': { rot: 90, base: 'arrow-right' },
  chevron: { fam: { m: 'cyan' }, draw: (p) => { p('m', L([[4.2, 2], [9.6, 7], [4.2, 12]], 3)); } },
  'chevron-left': { rot: 180, base: 'chevron' },
  chevrons: { fam: { m: 'cyan' }, draw: (p) => { p('m', OR(L([[1.6, 2.2], [6, 7], [1.6, 11.8]], 2.6), L([[7.4, 2.2], [11.8, 7], [7.4, 11.8]], 2.6))); } },
  gem: {
    fam: { m: 'cyan' },
    draw: (p) => {
      p('m', P([[3.6, 1.6], [10.4, 1.6], [13.2, 5.2], [7, 13], [0.8, 5.2]]));
      p('m.l', P([[3.6, 1.6], [10.4, 1.6], [13.2, 5.2], [0.8, 5.2]]));
      p('m.d', P([[7, 13], [9.4, 5.2], [13.2, 5.2]]));
      p('w', R(3.6, 2.6, 5.6, 4));
    }
  },
  'gem-amber': { base: 'gem', fam: { m: 'amber' } },
  wallet: {
    fam: { m: 'cyan', s: 'steel', a: 'violet' },
    draw: (p) => {
      p('a', L([[2.4, 3.6], [10, 1.4], [11, 3.6]], 1.6));
      p('m', R(1, 3.6, 13, 12.6));
      p('s', R(8, 6, 13.4, 10.2));
      p('k', R(9.6, 7.4, 11, 8.8));
    }
  },
  wave: {
    fam: { m: 'amber' },
    draw: (p) => {
      const zig = (y) => L([[1, y + 1.4], [3.6, y - 0.8], [7, y + 1.6], [10.4, y - 0.8], [13, y + 1.4]], 2);
      p('m', OR(zig(4.2), zig(9.4)));
    }
  },
  skull: {
    fam: { m: 'steel' },
    draw: (p) => {
      p('m', OR(C(7, 6, 5.6), R(3.6, 8.6, 10.4, 12.8)));
      p('k', OR(R(3.4, 5.4, 6, 8.2), R(8, 5.4, 10.6, 8.2), R(6.4, 8.6, 7.6, 9.8), R(5.4, 11, 6.4, 12.8), R(7.6, 11, 8.6, 12.8)));
    }
  },
  book: {
    fam: { m: 'violet', s: 'amber' },
    draw: (p) => {
      p('m', R(1.6, 1, 12.4, 13));
      p('m.d', R(1.6, 1, 3.6, 13));
      p('w', R(3.6, 11, 12.4, 12.4));
      p('s.b', R(5.6, 3.6, 10.6, 5.6));
    }
  },
  gear: {
    fam: { m: 'steel' },
    draw: (p) => {
      p('m', polar(7, 7, (r, a) => r <= 4.6 || (r <= 6.6 && Math.cos(a * 8) > 0.15)));
      p(null, C(7, 7, 1.9));
    }
  },
  speaker: {
    fam: { m: 'steel', a: 'cyan' },
    draw: (p) => {
      p('m', P([[0.8, 4.8], [4, 4.8], [7.6, 1.4], [7.6, 12.6], [4, 9.2], [0.8, 9.2]]));
      const arc = (r0, r1) => AND(RING(7.6, 7, r0, r1), (X) => X > 9.4);
      p('a', OR(arc(2.4, 3.8), arc(4.9, 6.3)));
    }
  },
  music: {
    fam: { m: 'cyan' },
    draw: (p) => {
      p('m', OR(R(4.4, 2.4, 6, 10.6), R(10.6, 1.2, 12.2, 9.4), P([[4.4, 2.4], [12.2, 1.2], [12.2, 3.4], [4.4, 4.6]]), E(3.4, 10.6, 2.4, 2), E(9.6, 9.4, 2.4, 2)));
    }
  },
  note: { base: 'music' },
  globe: {
    fam: { m: 'cyan', s: 'green' },
    draw: (p) => {
      p('m', C(7, 7, 6.3));
      p('s.b', OR(P([[3, 3.4], [6.4, 2.6], [6.6, 6.4], [4.4, 8.6], [2.4, 6.2]]), P([[8.6, 7.4], [11.6, 6.6], [11, 10.4], [8.8, 11.4]])));
      p('m.d', AND(C(7, 7, 6.3), OR((X, Y) => Math.abs(Math.hypot((X - 7) / 2.8, (Y - 7) / 6.3) - 1) < 0.14, R(0.6, 6.5, 13.4, 7.5))));
    }
  },
  flag: {
    fam: { m: 'cyan', s: 'steel', a: 'violet' },
    draw: (p) => {
      p('s', R(1, 0.6, 2.8, 13.6));
      p('m', P([[2.8, 1.2], [12.8, 1.2], [10.6, 4.2], [12.8, 7.4], [2.8, 7.4]]));
      p('a', AND(P([[2.8, 1.2], [12.8, 1.2], [10.6, 4.2], [12.8, 7.4], [2.8, 7.4]]), (X, Y) => Y >= 4.2));
    }
  },
  expand: {
    fam: { m: 'steel' },
    draw: (p) => {
      const corner = (x, y, sx, sy) => OR(R(Math.min(x, x + sx * 5), Math.min(y, y + sy * 1.8), Math.max(x, x + sx * 5), Math.max(y, y + sy * 1.8)), R(Math.min(x, x + sx * 1.8), Math.min(y, y + sy * 5), Math.max(x, x + sx * 1.8), Math.max(y, y + sy * 5)));
      p('m', OR(corner(0.6, 0.6, 1, 1), corner(13.4, 0.6, -1, 1), corner(0.6, 13.4, 1, -1), corner(13.4, 13.4, -1, -1)));
    }
  },
  fullscreen: { base: 'expand' },
  user: {
    fam: { m: 'violet' },
    draw: (p) => { p('m', OR(C(7, 4.2, 3.2), AND(E(7, 13.6, 6, 5.6), (X, Y) => Y < 13.4))); }
  },
  gamepad: {
    fam: { m: 'steel', a: 'red' },
    draw: (p) => {
      p('m', OR(R(2, 3.6, 12, 10), C(2.8, 8.8, 2.4), C(11.2, 8.8, 2.4)));
      p('k', OR(R(2.6, 6, 6.2, 7.4), R(3.7, 4.9, 5.1, 8.5)));
      p('a.b', OR(R(8.6, 5, 10, 6.4), R(10.4, 6.8, 11.8, 8.2)));
    }
  },
  crown: {
    fam: { m: 'amber', a: 'red' },
    draw: (p) => {
      p('m', P([[1, 3.2], [4.4, 6.8], [7, 1.4], [9.6, 6.8], [13, 3.2], [11.8, 12], [2.2, 12]]));
      p('m.d', R(2.2, 10.2, 11.8, 12));
      p('a.b', R(6.2, 7.6, 7.8, 9.2));
    }
  },
  bullet: {
    fam: { m: 'amber', s: 'steel' },
    draw: (p) => {
      p('s', OR(P([[4.8, 5.4], [7, 0.8], [9.2, 5.4]]), C(7, 4.6, 2.2)));
      p('m', R(4.6, 5.4, 9.4, 12));
      p('m.d', R(4.2, 12, 9.8, 13.4));
    }
  },
  reload: {
    fam: { m: 'green' },
    draw: (p) => {
      p('m', OR(AND(RING(7, 7, 3.4, 5.6), polar(7, 7, (r, a) => !(a > -1.45 && a < 0.05))), P([[9.4, 0.4], [13.6, 4.6], [8.4, 5.6]])));
    }
  },
  burst: {
    fam: { m: 'red', s: 'amber' },
    draw: (p) => { p('m', P(starPts(7, 7, 7, 3.6, 8, -Math.PI / 8))); p('s', P(starPts(7, 7, 4.2, 2.4, 8))); p('w', C(7, 7, 1.4)); }
  },
  branch: {
    fam: { m: 'violet' },
    draw: (p) => {
      p('m', OR(R(2.8, 2.4, 4.4, 11.6), L([[3.6, 10], [10.6, 6]], 1.6), L([[10.6, 5], [10.6, 6.4]], 1.6), C(3.6, 2.4, 2), C(3.6, 11.6, 2), C(10.6, 4.4, 2)));
    }
  },
  'medal-gold': {
    fam: { m: 'amber', s: 'violet', a: 'cyan' },
    draw: (p) => {
      p('s', P([[2.4, 0.4], [6, 0.4], [7.6, 6], [5, 6]]));
      p('a', P([[8, 0.4], [11.6, 0.4], [9, 6], [6.4, 6]]));
      p('m', C(7, 9, 4.6));
      p('m.d', RING(7, 9, 2.4, 3.2));
      p('w', R(4.6, 6.4, 6, 7.8));
    }
  },
  'medal-silver': { base: 'medal-gold', fam: { m: 'steel', s: 'violet', a: 'cyan' } },
  'medal-bronze': { base: 'medal-gold', fam: { m: 'bronze', s: 'violet', a: 'cyan' } },
  magnet: {
    fam: { m: 'red', s: 'steel' },
    draw: (p) => {
      p('m', AND(OR(RING(7, 7.4, 2, 5.8), R(1.2, 1, 5, 7.4), R(9, 1, 12.8, 7.4)), NOT(R(5, 0, 9, 7.4)), (X, Y) => Y >= 3.4 || X < 5 || X >= 9));
      p('s', OR(R(1.2, 0.6, 5, 3.4), R(9, 0.6, 12.8, 3.4)));
    }
  },
  trash: {
    fam: { m: 'green', s: 'steel' },
    draw: (p) => {
      p('s', OR(R(5.2, 0.6, 8.8, 2.4), R(1.4, 2, 12.6, 4)));
      p('m', P([[2.4, 4.6], [11.6, 4.6], [10.6, 13.4], [3.4, 13.4]]));
      p('m.d', OR(R(4.6, 6.2, 5.6, 11.8), R(6.5, 6.2, 7.5, 11.8), R(8.4, 6.2, 9.4, 11.8)));
    }
  },
  wrench: {
    fam: { m: 'steel' },
    draw: (p) => {
      p('m', OR(L([[3.2, 10.8], [8.4, 5.6]], 2.8), C(2.6, 11.4, 2), C(9.8, 4.2, 4)));
      p(null, OR(P([[9.2, 0], [14, 0], [14, 4.8], [11.4, 4.8], [9.2, 2.6]]), C(2.6, 11.4, 0.8)));
    }
  },
  chip: {
    fam: { m: 'slate', s: 'steel', a: 'cyan' },
    draw: (p) => {
      const pins = [];
      for (let i = 0; i < 3; i++) {
        const o = 3.6 + i * 2.6;
        pins.push(R(o, 0.4, o + 1.2, 2.4), R(o, 11.6, o + 1.2, 13.6), R(0.4, o, 2.4, o + 1.2), R(11.6, o, 13.6, o + 1.2));
      }
      p('s', OR(...pins));
      p('m', R(2.4, 2.4, 11.6, 11.6));
      p('a', P([[7.8, 3.6], [4.6, 7.6], [6.8, 7.6], [6, 10.4], [9.4, 6.4], [7.2, 6.4]]));
    }
  },
  key: {
    fam: { m: 'amber' },
    draw: (p) => {
      p('m', OR(C(4.4, 7, 3.8), R(7, 6, 13.4, 8), R(10.6, 8, 12, 10.6), R(12.4, 8, 13.4, 9.8)));
      p(null, C(4.4, 7, 1.4));
    }
  },
  bag: {
    fam: { m: 'wood', s: 'amber', a: 'cyan' },
    draw: (p) => {
      p('m', OR(E(7, 9.2, 6, 4.6), P([[4.6, 2.2], [9.4, 2.2], [8.4, 5.2], [5.6, 5.2]])));
      p('s', R(4.4, 4.6, 9.6, 5.8));
      p('a.b', P([[7, 7.4], [8.8, 9.2], [7, 11], [5.2, 9.2]]));
      p('w', R(6.6, 7.8, 7.4, 8.6));
    }
  }
};

const SHADE_TONES = { l: 'l', b: 'b', d: 'd' };

/** Resolve an icon definition (handles `base` aliases with their own rot / fam overrides). */
function resolveIcon(name) {
  const def = ICONS[name];
  if (!def) throw new Error(`unknown icon ${name}`);
  if (!def.base) return { ...def, rot: def.rot || 0 };
  const base = resolveIcon(def.base);
  return { ...base, fam: { ...base.fam, ...(def.fam || {}) }, rot: (base.rot + (def.rot || 0)) % 360 };
}

/**
 * Rasterise an icon into a size x size Grid of colours (1 px margin + ink outline).
 * opts.mono: greyscale ramps (m -> mono, s/a -> mono2) for runtime tinting.
 */
export function renderIcon(name, size, { mono = false, outline = PAL.ink, light = 'tl' } = {}) {
  const def = resolveIcon(name);
  const N = size - 2;
  const mats = new Grid(size, size);
  const rot = (def.rot * Math.PI) / 180;
  const p = (mat, pred) => {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let X = ((x + 0.5) * 14) / N; let Y = ((y + 0.5) * 14) / N;
        if (rot) {
          const dx = X - 7; const dy = Y - 7;
          X = 7 + dx * Math.cos(-rot) - dy * Math.sin(-rot);
          Y = 7 + dx * Math.sin(-rot) + dy * Math.cos(-rot);
        }
        if (pred(X, Y)) mats.set(x + 1, y + 1, mat);
      }
    }
  };
  def.draw(p);
  const fams = mono ? { m: 'mono', s: 'mono2', a: 'mono2' } : def.fam;
  const out = new Grid(size, size);
  const filled = (x, y) => mats.get(x, y) != null;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const m = mats.get(x, y);
      if (m == null) continue;
      if (m === 'w') { out.set(x, y, mono ? '#ffffff' : PAL.white); continue; }
      if (m === 'k') { out.set(x, y, PAL.ink); continue; }
      const [letter, forced] = m.split('.');
      const fam = FAM[fams[letter] || fams.m || 'steel'];
      let tone = forced ? SHADE_TONES[forced] : 'b';
      if (!forced) {
        const up = !filled(x, y - 1); const down = !filled(x, y + 1);
        const left = !filled(x - 1, y); const right = !filled(x + 1, y);
        if (up) tone = 'l';
        else if (down) tone = 'd';
        else if (light === 'tl' && left) tone = 'l';
        else if (right) tone = 'd';
      }
      out.set(x, y, fam[tone]);
    }
  }
  if (outline) {
    const base = out.c.slice();
    const at = (x, y) => (x >= 0 && y >= 0 && x < size && y < size ? base[y * size + x] : null);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (at(x, y)) continue;
        if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) out.set(x, y, outline);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- 9-slice skins
const I = PAL.ink; const N_ = PAL.night; const D = PAL.dusk; const S = PAL.slate; const W = PAL.periw; const M = PAL.mist; const Wh = PAL.white;
const raised = (f) => ({ chamfer: 1, rings: [I, { t: f.l, l: f.l, b: f.d, r: f.d }, { b: f.d }], fill: f.b });
const raisedHover = (f) => ({ chamfer: 1, rings: [I, { t: Wh, l: f.l, b: f.d, r: f.d }, { t: f.l, b: f.d }], fill: f.b });
const pressed = (f) => ({ chamfer: 1, rings: [I, { t: I, l: f.d, b: f.b, r: f.b }], fill: f.d });
const BTN_FAMS = {
  neutral: { l: M, b: S, d: D },
  primary: FAM.violet,
  cyan: { l: FAM.cyan.l, b: PAL.cyanD, d: '#0f6f8c' },
  amber: { l: FAM.amber.l, b: PAL.amberD, d: '#8a4f12' },
  green: { l: FAM.green.l, b: PAL.greenD, d: '#1c6b3a' },
  red: { l: FAM.red.l, b: PAL.redD, d: '#7a1c33' }
};
// The violet button keeps its brighter base (#a66bff reads as "primary" on the dark panels).
BTN_FAMS.primary = { l: FAM.violet.l, b: PAL.violetD, d: '#43248f' };

/** name -> { w, h, slice, spec } (all 9-slice skins; slice = corner size in art px). */
export const NINE = {
  'panel-dark': { w: 48, h: 48, slice: 12, spec: { chamfer: 2, rings: [I, { t: W, l: W, b: S, r: S }, { t: S, l: S, b: D, r: D }, I], fill: N_ } },
  'panel-light': { w: 48, h: 48, slice: 12, spec: { chamfer: 2, rings: [I, { t: S, l: S, b: N_, r: N_ }], fill: D } },
  'panel-accent': { w: 48, h: 48, slice: 12, spec: { chamfer: 2, rings: [I, { t: FAM.violet.l, l: PAL.violet, b: PAL.violetD, r: PAL.violetD }, { t: PAL.violetD, l: PAL.violetD, b: S, r: S }, I], fill: N_ } },
  card: { w: 24, h: 24, slice: 6, spec: { chamfer: 1, rings: [I, { t: S, l: S, b: N_, r: N_ }], fill: D } },
  'card-hover': { w: 24, h: 24, slice: 6, spec: { chamfer: 1, rings: [I, { t: W, l: S, b: N_, r: N_ }], fill: D } },
  'card-dim': { w: 24, h: 24, slice: 6, spec: { chamfer: 1, rings: [I, { t: D, l: D, b: N_, r: N_ }], fill: N_ } },
  'card-selected': { w: 24, h: 24, slice: 6, spec: { chamfer: 1, rings: [Wh, { t: FAM.violet.l, l: PAL.violet, b: PAL.violetD, r: PAL.violetD }, I], fill: S } },
  'card-selected-cyan': { w: 24, h: 24, slice: 6, spec: { chamfer: 1, rings: [I, { t: FAM.cyan.l, l: PAL.cyan, b: PAL.cyanD, r: PAL.cyanD }], fill: D } },
  'card-selected-amber': { w: 24, h: 24, slice: 6, spec: { chamfer: 1, rings: [I, { t: FAM.amber.l, l: PAL.amber, b: PAL.amberD, r: PAL.amberD }], fill: D } },
  tab: { w: 16, h: 16, slice: 5, spec: { chamfer: 1, rings: [I, { t: I, l: I, b: D, r: D }], fill: N_ } },
  'tab-active': { w: 16, h: 16, slice: 5, spec: raised(BTN_FAMS.primary) },
  'slider-track': { w: 12, h: 6, slice: 2, spec: { chamfer: 1, rings: [I, { t: I, b: S }], fill: N_ } },
  'progress-track': { w: 12, h: 6, slice: 2, spec: { chamfer: 1, rings: [I, { t: I, b: D }], fill: N_ } },
  keycap: { w: 16, h: 16, slice: 5, spec: { chamfer: 1, rings: [I, { t: W, l: S, b: N_, r: S }, { b: N_ }], fill: D } },
  chip: { w: 16, h: 16, slice: 5, spec: { chamfer: 1, rings: [I, { t: S, l: S, b: N_, r: N_ }], fill: N_ } },
  bubble: { w: 24, h: 24, slice: 7, spec: { chamfer: 2, rings: [I, { t: Wh, l: Wh, b: M, r: M }, { b: M }], fill: Wh } },
  well: { w: 16, h: 16, slice: 5, spec: { chamfer: 1, rings: [I, { t: I, l: I, b: S, r: S }], fill: N_ } }
};
for (const [fam, f] of Object.entries(BTN_FAMS)) {
  const k = fam === 'neutral' ? 'button' : `button-${fam}`;
  NINE[`${k}-normal`] = { w: 20, h: 20, slice: 6, spec: raised(f) };
  NINE[`${k}-hover`] = { w: 20, h: 20, slice: 6, spec: raisedHover(f) };
  NINE[`${k}-pressed`] = { w: 20, h: 20, slice: 6, spec: pressed(f) };
}
NINE['button-disabled'] = { w: 20, h: 20, slice: 6, spec: { chamfer: 1, rings: [I, { t: D, l: D, b: N_, r: N_ }], fill: N_ } };
for (const fam of ['violet', 'cyan', 'amber', 'green', 'red', 'steel']) {
  const f = FAM[fam];
  NINE[`progress-fill-${fam}`] = { w: 12, h: 6, slice: 2, spec: { chamfer: 1, rings: [I, { t: f.l, b: f.d }], fill: f.b } };
  NINE[`tile-${fam}`] = { w: 16, h: 16, slice: 5, spec: { chamfer: 1, rings: [I, { t: f.b, l: f.d, b: f.d, r: f.d }, { t: I }], fill: N_ } };
}
NINE['tile-neutral'] = { w: 16, h: 16, slice: 5, spec: { chamfer: 1, rings: [I, { t: W, l: S, b: S, r: S }, { t: I }], fill: N_ } };

/** Fixed-size sprites (not 9-sliced). */
function spriteFrames() {
  const out = {};
  // slider thumb 8x12
  const thumb = new Grid(8, 12);
  paintBox(thumb, 0, 0, 8, 12, { chamfer: 1, rings: [I, { t: Wh, l: Wh, b: W, r: W }], fill: M });
  thumb.rect(2, 4, 4, 1, W); thumb.rect(2, 6, 4, 1, W);
  out['slider-thumb'] = thumb;
  // toggles 22x12
  const tog = (on) => {
    const g = new Grid(22, 12);
    paintBox(g, 0, 0, 22, 12, on
      ? { chamfer: 2, rings: [I, { t: '#43248f', l: '#43248f', b: PAL.violet, r: PAL.violet }], fill: PAL.violetD }
      : { chamfer: 2, rings: [I, { t: I, l: I, b: S, r: S }], fill: N_ });
    const kx = on ? 11 : 1;
    paintBox(g, kx, 1, 10, 10, on
      ? { chamfer: 1, rings: [I, { t: Wh, l: Wh, b: M, r: M }], fill: Wh }
      : { chamfer: 1, rings: [I, { t: M, l: W, b: S, r: S }], fill: W });
    if (on) { g.rect(kx + 4, 4, 2, 4, PAL.violet); }
    return g;
  };
  out['toggle-off'] = tog(false);
  out['toggle-on'] = tog(true);
  // speech-bubble tail 8x8 (rows 0-2 overlap the bubble's bottom border)
  const tail = new Grid(8, 8);
  tail.rows(['wwwwwww', 'wwwwwwm', 'kwwwwmk', 'kwwwmk', 'kwwmk', 'kwmk', 'kmk', 'kk'], 0, 0, { w: Wh, m: M, k: I });
  out['bubble-tail'] = tail;
  // menu selector (pixel cursor) 7x9
  const sel = new Grid(8, 11);
  sel.rows(['k', 'kk', 'klk', 'kllk', 'klllk', 'kllbbk', 'klbbk', 'kbbk', 'kbk', 'kk', 'k'], 0, 0, { k: I, l: FAM.cyan.l, b: PAL.cyan });
  out['cursor'] = sel;
  // 1x1 white (pixel rectangles via tint)
  const px = new Grid(1, 1); px.set(0, 0, Wh); out.px = px;
  return out;
}

// ---------------------------------------------------------------- bitmap font
/** Glyph rows (top = cap top). '#' on. Lowercase/x-height glyphs include their 2 blank top rows; descenders add rows 7-8. */
const G = (s) => s.split('/');
export const FONT_GLYPHS = {
  A: G('.###./#...#/#...#/#####/#...#/#...#/#...#'), B: G('####./#...#/#...#/####./#...#/#...#/####.'),
  C: G('.###./#...#/#..../#..../#..../#...#/.###.'), D: G('####./#...#/#...#/#...#/#...#/#...#/####.'),
  E: G('#####/#..../#..../####./#..../#..../#####'), F: G('#####/#..../#..../####./#..../#..../#....'),
  G: G('.###./#...#/#..../#.###/#...#/#...#/.####'), H: G('#...#/#...#/#...#/#####/#...#/#...#/#...#'),
  I: G('###/.#./.#./.#./.#./.#./###'), J: G('..###/...#./...#./...#./#..#./#..#./.##..'),
  K: G('#...#/#..#./#.#../##.../#.#../#..#./#...#'), L: G('#.../#.../#.../#.../#.../#.../####'),
  M: G('#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#'), N: G('#...#/#...#/##..#/#.#.#/#..##/#...#/#...#'),
  O: G('.###./#...#/#...#/#...#/#...#/#...#/.###.'), P: G('####./#...#/#...#/####./#..../#..../#....'),
  Q: G('.###./#...#/#...#/#...#/#.#.#/#..#./.##.#'), R: G('####./#...#/#...#/####./#.#../#..#./#...#'),
  S: G('.####/#..../#..../.###./....#/....#/####.'), T: G('#####/..#../..#../..#../..#../..#../..#..'),
  U: G('#...#/#...#/#...#/#...#/#...#/#...#/.###.'), V: G('#...#/#...#/#...#/#...#/.#.#./.#.#./..#..'),
  W: G('#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#'), X: G('#...#/#...#/.#.#./..#../.#.#./#...#/#...#'),
  Y: G('#...#/#...#/.#.#./..#../..#../..#../..#..'), Z: G('#####/....#/...#./..#../.#.../#..../#####'),
  a: G('...../...../.###./....#/.####/#...#/.####'), b: G('#..../#..../####./#...#/#...#/#...#/####.'),
  c: G('..../..../.###/#.../#.../#.../.###'), d: G('....#/....#/.####/#...#/#...#/#...#/.####'),
  e: G('...../...../.###./#...#/#####/#..../.###.'), f: G('..##/.#../####/.#../.#../.#../.#..'),
  g: G('...../...../.####/#...#/#...#/#...#/.####/....#/.###.'), h: G('#..../#..../####./#...#/#...#/#...#/#...#'),
  i: G('#/./#/#/#/#/#'), j: G('..#/.../..#/..#/..#/..#/..#/..#/##.'),
  k: G('#.../#.../#..#/#.#./##../#.#./#..#'), l: G('#./#./#./#./#./#./.#'),
  m: G('...../...../####./#.#.#/#.#.#/#.#.#/#.#.#'), n: G('..../..../###./#..#/#..#/#..#/#..#'),
  o: G('..../..../.##./#..#/#..#/#..#/.##.'), p: G('..../..../###./#..#/#..#/#..#/###./#.../#...'),
  q: G('..../..../.###/#..#/#..#/#..#/.###/...#/...#'), r: G('..../..../#.##/##../#.../#.../#...'),
  s: G('..../..../.###/#.../.##./...#/###.'), t: G('.#../.#../####/.#../.#../.#../..##'),
  u: G('..../..../#..#/#..#/#..#/#..#/.###'), v: G('...../...../#...#/#...#/.#.#./.#.#./..#..'),
  w: G('...../...../#...#/#.#.#/#.#.#/#.#.#/.#.#.'), x: G('...../...../#...#/.#.#./..#../.#.#./#...#'),
  y: G('..../..../#..#/#..#/#..#/#..#/.###/...#/.##.'), z: G('..../..../####/...#/.##./#.../####'),
  0: G('.###./#...#/#..##/#.#.#/##..#/#...#/.###.'), 1: G('.#./##./.#./.#./.#./.#./###'),
  2: G('.###./#...#/....#/...#./..#../.#.../#####'), 3: G('####./....#/....#/.###./....#/....#/####.'),
  4: G('...#./..##./.#.#./#..#./#####/...#./...#.'), 5: G('#####/#..../####./....#/....#/#...#/.###.'),
  6: G('.###./#..../#..../####./#...#/#...#/.###.'), 7: G('#####/....#/...#./..#../..#../..#../..#..'),
  8: G('.###./#...#/#...#/.###./#...#/#...#/.###.'), 9: G('.###./#...#/#...#/.####/....#/....#/.###.'),
  ',': G('./././././././#/#'), ':': G('./././#/././#'), ';': G('./././#/././#/#'),
  '!': G('#/#/#/#/#/./#'), '?': G('.###./#...#/....#/...#./..#../...../..#..'),
  '-': G('.../.../.../###'), '+': G('.../.../.#./###/.#.'), '=': G('.../.../###/.../###'),
  '_': G('..../..../..../..../..../..../..../####'), '/': G('..#/..#/.#./.#./.#./#../#..'),
  '\\': G('#../#../.#./.#./.#./..#/..#'), "'": G('#/#'), '"': G('#.#/#.#'), '`': G('#./.#'),
  '(': G('.#/#./#./#./#./#./.#'), ')': G('#./.#/.#/.#/.#/.#/#.'), '[': G('##/#./#./#./#./#./##'), ']': G('##/.#/.#/.#/.#/.#/##'),
  '{': G('.##/.#./.#./#../.#./.#./.##'), '}': G('##./.#./.#./..#/.#./.#./##.'),
  '%': G('##..#/##.#./...#./..#../.#.../.#.##/#..##'), '#': G('...../.#.#./#####/.#.#./#####/.#.#./.....'),
  '*': G('.../#.#/.#./#.#'), '<': G('...#/..#./.#../#.../.#../..#./...#'), '>': G('#.../.#../..#./...#/..#./.#../#...'),
  '&': G('.##../#..#./#.#../.#.../#.#.#/#..#./.##.#'), '@': G('.###./#...#/#.###/#.#.#/#.###/#..../.###.'),
  $: G('..#../.####/#.#../.###./..#.#/####./..#..'), '~': G('...../...../.##.#/#.##.'), '|': G('#/#/#/#/#/#/#'), '^': G('.#./#.#'),
  'á': G('...#./..#../.###./....#/.####/#...#/.####'), 'é': G('...#./..#../.###./#...#/#####/#..../.###.'),
  'í': G('.#/#./.#/.#/.#/.#/.#'), 'ó': G('..#./.#../.##./#..#/#..#/#..#/.##.'), 'ú': G('..#./.#../#..#/#..#/#..#/#..#/.###'),
  'ü': G('#..#/..../#..#/#..#/#..#/#..#/.###'), 'ñ': G('.#.#/#.#./###./#..#/#..#/#..#/#..#'),
  '¡': G('./././#/./#/#/#/#'), '¿': G('...../...../..#../...../..#../.#.../#...#/.###.'),
  '…': G('...../...../...../...../...../...../#.#.#'), '·': G('./././#'), '—': G('...../...../...../#####'), '–': G('..../..../..../####'),
  '×': G('...../#...#/.#.#./..#../.#.#./#...#'), '▶': G('#.../##../###./####/###./##../#...'), '◀': G('...#/..##/.###/####/.###/..##/...#'),
  '→': G('...../..#../...#./#####/...#./..#..'), '←': G('...../..#../.#.../#####/.#.../..#..'),
  '↑': G('..#../.###./#.#.#/..#../..#../..#../..#..'), '↓': G('..#../..#../..#../..#../#.#.#/.###./..#..'),
  '≥': G('#.../.#../..#./.#../#.../..../####'), '≤': G('..#./.#../#.../.#../..#./..../####'),
  '★': G('..#../..#../#####/.###./.#.#./#...#'), '♪': G('..##/..#./..#./..#./.##./###./.#..'), '✓': G('....#/...#./#.#../.#...')
};
FONT_GLYPHS['.'] = G('././././././#'); // 7 rows: dot on the baseline
FONT_GLYPHS['✕'] = FONT_GLYPHS['×'];
export const FONT = { size: 8, lineHeight: 10, base: 7, spaceAdvance: 3 };

function buildFont() {
  const entries = Object.entries(FONT_GLYPHS).map(([ch, rows]) => ({ ch, rows, w: Math.max(...rows.map((r) => r.length)), h: rows.length }));
  const cols = 16; const cellW = 7; const cellH = 10;
  const rowsN = Math.ceil(entries.length / cols);
  const g = new Grid(cols * cellW, rowsN * cellH);
  const chars = [];
  entries.forEach((e, i) => {
    const x = (i % cols) * cellW; const y = Math.floor(i / cols) * cellH;
    e.rows.forEach((row, ry) => [...row].forEach((c, rx) => { if (c === '#') g.set(x + rx, y + ry, PAL.white); }));
    chars.push({ id: e.ch.codePointAt(0), x, y, w: e.w, h: e.h, adv: e.w + 1 });
  });
  chars.push({ id: 32, x: 0, y: 0, w: 0, h: 0, adv: FONT.spaceAdvance });
  chars.push({ id: 160, x: 0, y: 0, w: 0, h: 0, adv: FONT.spaceAdvance });
  const xml = [
    '<?xml version="1.0"?>',
    '<font>',
    `  <info face="pixel" size="${FONT.size}" bold="0" italic="0" padding="0,0,0,0" spacing="0,0"/>`,
    `  <common lineHeight="${FONT.lineHeight}" base="${FONT.base}" scaleW="${g.w}" scaleH="${g.h}" pages="1" packed="0"/>`,
    '  <pages><page id="0" file="pixel.png"/></pages>',
    `  <chars count="${chars.length}">`,
    ...chars.map((c) => `    <char id="${c.id}" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" xoffset="0" yoffset="0" xadvance="${c.adv}" page="0" chnl="15"/>`),
    '  </chars>',
    '</font>',
    ''
  ].join('\n');
  return { grid: g, xml, chars: entries.map((e) => e.ch) };
}

// ---------------------------------------------------------------- atlas packing (shelf, 1 px extrude, 2 px gap)
function extrudeInto(atlas, src, ox, oy) {
  atlas.blit(src, ox, oy);
  for (let x = 0; x < src.w; x++) { atlas.set(ox + x, oy - 1, src.get(x, 0)); atlas.set(ox + x, oy + src.h, src.get(x, src.h - 1)); }
  for (let y = -1; y <= src.h; y++) {
    const yy = Math.max(0, Math.min(src.h - 1, y));
    atlas.set(ox - 1, oy + y, src.get(0, yy)); atlas.set(ox + src.w, oy + y, src.get(src.w - 1, yy));
  }
}

function pack(frames, width = 512) {
  const order = [...frames].sort((a, b) => b.grid.h - a.grid.h || a.name.localeCompare(b.name));
  let x = 2; let y = 2; let shelfH = 0;
  const placed = [];
  for (const f of order) {
    if (x + f.grid.w + 2 > width) { x = 2; y += shelfH + 3; shelfH = 0; }
    placed.push({ ...f, x, y });
    x += f.grid.w + 3;
    shelfH = Math.max(shelfH, f.grid.h);
  }
  const H = y + shelfH + 2;
  const atlas = new Grid(width, H);
  placed.forEach((f) => extrudeInto(atlas, f.grid, f.x, f.y));
  const json = {
    frames: Object.fromEntries(placed.sort((a, b) => a.name.localeCompare(b.name)).map((f) => [f.name, {
      frame: { x: f.x, y: f.y, w: f.grid.w, h: f.grid.h }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.grid.w, h: f.grid.h }, sourceSize: { w: f.grid.w, h: f.grid.h }
    }])),
    meta: { app: 'scripts/assets/gen-ui.mjs', image: 'ui-pixel.png', format: 'RGBA8888', size: { w: width, h: H }, scale: '1' }
  };
  return { atlas, json };
}

export const ICON_NAMES = Object.keys(ICONS);

export function buildUiFrames() {
  const frames = [];
  for (const [name, n] of Object.entries(NINE)) {
    const g = new Grid(n.w, n.h);
    paintBox(g, 0, 0, n.w, n.h, n.spec);
    frames.push({ name, grid: g });
  }
  for (const [name, g] of Object.entries(spriteFrames())) frames.push({ name, grid: g });
  for (const name of ICON_NAMES) {
    frames.push({ name: `ui-${name}`, grid: renderIcon(name, 16) });
    frames.push({ name: `ui-${name}-24`, grid: renderIcon(name, 24) });
    frames.push({ name: `ui-${name}-m`, grid: renderIcon(name, 16, { mono: true }) });
    frames.push({ name: `ui-${name}-24-m`, grid: renderIcon(name, 24, { mono: true }) });
  }
  return frames;
}

async function main() {
  const SHEET = process.argv.includes('--sheet');
  mkdirSync(OUT, { recursive: true });
  const frames = buildUiFrames();
  const { atlas, json } = pack(frames);
  writeFileSync(join(OUT, 'ui-pixel.png'), await gridToPng(atlas));
  writeFileSync(join(OUT, 'ui-pixel.json'), `${JSON.stringify(json, null, 1)}\n`);

  const font = buildFont();
  writeFileSync(join(OUT, 'pixel.png'), await gridToPng(font.grid));
  writeFileSync(join(OUT, 'pixel.xml'), font.xml);

  const dither = new Grid(2, 2);
  dither.set(0, 0, PAL.white); dither.set(1, 1, PAL.white);
  writeFileSync(join(OUT, 'ui-dither.png'), await gridToPng(dither));

  const manifest = {
    generator: 'scripts/assets/gen-ui.mjs',
    atlas: { key: 'ui-pixel', image: 'ui-pixel.png', data: 'ui-pixel.json' },
    font: { key: 'pixel', image: 'pixel.png', data: 'pixel.xml', ...FONT, chars: font.chars.join('') },
    dither: { key: 'ui-dither', image: 'ui-dither.png' },
    nine: Object.fromEntries(Object.entries(NINE).map(([k, n]) => [k, { w: n.w, h: n.h, slice: n.slice }])),
    sprites: Object.keys(spriteFrames()),
    icons: ICON_NAMES,
    palette: PAL
  };
  writeFileSync(join(OUT, 'ui-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);

  if (SHEET) {
    const sheetDir = join(ROOT, 'scripts/evil-player/reports');
    mkdirSync(sheetDir, { recursive: true });
    const bg = new Grid(atlas.w, atlas.h + font.grid.h + 8);
    bg.rect(0, 0, bg.w, bg.h, '#262a40');
    bg.blit(atlas, 0, 0);
    bg.blit(font.grid, 0, atlas.h + 4);
    writeFileSync(join(sheetDir, 'ui-sheet.png'), await gridToPng(bg, 3));
    process.stdout.write(`sheet -> ${join(sheetDir, 'ui-sheet.png')}\n`);
  }
  process.stdout.write(`ui atlas ${json.meta.size.w}x${json.meta.size.h}: ${Object.keys(json.frames).length} frames, ${ICON_NAMES.length} icons, font ${font.chars.length} glyphs\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { process.stderr.write(`${e?.stack || e}\n`); process.exit(1); });
}
