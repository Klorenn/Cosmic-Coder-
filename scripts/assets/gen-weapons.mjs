#!/usr/bin/env node
/**
 * Deterministic PIXEL-ART generator for weapon art v2 (Vampire Survivors / Celeste style).
 *
 *   node scripts/assets/gen-weapons.mjs           # write every PNG in public/assets/sprites/weapons
 *   node scripts/assets/gen-weapons.mjs --sheet   # also scripts/evil-player/reports/weapons-sheet.png (2x)
 *
 * Every sprite is drawn on a small pixel grid (hard pixels, no antialiasing, no gradients):
 * limited ramp per weapon (outline, dark, mid, light, highlight, white), automatic 1px dark outline
 * and 1-2 rings of light pixel glow. Grids are nearest-upscaled into the PNG so in-world sizes and
 * hitboxes stay what ArenaScene expects:
 *   x2  projectiles, swings, orbs, auras, beams, drops, slash   (e.g. 24x24 art -> 48x48 texture)
 *   x3  weapon-icon-<id>                                         (32x32 art -> 96x96)
 *   x1  legendaries (match the hand-made 32px Hunter's Warglaive)
 * Sizes / frame counts come from src/scenes/boot/weaponAssets.js; colours from src/data/weapons.js.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPONS, EVOLUTION_RECIPES } from '../../src/data/weapons.js';
import { WEAPON_SHEETS, WEAPON_IMAGES } from '../../src/scenes/boot/weaponAssets.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = join(ROOT, 'public/assets');
const SHEET = process.argv.includes('--sheet');
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ colour
const toHex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
const mix = (a, b, k) => {
  const A = rgb(a);
  const B = rgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
};
const COLORS = {
  ...Object.fromEntries(Object.entries(WEAPONS).map(([id, w]) => [id, toHex(w.color)])),
  ...Object.fromEntries(Object.values(EVOLUTION_RECIPES).map((r) => [r.result, toHex(r.color)]))
};
const EVOLVED = new Set(Object.values(EVOLUTION_RECIPES).map((r) => r.result));
const INK = '#0d0717';
/** Ramp: o outline, d dark, m mid (weapon colour), l light, h highlight, w white, g glow. */
const luma = (c) => { const [r, g, b] = rgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
/** Very light weapon colours (sword, blizzard, frost) get a cool steel mid-tone so the ramp keeps contrast. */
const ramp = (c) => {
  const pale = luma(c) > 0.82;
  const m = pale ? mix(c, '#64748b', 0.45) : c;
  return { o: mix(c, INK, 0.82), d: mix(m, '#1b1033', 0.5), m, l: pale ? mix(c, '#cbd5e1', 0.35) : mix(c, '#ffffff', 0.45), h: mix(c, '#ffffff', 0.8), w: '#ffffff', g: mix(c, '#ffffff', 0.35) };
};
const GOLD = '#fbbf24';
const FIRE = { y: '#fde047', w: '#fffbeb' };

// ------------------------------------------------------------------ deterministic noise
function rng(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ pixel grid
class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.c = new Array(w * h).fill(null); // '#rrggbb' or '#rrggbbaa'
    this.T = [1, 0, 0, 1, 0, 0];
  }
  /** Transform: translate(tx,ty) rotate(deg) scale(k) translate(-ox,-oy). */
  xf(tx, ty, deg, k = 1, ox = 0, oy = 0) {
    const c = Math.cos(deg * DEG) * k;
    const s = Math.sin(deg * DEG) * k;
    this.T = [c, s, -s, c, tx - c * ox + s * oy, ty - s * ox - c * oy];
    return this;
  }
  reset() { this.T = [1, 0, 0, 1, 0, 0]; return this; }
  get k() { return Math.hypot(this.T[0], this.T[1]); }
  map(x, y) { const [a, b, c, d, e, f] = this.T; return [a * x + c * y + e, b * x + d * y + f]; }
  put(x, y, col) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.c[y * this.w + x] = col;
  }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.c[y * this.w + x]; }
  px(x, y, col) { const [X, Y] = this.map(x + 0.5, y + 0.5); this.put(X, Y, col); return this; }
  poly(pts, col) {
    const P = pts.map(([x, y]) => this.map(x, y));
    const xs = P.map((p) => p[0]);
    const ys = P.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(this.h - 1, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(this.w - 1, Math.ceil(Math.max(...xs))); x++) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        let inside = false;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
          const [xi, yi] = P[i];
          const [xj, yj] = P[j];
          if ((yi > cy) !== (yj > cy) && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.put(x, y, col);
      }
    }
    return this;
  }
  rect(x, y, w, h, col) { return this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], col); }
  discRaw(X, Y, R, col, Ri = -1) {
    for (let y = Math.floor(Y - R - 1); y <= Math.ceil(Y + R + 1); y++) {
      for (let x = Math.floor(X - R - 1); x <= Math.ceil(X + R + 1); x++) {
        const d = (x + 0.5 - X) ** 2 + (y + 0.5 - Y) ** 2;
        if (d <= R * R && d > Ri * Ri * Math.sign(Ri + 1e-9)) this.put(x, y, col);
      }
    }
  }
  disc(x, y, r, col) { const [X, Y] = this.map(x, y); this.discRaw(X, Y, r * this.k, col); return this; }
  ring(x, y, r, th, col) { const [X, Y] = this.map(x, y); this.discRaw(X, Y, r * this.k, col, Math.max(0, (r - th) * this.k)); return this; }
  line(x0, y0, x1, y1, col, w = 1) {
    const [X0, Y0] = this.map(x0, y0);
    const [X1, Y1] = this.map(x1, y1);
    const W = w * this.k;
    const n = Math.max(1, Math.ceil(Math.hypot(X1 - X0, Y1 - Y0) * 2));
    for (let i = 0; i <= n; i++) {
      const X = X0 + ((X1 - X0) * i) / n;
      const Y = Y0 + ((Y1 - Y0) * i) / n;
      if (W <= 1.25) this.put(X, Y, col);
      else this.discRaw(X, Y, W / 2, col);
    }
    return this;
  }
  pline(pts, col, w = 1) { for (let i = 1; i < pts.length; i++) this.line(...pts[i - 1], ...pts[i], col, w); return this; }
  /** 5-pixel plus sparkle (+ optional longer arms). */
  plus(x, y, col, arm = 1, center = '#ffffff') {
    for (let i = 1; i <= arm; i++) { this.px(x + i, y, col); this.px(x - i, y, col); this.px(x, y + i, col); this.px(x, y - i, col); }
    this.px(x, y, center);
    return this;
  }
  /** Copy another grid onto this one at (ox, oy) (non-null pixels win). */
  blit(src, ox, oy) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const c = src.c[y * src.w + x]; if (c) this.put(ox + x, oy + y, c); }
    return this;
  }
}

/** 1px dark outline (8-neighbour) + light glow rings (4-neighbour, translucent hard pixels). */
function finish(g, { outline = INK, glow = null, rings = 1, alphas = ['99', '44'] } = {}) {
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const N4 = N8.slice(0, 4);
  const grow = (col, nb) => {
    const add = [];
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (g.get(x, y)) continue;
      if (nb.some(([dx, dy]) => g.get(x + dx, y + dy))) add.push([x, y]);
    }
    add.forEach(([x, y]) => g.put(x, y, col));
  };
  if (outline) grow(outline, N8);
  if (glow) for (let i = 0; i < rings; i++) grow(`${glow}${alphas[i] || '33'}`, N4);
  return g;
}

function toRaw(g, s) {
  const W = g.w * s;
  const H = g.h * s;
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const c = g.c[y * g.w + x];
    if (!c) continue;
    const [r, gg, b] = rgb(c);
    const a = c.length > 7 ? parseInt(c.slice(7, 9), 16) : 255;
    for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
      const i = ((y * s + yy) * W + x * s + xx) * 4;
      buf[i] = r; buf[i + 1] = gg; buf[i + 2] = b; buf[i + 3] = a;
    }
  }
  return { buf, W, H };
}
const pngOf = ({ buf, W, H }) => sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();

// ------------------------------------------------------------------ shared pixel motifs
/** Plasma comet pointing +x, head at (hx, cy). */
function comet(g, p, hx, cy, len, h, fr) {
  const L = len * [1, 1.25, 0.9, 1.15][fr];
  g.poly([[hx - L, cy], [hx, cy - h], [hx, cy + h + 1]], p.d);
  g.poly([[hx - L * 0.7, cy], [hx, cy - h * 0.7], [hx, cy + h * 0.7 + 1]], p.m);
  g.poly([[hx - L * 0.4, cy], [hx, cy - h * 0.4], [hx, cy + h * 0.4 + 1]], p.l);
  g.disc(hx, cy + 0.5, h + 0.4, p.m);
  g.disc(hx + 0.3, cy + 0.5, h * 0.7, p.l);
  g.disc(hx + 0.6, cy + 0.5, h * 0.4, p.h);
  g.px(hx, cy, p.w);
  if (fr % 2 === 1) g.plus(Math.round(hx + h + 1), cy, p.h, 1, p.w);
}
function dustPx(g, seed, cx, cy, r0, r1, n, col, fr) {
  const R = rng(`${seed}${fr}`);
  for (let i = 0; i < n; i++) {
    const a = R() * TAU;
    const r = r0 + R() * (r1 - r0);
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    if (R() < 0.35) g.plus(x, y, col, 1, '#ffffff');
    else g.px(x, y, col);
  }
}
function jag(seed, x0, y0, x1, y1, n, amp) {
  const R = rng(seed);
  const pts = [[x0, y0]];
  for (let i = 1; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n + (R() - 0.5) * 2 * amp]);
  pts.push([x1, y1]);
  return pts;
}

// ------------------------------------------------------------------ projectiles (art units; point +x)
const PROJ = {
  slash: (g, p, fr, W, H) => comet(g, p, 13, 9, 11, 3, 0),
  basic: (g, p, fr, W, H) => comet(g, p, 16, H / 2 - 1, 13, 3.5, fr),
  rapid: (g, p, fr, W, H) => comet(g, p, 15, H / 2 - 1, 9, 2.4, fr),
  bullethell: (g, p, fr, W, H) => { comet(g, p, 15, H / 2 - 1, 10, 3, fr); dustPx(g, 'bh', 14, H / 2, 6, 8, 2, p.h, fr); },

  spread: (g, p, fr, W, H) => {
    const cy = H / 2;
    const dx = [0, 1, 0, -1][fr];
    g.poly([[21 + dx, cy], [9 + dx, cy - 6], [12 + dx, cy], [9 + dx, cy + 6]], p.m);
    g.poly([[20 + dx, cy], [12 + dx, cy - 3], [14 + dx, cy], [12 + dx, cy + 3]], p.l);
    g.line(14 + dx, cy, 19 + dx, cy, p.w);
    for (let x = 2; x < 10; x += 2) if ((x / 2 + fr) % 3 !== 0) g.px(x + dx, cy - 0.5, p.d);
  },

  pierce: (g, p, fr, W, H) => {
    const cy = H / 2;
    g.poly([[23, cy], [14, cy - 2], [1, cy], [14, cy + 2]], p.m);
    g.poly([[22, cy], [14, cy - 1], [6, cy], [14, cy + 1]], p.l);
    g.line(10, cy - 0.5, 21, cy - 0.5, p.w);
    g.plus(4 + fr * 5, Math.floor(cy) - 1, p.h, 1, p.w);
  },

  homing: (g, p, fr, W, H, o = {}) => {
    const k = o.k || 1;
    const cy = H / 2;
    g.xf(o.tx || 0, cy, 0, k, 0, 12);
    const flame = [7, 10, 6, 9][fr];
    g.poly([[10 - flame, 12], [10, 9.5], [10, 14.5]], p.m);
    g.poly([[10 - flame * 0.65, 12], [10, 10.5], [10, 13.5]], FIRE.y);
    g.poly([[10 - flame * 0.3, 12], [10, 11.2], [10, 12.8]], FIRE.w);
    g.poly([[10, 9], [13, 9], [10, 5 + (fr % 2)]], p.d);
    g.poly([[10, 15], [13, 15], [10, 19 - (fr % 2)]], p.d);
    g.rect(10, 9.5, 9, 5, p.m);
    g.rect(10, 10.5, 9, 1, p.h);
    g.poly([[19, 9.5], [23, 12], [19, 14.5]], p.l);
    g.px(17, 12, p.o);
    g.reset();
    if (o.evo) dustPx(g, 'sm', W - 8, H / 2, 6, 7, 3, p.h, fr);
  },
  seekingmissile: (g, p, fr, W, H) => PROJ.homing(g, p, fr, W, H, { k: 1.25, tx: 1, evo: true }),

  bounce: (g, p, fr, W, H, o = {}) => {
    const c = W / 2;
    const r = o.r || 5;
    const rings = o.rings || 1;
    const ringPts = (j, front) => {
      const pts = [];
      for (let s = 0; s < 64; s++) {
        const a = (s / 64) * TAU;
        if ((Math.sin(a) > 0) !== front) continue;
        const ex = Math.cos(a) * (r + 4);
        const ey = Math.sin(a) * (r * 0.45);
        const rot = (fr * 45 + j * 70 + 20) * DEG;
        pts.push([c + ex * Math.cos(rot) - ey * Math.sin(rot), c + ex * Math.sin(rot) + ey * Math.cos(rot)]);
      }
      return pts;
    };
    for (let j = 0; j < rings; j++) ringPts(j, false).forEach(([x, y]) => g.put(x, y, p.d));
    g.disc(c, c, r, p.m);
    g.disc(c - 1, c - 1, r * 0.6, p.l);
    g.px(c - 3, c - 3, p.w);
    g.px(c - 2, c - 3, p.h);
    for (let j = 0; j < rings; j++) ringPts(j, true).forEach(([x, y]) => g.put(x, y, p.h));
    if (o.evo) dustPx(g, 'cb', c, c, r + 5, r + 6, 3, p.h, fr);
  },
  chaosbounce: (g, p, fr, W, H) => PROJ.bounce(g, p, fr, W, H, { r: 5.5, rings: 2, evo: true }),

  freeze: (g, p, fr, W, H) => {
    const cy = H / 2;
    g.poly([[23, cy], [14, cy - 4], [7, cy - 3], [2, cy], [7, cy + 3], [14, cy + 4]], p.m);
    g.poly([[23, cy], [14, cy - 4], [7, cy - 3], [2, cy]], p.l);
    g.line(14, cy + 3, 20, cy + 1, p.d);
    g.line(5, cy - 0.5, 19, cy - 0.5, p.w);
    g.line(15, cy - 4, 12, cy - 1, p.h);
    const sp = [[16, cy - 7], [9, cy + 6], [18, cy + 5], [8, cy - 7]][fr];
    g.plus(sp[0], Math.round(sp[1]), p.h, 1, p.w);
  },

  rmrf: (g, p, fr, W, H) => {
    const c = W / 2;
    g.xf(c, c, fr * 22.5, 1, 0, 0);
    g.line(-7, -7, 7, 7, p.d, 3.2).line(7, -7, -7, 7, p.d, 3.2);
    g.line(-6, -6, 6, 6, p.m, 2.2).line(6, -6, -6, 6, p.m, 2.2);
    g.line(-5, -5, 5, 5, p.h, 1).line(5, -5, -5, 5, p.h, 1);
    g.reset();
    g.px(c - 1, c - 1, p.w);
  },

  sudo: (g, p, fr, W, H) => {
    const cy = H / 2;
    const pts = jag(`sudo${fr}`, 2, cy, 20, cy, 5, 3.5);
    g.pline(pts, p.m, 2.4);
    g.pline(pts, p.h, 1);
    g.disc(20, cy, 2.6, p.l);
    g.plus(20, Math.floor(cy), p.h, fr % 2 ? 2 : 1, p.w);
  },

  forkbomb: (g, p, fr, W, H) => {
    const c = W / 2;
    for (let i = 0; i < 3; i++) {
      const a = TAU * (i / 3) + fr * 30 * DEG;
      const x = c + Math.cos(a) * 5;
      const y = c + Math.sin(a) * 5;
      g.line(c, c, x, y, p.d);
      g.disc(x, y, 3.2, p.m);
      g.disc(x - 0.6, y - 0.6, 1.8, p.l);
      g.px(x - 1.5, y - 1.5, p.w);
    }
    g.disc(c, c, 1.5, p.h);
  },

  boomerang: (g, p, fr, W, H) => {
    const c = W / 2;
    g.xf(c, c, fr * 90, 1, 0, 0);
    g.poly([[-7, -8], [-3, -8], [5, 0], [-3, 8], [-7, 8], [0, 0]], p.m);
    g.poly([[-6, -8], [-4, -8], [3, 0], [0, 0]], p.l);
    g.line(-5, -7, 3, 0, p.h);
    g.reset();
  },

  kunai: (g, p, fr, W, H) => {
    const cy = H / 2;
    g.poly([[22, cy], [16, cy - 3.5], [13, cy], [16, cy + 3.5]], p.l);
    g.poly([[22, cy], [16, cy - 3.5], [13, cy]], p.h);
    g.line(14, cy - 0.5, 21, cy - 0.5, p.w);
    g.rect(7, cy - 1, 6, 2, p.d);
    g.px(9, cy - 1, p.m); g.px(11, cy, p.m);
    g.ring(5, cy, 2.4, 1.2, p.m);
    for (let i = 0; i < [2, 3, 1, 3][fr]; i++) g.px(1 - i + 2, cy + (i % 2 ? 2 : -2), p.d);
  },

  laserbeam: (g, p, fr, W, H) => {
    const cy = H / 2;
    const th = [3, 4, 3, 5][fr];
    g.poly([[2, cy], [8, cy - th], [42, cy - th], [42, cy + th], [8, cy + th]], p.d);
    g.poly([[4, cy], [9, cy - th + 1], [42, cy - th + 1], [42, cy + th - 1], [9, cy + th - 1]], p.m);
    g.rect(8, cy - 1, 34, 2, p.l);
    g.rect(12, cy - 0.5, 30, 1, p.w);
    g.disc(42, cy, th + 0.6, p.l);
    g.disc(42.5, cy, th * 0.55, p.w);
    g.plus(43, Math.floor(cy), p.h, fr % 2 ? 3 : 2, p.w);
    for (let i = 0; i < 3; i++) g.px(12 + ((i * 11 + fr * 5) % 28), cy + (i % 2 ? th + 1 : -th - 2), p.h);
  },

  chainlightning: (g, p, fr, W, H) => {
    const cy = H / 2;
    const pts = jag(`cl${fr}`, 1, cy, 29, cy, 7, 3.5);
    const b0 = pts[3];
    const br = jag(`clb${fr}`, b0[0], b0[1], b0[0] + 7, cy + (fr % 2 ? -6 : 6), 2, 1.5);
    g.pline(pts, p.m, 2.2).pline(br, p.m, 1.4);
    g.pline(pts, p.w, 1).pline(br, p.h, 1);
    g.disc(29, cy, 2.2, p.l);
    g.px(29, cy, p.w);
  },

  icelance: (g, p, fr, W, H) => {
    const cy = H / 2;
    g.poly([[35, cy], [26, cy - 4], [5, cy - 2.5], [1, cy], [5, cy + 2.5], [26, cy + 4]], p.m);
    g.poly([[35, cy], [26, cy - 4], [5, cy - 2.5], [1, cy]], p.l);
    g.line(4, cy - 0.5, 32, cy - 0.5, p.w);
    for (let x = 9; x < 27; x += 6) g.px(x, cy + 1, p.d);
    const sx = [30, 22, 14, 26][fr];
    g.plus(sx, cy - 4, p.h, 1, p.w);
  },

  swarm: (g, p, fr, W, H) => {
    const cy = H / 2;
    const tl = [3, 5, 2, 4][fr];
    g.line(9 - tl - 2, cy - 0.5, 9, cy - 0.5, p.d);
    g.poly([[15, cy], [8, cy - 4], [10, cy], [8, cy + 4]], p.m);
    g.poly([[15, cy], [10, cy - 2], [11, cy], [10, cy + 2]], p.h);
    g.px(14, cy - 1, p.w);
  },

  gungnir: (g, p, fr, W, H) => {
    const cy = H / 2;
    g.rect(1, cy - 1, 27, 2, p.d);
    g.rect(2, cy - 1, 26, 1, p.m);
    for (let i = 0; i < 4; i++) if ((i + fr) % 2 === 0) g.px(5 + i * 6, cy - 1, p.h);
    g.rect(26, cy - 4, 2, 8, p.d);
    g.px(26, cy - 4, p.l);
    g.poly([[39, cy], [32, cy - 4], [28, cy], [32, cy + 4]], p.l);
    g.poly([[39, cy], [32, cy - 4], [28, cy]], p.h);
    g.line(30, cy - 0.5, 38, cy - 0.5, p.w);
    if (fr % 2) g.plus(36, cy - 4, p.h, 1, p.w);
  },

  ricochetblade: (g, p, fr, W, H) => {
    const c = W / 2;
    for (let i = 0; i < 3; i++) {
      g.xf(c, c, fr * 30 + i * 120, 1, 0, 0);
      g.poly([[0, -2], [4, -8], [10, -7], [11, -4], [6, -4], [2, 1]], p.m);
      g.poly([[1, -3], [4, -8], [10, -7], [6, -5]], p.l);
      g.line(4, -7, 9, -6, p.h);
    }
    g.reset();
    g.ring(c, c, 2.5, 1.2, p.d);
    g.px(c - 0.5, c - 0.5, p.w);
  },

  shurikenstorm: (g, p, fr, W, H) => {
    const c = W / 2;
    g.xf(c, c, fr * 22.5, 1, 0, 0);
    const pts = [];
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; const r = i % 2 === 0 ? 10 : 3; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    g.poly(pts, p.m);
    g.poly([[0, 0], [10, 0], [3 * Math.cos(Math.PI / 4), -3 * Math.sin(Math.PI / 4)]], p.l);
    g.poly([[0, 0], [0, -10], [-2.1, -2.1]], p.l);
    g.line(1, -0.5, 9, -0.5, p.h);
    g.reset();
    g.disc(c, c, 1.6, p.d);
    g.px(c - 0.5, c - 0.5, null);
  },

  frostbrand: (g, p, fr, W, H) => {
    const cy = H / 2;
    const th = [3, 4, 3, 5][fr];
    const R = 9;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d1 = Math.hypot(x + 0.5 - 8, y + 0.5 - cy);
      const d2 = Math.hypot(x + 0.5 - 8 + th, y + 0.5 - cy);
      if (d1 <= R && d2 > R - 0.5 && x + 0.5 >= 8 - 2) g.put(x, y, d1 > R - 1.4 ? p.h : p.l);
    }
    g.line(16, cy - 3, 17, cy + 3, p.w);
    for (let i = 0; i < 3; i++) g.plus(19 + ((i + fr) % 2), Math.round(cy - 6 + i * 6), p.l, 1, p.w);
  }
};

// ------------------------------------------------------------------ melee swings
function sector(g, p, cx, cy, R, th, a0, a1, edge = true) {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const r = Math.hypot(dx, dy);
    if (r > R || r < R - th) continue;
    const a = Math.atan2(dy, dx);
    if (a < a0 || a > a1) continue;
    const k = (a - a0) / (a1 - a0); // 0 trailing -> 1 leading
    const band = (R - r) / th; // 0 outer edge -> 1 inner
    let col = band < 0.25 && edge ? p.w : band < 0.55 ? p.l : p.m;
    if (k < 0.22) col = k < 0.1 ? p.d : p.m;
    if (k < 0.1 && band > 0.5) continue;
    g.put(x, y, col);
  }
}
const SWINGS = {
  sword: (g, p, fr, W, H) => {
    const spans = [[-70, -5], [-75, 70], [-30, 80]];
    const th = [5, 7, 4][fr];
    const [a0, a1] = spans[fr];
    sector(g, p, 13, H / 2, 15, th, a0 * DEG, a1 * DEG);
    const ex = 13 + Math.cos(a1 * DEG) * 13;
    const ey = H / 2 + Math.sin(a1 * DEG) * 13;
    g.plus(Math.round(ex), Math.round(ey), p.h, fr === 1 ? 2 : 1, p.w);
  },
  excalibur: (g, p, fr, W, H) => {
    const spans = [[-70, -5], [-80, 75], [-35, 85]];
    const th = [6, 7, 4][fr];
    const [a0, a1] = spans[fr];
    sector(g, p, 20, H / 2, 22, th, a0 * DEG, a1 * DEG);
    sector(g, ramp(GOLD), 20, H / 2, 22 - th - 1, 1, (a0 + 25) * DEG, (a1 - 10) * DEG, false);
    const ex = 20 + Math.cos(a1 * DEG) * 19;
    const ey = H / 2 + Math.sin(a1 * DEG) * 19;
    g.plus(Math.round(ex), Math.round(ey), p.h, 2, p.w);
    dustPx(g, 'ex', 20, H / 2, 22, 26, 4, p.h, fr);
  },
  spear: (g, p, fr, W, H) => {
    const cy = H / 2;
    const tip = [26, 46, 40][fr];
    for (let i = 0; i < 3; i++) g.line(2 + i * 4, cy - 4 + i * 4, tip - 18 - i * 3, cy - 4 + i * 4, p.d);
    g.rect(2, cy - 1, tip - 9, 2, p.m);
    g.rect(4, cy - 1, tip - 11, 1, p.l);
    g.poly([[tip, cy], [tip - 6, cy - 4], [tip - 9, cy], [tip - 6, cy + 4]], p.l);
    g.poly([[tip, cy], [tip - 6, cy - 4], [tip - 9, cy]], p.h);
    g.px(tip - 3, cy - 1, p.w);
    if (fr === 1) g.plus(tip + 1, cy - 1, p.h, 2, p.w);
  }
};

// ------------------------------------------------------------------ orbitals
const ORBS = {
  orbital: (g, p, fr, S) => {
    const c = S / 2;
    g.disc(c, c, 5, p.m);
    g.disc(c - 1, c - 1, 3, p.l);
    g.px(c - 3, c - 3, p.w);
    const a = fr * 90 * DEG;
    for (let i = 0; i < 3; i++) g.px(c + Math.cos(a + i * 0.45) * 3.4, c + Math.sin(a + i * 0.45) * 3.4, p.h);
  },
  plasmaorb: (g, p, fr, S) => {
    const c = S / 2;
    g.disc(c, c, 7, p.m);
    g.disc(c - 1, c - 1, 4.5, p.l);
    g.disc(c - 1, c - 1, 2, p.h);
    for (let k = 0; k < 3; k++) {
      const base = fr * 30 * DEG + (k * TAU) / 3;
      for (let i = 0; i < 5; i++) g.px(c + Math.cos(base + i * 0.35) * (2 + i), c + Math.sin(base + i * 0.35) * (2 + i), p.w);
    }
    dustPx(g, 'po', c, c, 9, 10.5, 3, p.h, fr);
  },
  ringoffire: (g, p, fr, S) => {
    const c = S / 2;
    const R = rng(`rf${fr}`);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + fr * 0.3;
      const L = 6 + R() * 3;
      g.poly([[c + Math.cos(a - 0.5) * 3.5, c + Math.sin(a - 0.5) * 3.5], [c + Math.cos(a) * L, c + Math.sin(a) * L], [c + Math.cos(a + 0.5) * 3.5, c + Math.sin(a + 0.5) * 3.5]], i % 2 ? p.m : p.d);
    }
    g.disc(c, c, 4.2, p.m);
    g.disc(c, c, 3, FIRE.y);
    g.disc(c - 0.5, c - 0.5, 1.6, FIRE.w);
  },
  deathaura: (g, p, fr, S) => {
    const c = S / 2;
    g.disc(c, c, 6.5, p.m);
    g.disc(c, c, 5, '#1a0526');
    g.disc(c, c, 3, p.d);
    const open = [1.6, 0.6, 1.6, 2.2][fr];
    g.rect(c - 2.5, c - open / 2, 5, open, p.h);
    g.px(c - 0.5, c - 0.5, p.w);
    for (let i = 0; i < 4; i++) { const a = fr * 22.5 * DEG + (i * TAU) / 4; g.px(c + Math.cos(a) * 8.5, c + Math.sin(a) * 8.5, p.l); }
  }
};

// ------------------------------------------------------------------ auras (art = texture / 2)
function dither(g, cx, cy, r0, r1, col, phase = 0) {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (r >= r0 && r <= r1 && (x + y + phase) % 4 === 0 && x % 2 === 0) (g.late = g.late || []).push([x, y, col]);
  }
}
const AURAS = {
  aoe: (g, p, fr, S) => {
    const c = S / 2;
    const R = [18, 32, 46, 58][fr];
    g.ring(c, c, R, [3, 3, 2, 2][fr], fr < 2 ? p.l : p.m);
    g.ring(c, c, R - 3, 1, p.d);
    if (fr < 3) g.ring(c, c, R + 1, 1, p.w);
    dither(g, c, c, R * 0.6, R - 4, `${p.m}55`, fr);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.13;
      g.line(c + Math.cos(a) * (R + 2), c + Math.sin(a) * (R + 2), c + Math.cos(a) * (R + 4 + (3 - fr)), c + Math.sin(a) * (R + 4 + (3 - fr)), p.h);
    }
  },
  blizzard: (g, p, fr, S) => {
    const c = S / 2;
    const R = 50;
    for (let d = 0; d < 360; d += 9) {
      const a = (d + fr * 4) * DEG;
      g.px(c + Math.cos(a) * (R - 6), c + Math.sin(a) * (R - 6), `${p.l}aa`);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + fr * 11.25 * DEG;
      g.xf(c + Math.cos(a) * R, c + Math.sin(a) * R, (a / DEG) + 90 + fr * 20, 1, 0, 0);
      g.poly([[0, -6], [2.5, -1], [0, 6], [-2.5, -1]], p.l);
      g.poly([[0, -6], [2.5, -1], [0, 0]], p.w);
      g.reset();
    }
    dither(g, c, c, 10, R - 8, `${p.m}40`, fr);
    dustPx(g, 'bz', c, c, 12, R + 4, 14, p.w, fr);
  },
  ringoffire: (g, p, fr, S) => {
    const c = S / 2;
    const R = 40;
    for (let d = 0; d < 360; d += 2) {
      const a = d * DEG;
      const h = 2 + Math.round(2.5 * Math.max(0, Math.sin(a * 9 + fr * TAU / 4)) + 1.5 * Math.max(0, Math.sin(a * 14 - fr * TAU / 4)));
      for (let k = -1; k <= h; k++) {
        const col = k < 0 ? p.d : k === 0 ? p.m : k < h - 1 ? FIRE.y : FIRE.w;
        g.put(c + Math.cos(a) * (R + k), c + Math.sin(a) * (R + k), k <= 0 ? col : k < 2 ? p.m : col);
      }
    }
    g.ring(c, c, R, 1, FIRE.y);
  },
  deathaura: (g, p, fr, S) => {
    const c = S / 2;
    const R = 58;
    dither(g, c, c, 20, R - 3, `${p.m}38`, fr);
    g.ring(c, c, R, 2, p.m);
    g.ring(c, c, R - 2, 1, p.d);
    for (let d = 0; d < 360; d += 1) {
      const dd = (d + fr * 8) % 30;
      if (dd < 12) g.put(c + Math.cos(d * DEG) * 50, c + Math.sin(d * DEG) * 50, p.l);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - fr * 10 * DEG;
      g.plus(Math.round(c + Math.cos(a) * 42), Math.round(c + Math.sin(a) * 42), p.l, 1, p.h);
    }
  }
};

// ------------------------------------------------------------------ beams (tileable, art 64x16)
const BEAMS = {
  laserbeam: (g, p, W, H) => {
    for (let x = 0; x < W; x++) {
      const w = Math.round(Math.sin((x / W) * TAU * 2));
      for (let y = 3 - w; y <= 12 + w; y++) {
        const d = Math.abs(y - 7.5);
        g.put(x, y, d > 3.5 + w ? p.d : d > 2 ? p.m : d > 1 ? p.l : p.w);
      }
    }
    for (let i = 0; i < 4; i++) g.plus(8 + i * 16, i % 2 ? 4 : 11, p.h, 1, p.w);
  },
  chainlightning: (g, p, W, H) => {
    const pts = jag('clbeam', 0, 8, W, 8, 8, 4);
    g.pline(pts, p.m, 2.2).pline(pts, p.w, 1);
  }
};

// ------------------------------------------------------------------ legendaries (x1)
const LEGENDARY = {
  voidReaper: (g, S) => {
    const p = ramp('#c026d3');
    // shaft
    g.line(18, 12, 9, 50, '#2e1a47', 3);
    g.line(17.5, 12, 8.5, 50, '#6d28d9', 1);
    for (let i = 0; i < 4; i++) g.px(16 - i * 2, 20 + i * 8, '#f0abfc');
    // blade (crescent)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d1 = Math.hypot(x + 0.5 - 22, y + 0.5 - 30);
      const d2 = Math.hypot(x + 0.5 - 25, y + 0.5 - 35);
      if (d1 <= 25 && d2 > 24 && y < 30 && x > 14) g.put(x, y, d1 > 23.5 ? '#f5d0fe' : d1 > 21.5 ? p.l : y < 14 ? '#581c87' : p.m);
    }
    g.disc(18, 12, 4.2, p.m);
    g.disc(18, 12, 3, '#000000');
    g.px(17, 11, '#f0abfc');
    dustPx(g, 'void', 30, 18, 14, 20, 5, '#f0abfc', 0);
    finish(g, { outline: INK, glow: '#e879f9', rings: 1 });
  },
  celestialBlade: (g, S) => {
    const c = S / 2;
    g.xf(c, c, -45, 1, 0, 0);
    g.poly([[0, -20], [4, -15], [4, 8], [0, 10], [-4, 8], [-4, -15]], '#fef3c7');
    g.poly([[0, -20], [4, -15], [4, 8], [0, 10]], GOLD);
    g.line(0, -18, 0, 8, '#ffffff');
    g.rect(-10, 9, 20, 3, '#f59e0b');
    g.rect(-10, 9, 20, 1, '#fde68a');
    g.px(-0.5, 10, '#22d3ee');
    g.rect(-1.5, 12, 3, 7, '#b45309');
    g.px(-0.5, 13, '#f59e0b'); g.px(-0.5, 16, '#f59e0b');
    g.disc(0, 21, 2.5, '#fde68a');
    g.reset();
    g.plus(36, 9, '#fef3c7', 2, '#ffffff');
    g.plus(12, 16, '#fef3c7', 1, '#ffffff');
    finish(g, { outline: '#3b1d05', glow: '#fde68a', rings: 1 });
  }
};

// ------------------------------------------------------------------ glyphs (icons + drops)
const ART = Object.fromEntries(WEAPON_SHEETS.map((s) => [`${s.kind}-${s.id}`, [s.frameWidth / 2, s.frameHeight / 2]]));
/** Sword glyph (also excalibur / frostbrand icons). */
function swordGlyph(g, p, gold = false) {
  const b = gold ? ramp('#fde68a') : p;
  g.poly([[23, 12], [19, 10], [6, 10], [6, 14], [19, 14]], b.l);
  g.poly([[23, 12], [19, 10], [6, 10], [6, 12]], b.h);
  g.line(7, 11.5, 20, 11.5, b.w);
  g.rect(4, 6, 2, 12, gold ? GOLD : p.m);
  g.rect(0, 11, 4, 2, gold ? '#b45309' : p.d);
}
const GLYPH = {
  sword: (g, p) => swordGlyph(g, p),
  excalibur: (g, p) => swordGlyph(g, p, true),
  aoe: (g, p) => { g.ring(12, 12, 10, 2, p.m); g.ring(12, 12, 6, 2, p.l); g.disc(12, 12, 2.2, p.w); },
  blizzard: (g, p) => {
    for (let i = 0; i < 3; i++) { g.xf(12, 12, i * 60, 1, 0, 0); g.line(0, -10, 0, 10, p.l, 2); g.line(-3, -7, 0, -9, p.h); g.line(3, -7, 0, -9, p.h); g.line(-3, 7, 0, 9, p.h); g.line(3, 7, 0, 9, p.h); }
    g.reset(); g.disc(12, 12, 2, p.w);
  }
};
const SPINNING = new Set(['rmrf', 'forkbomb', 'boomerang', 'bounce', 'chaosbounce', 'ricochetblade', 'shurikenstorm']);

/** Draw weapon `id` as a glyph fitted into a `size` grid (rotated -45° when elongated). */
function glyphGrid(id, size, p) {
  const g = new Grid(size, size);
  const c = size / 2;
  let w = 24;
  let h = 24;
  let draw;
  let rotate = 0;
  if (GLYPH[id]) { draw = (gg) => GLYPH[id](gg, p); rotate = ['sword', 'excalibur'].includes(id) ? -45 : 0; }
  else if (id === 'spear') { [w, h] = ART['proj-gungnir']; draw = (gg) => PROJ.gungnir(gg, p, 0, w, h); rotate = -45; }
  else if (ORBS[id]) { [w, h] = ART[`orb-${id}`]; draw = (gg) => ORBS[id](gg, p, 0, w); }
  else {
    [w, h] = ART[`proj-${id}`] || [24, 24];
    draw = (gg) => PROJ[id](gg, p, 0, w, h);
    rotate = SPINNING.has(id) ? 0 : -45;
  }
  // render at native art scale into a scratch grid, then rotate/scale by nearest sampling of the
  // drawing *commands* (transform) so the result stays hard-pixel.
  const long = Math.max(w, h);
  const fit = rotate ? (size * 1.3) / long : (size * 0.95) / long;
  const k = Math.min(fit, rotate ? 1.15 : 1.2);
  const scratch = new Grid(size, size);
  // Draw the source at its own scale into a temp grid, then map pixels through the inverse transform.
  const src = new Grid(w, h);
  draw(src);
  const cos = Math.cos(-rotate * DEG);
  const sin = Math.sin(-rotate * DEG);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5 - c) / k;
    const dy = (y + 0.5 - c) / k;
    const sx = Math.floor(dx * cos - dy * sin + w / 2);
    const sy = Math.floor(dx * sin + dy * cos + h / 2);
    const col = src.get(sx, sy);
    if (col) scratch.put(x, y, col);
  }
  g.blit(scratch, 0, 0);
  return g;
}

function iconGrid(id) {
  const S = 32;
  const col = COLORS[id];
  const p = ramp(col);
  const evo = EVOLVED.has(id);
  const g = new Grid(S, S);
  const frameHi = evo ? '#fde68a' : p.l;
  const frameLo = evo ? '#b45309' : p.d;
  const bg = mix(col, INK, 0.78);
  const bg2 = mix(col, INK, 0.68);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const corner = (x === 0 || x === S - 1) && (y === 0 || y === S - 1);
    if (corner) continue;
    const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
    if (edge) { g.put(x, y, INK); continue; }
    if (x === 1 || y === 1) { g.put(x, y, frameHi); continue; }
    if (x === S - 2 || y === S - 2) { g.put(x, y, frameLo); continue; }
    g.put(x, y, y < S / 2 ? bg2 : bg);
  }
  // corner rivets
  [[2, 2], [S - 3, 2], [2, S - 3], [S - 3, S - 3]].forEach(([x, y]) => g.put(x, y, evo ? GOLD : p.m));
  const glyph = finish(glyphGrid(id, 26, p), { outline: INK, glow: p.g, rings: 1, alphas: ['77'] });
  g.blit(glyph, 3, 3);
  if (evo) g.plus(S - 6, 5, '#fde68a', 1, '#ffffff');
  return g;
}

function dropGrid(id) {
  const p = ramp(COLORS[id]);
  const g = new Grid(20, 20);
  const glyph = glyphGrid(id, 15, p);
  g.blit(glyph, 2, 2);
  finish(g, { outline: INK, glow: p.g, rings: 1, alphas: ['88'] });
  g.plus(16, 3, p.h, 1, '#ffffff');
  return g;
}

// ------------------------------------------------------------------ render
function sheetFrame(s, fr) {
  const W = s.frameWidth / 2;
  const H = s.frameHeight / 2;
  const g = new Grid(W, H);
  const p = ramp(COLORS[s.id]);
  if (s.kind === 'proj') { PROJ[s.id](g, p, fr, W, H); finish(g, { glow: p.g, rings: EVOLVED.has(s.id) ? 2 : 1 }); }
  else if (s.kind === 'swing') { SWINGS[s.id](g, p, fr, W, H); finish(g, { glow: p.g, rings: s.id === 'excalibur' ? 2 : 1 }); }
  else if (s.kind === 'orb') { ORBS[s.id](g, p, fr, W); finish(g, { glow: p.g, rings: EVOLVED.has(s.id) ? 2 : 1 }); }
  else if (s.kind === 'aura') {
    AURAS[s.id](g, p, fr, W);
    finish(g, { outline: null, glow: p.g, rings: 1, alphas: ['55'] });
    (g.late || []).forEach(([x, y, c]) => { if (!g.get(x, y)) g.put(x, y, c); }); // sparse dither stays unglowed
  }
  else throw new Error(`unknown sheet kind ${s.kind}`);
  return g;
}

function imageGrid(i) {
  if (i.kind === 'slash') {
    const g = new Grid(i.width / 2, i.height / 2);
    const p = { o: '#2a2438', d: '#8a8aa0', m: '#c4c4d4', l: '#e6e6f0', h: '#f6f6fb', w: '#ffffff', g: '#ffffff' };
    PROJ.slash(g, p, 0);
    return { g: finish(g, { outline: '#3a3448', glow: '#ffffff', rings: 1, alphas: ['66'] }), s: 2 };
  }
  if (i.kind === 'drop') return { g: dropGrid(i.id), s: 2 };
  if (i.kind === 'icon') return { g: iconGrid(i.id), s: 3 };
  if (i.kind === 'beam') {
    const g = new Grid(i.width / 2, i.height / 2);
    BEAMS[i.id](g, ramp(COLORS[i.id]), g.w, g.h);
    // no side outline/glow: the strip must tile; outline only vertically
    const out = new Grid(g.w, g.h);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const v = g.get(x, y);
      if (v) out.put(x, y, v);
      else if (g.get(x, y - 1) || g.get(x, y + 1)) out.put(x, y, INK);
    }
    return { g: out, s: 2 };
  }
  if (i.kind === 'legendary') {
    const g = new Grid(i.width, i.height);
    LEGENDARY[i.id](g, i.width);
    return { g, s: 1 };
  }
  throw new Error(`unknown image kind ${i.kind}`);
}

async function main() {
  const outputs = [];
  mkdirSync(join(ASSETS, 'sprites/weapons'), { recursive: true });
  for (const s of WEAPON_SHEETS) {
    const W = s.frameWidth / 2;
    const strip = new Grid(W * s.frames, s.frameHeight / 2);
    for (let fr = 0; fr < s.frames; fr++) strip.blit(sheetFrame(s, fr), fr * W, 0);
    const raw = toRaw(strip, 2);
    if (raw.W !== s.frameWidth * s.frames || raw.H !== s.frameHeight) throw new Error(`${s.key}: size mismatch`);
    const buf = await pngOf(raw);
    await sharp(buf).toFile(join(ASSETS, s.file));
    outputs.push({ label: s.key, buf, w: raw.W, h: raw.H, kind: s.kind });
  }
  const written = new Set();
  for (const i of WEAPON_IMAGES) {
    if (i.handmade || written.has(i.file)) continue;
    written.add(i.file);
    const { g, s } = imageGrid(i);
    const raw = toRaw(g, s);
    if (raw.W !== i.width || raw.H !== i.height) throw new Error(`${i.key}: size mismatch ${raw.W}x${raw.H}`);
    const buf = await pngOf(raw);
    await sharp(buf).toFile(join(ASSETS, i.file));
    outputs.push({ label: i.key, buf, w: raw.W, h: raw.H, kind: i.kind });
  }
  console.log(`[gen-weapons] wrote ${WEAPON_SHEETS.length} strips + ${written.size} images (pixel art) to public/assets/sprites/weapons`);
  if (SHEET) await contactSheet(outputs);
}

async function contactSheet(outputs) {
  const SCALE = 2;
  const PAD = 10;
  const MAXW = 2400;
  const order = ['slash', 'proj', 'swing', 'orb', 'aura', 'beam', 'legendary', 'drop', 'icon'];
  const items = [...outputs].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const wg = await sharp(join(ASSETS, 'hunters-warglaive.png')).png().toBuffer();
  items.splice(items.findIndex((o) => o.kind === 'legendary'), 0, { label: 'legendary-huntersWarglaive', buf: wg, w: 32, h: 32, kind: 'legendary' });
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  let lastKind = null;
  const comps = [];
  for (const it of items) {
    const w = it.w * SCALE;
    const h = it.h * SCALE;
    if (x + w + PAD > MAXW || (lastKind && it.kind !== lastKind)) {
      x = PAD;
      y += rowH + PAD + (lastKind && it.kind !== lastKind ? 14 : 0);
      rowH = 0;
    }
    lastKind = it.kind;
    comps.push({ input: await sharp(it.buf).resize(w, h, { kernel: 'nearest' }).png().toBuffer(), left: x, top: y });
    x += w + PAD;
    rowH = Math.max(rowH, h);
  }
  const H = y + rowH + PAD;
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${MAXW}" height="${H}"><rect width="100%" height="100%" fill="#0f1426"/></svg>`;
  const out = join(ROOT, 'scripts/evil-player/reports/weapons-sheet.png');
  mkdirSync(dirname(out), { recursive: true });
  await sharp(Buffer.from(bg)).composite(comps).png().toFile(out);
  console.log(`[gen-weapons] contact sheet ${out} (${MAXW}x${H})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
