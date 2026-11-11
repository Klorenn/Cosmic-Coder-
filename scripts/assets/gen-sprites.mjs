#!/usr/bin/env node
/**
 * Cosmic Coder — pixel-art sprite generator (v2).
 *
 * Draws every enemy / mini-boss / boss / XP gem sprite on an indexed grid with a shared
 * 16-colour cyber palette, applies a 1px dark outline, and writes PNG spritesheets with sharp.
 * Also derives white "hit flash" silhouettes from the existing player sheets.
 *
 *   node scripts/assets/gen-sprites.mjs            # regenerate everything
 *   node scripts/assets/gen-sprites.mjs --only=glitch,xp-gem-blue
 *
 * Item icons (32x32, pixel kit v3) are NOT drawn here: they come from scripts/assets/gen-items.mjs.
 * The old 16x16 ITEM_DRAW section was removed so a default run never overwrites them.
 *
 * Sizes/frame counts come from src/scenes/boot/{enemyAssets,characterAssets}.js (single source
 * of truth); the script fails if a drawing does not match its manifest entry.
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENEMY_SPRITES, XP_GEM_SPRITES } from '../../src/scenes/boot/enemyAssets.js';
import { CHARACTER_HIT_SHEETS } from '../../src/scenes/boot/characterAssets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SPRITES = path.join(ROOT, 'public/assets/sprites');

// ---------------------------------------------------------------------------
// Palette (index 0 = transparent). 15 colours + transparency = 16 max per sprite.
// ---------------------------------------------------------------------------
const PAL = [
  null,
  '#0a0614', // 1 O outline
  '#1c1d40', // 2 N navy
  '#3d2266', // 3 P deep purple
  '#ff2bd6', // 4 M magenta
  '#9c1487', // 5 m magenta dark
  '#2fe6ff', // 6 C cyan
  '#137aa6', // 7 c cyan dark
  '#a6ff2e', // 8 G acid green
  '#3d9a24', // 9 g acid dark
  '#ff3355', // 10 R error red
  '#9b1431', // 11 r red dark
  '#f2f5ff', // 12 W white
  '#7f88ad', // 13 S slate
  '#ffcf3a', // 14 Y amber
  '#ff7d1f' // 15 F orange
].map((h) => (h ? [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] : null));
const [, O, N, P, M, m, C, c, G, g, R, r, W, S, Y, F] = PAL.map((_, i) => i);

// Tiny 3x5 font for glyphs on sprites.
const FONT = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  $: ['.##', '##.', '.#.', '.##', '##.'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '{': ['.##', '.#.', '##.', '.#.', '.##'],
  '}': ['##.', '.#.', '.##', '.#.', '##.']
};

// Deterministic PRNG so regenerating yields identical PNGs.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h);
  }
  get(x, y) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.d[y * this.w + x];
  }
  px(x, y, col) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = col;
    return this;
  }
  rect(x, y, w, h, col) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, col);
    return this;
  }
  ell(cx, cy, rx, ry, col, test = null) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1 && (!test || test(x, y))) this.px(x, y, col);
      }
    }
    return this;
  }
  disc(cx, cy, rad, col, test) {
    return this.ell(cx, cy, rad, rad, col, test);
  }
  ring(cx, cy, rad, th, col, test = null) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= rad && d > rad - th && (!test || test(x, y, Math.atan2(y + 0.5 - cy, x + 0.5 - cx)))) this.px(x, y, col);
      }
    }
    return this;
  }
  /** Shaded sphere: dark rim, base body, light highlight top-left. */
  ball(cx, cy, rx, ry, dark, base, light) {
    this.ell(cx, cy, rx, ry, dark);
    this.ell(cx - 0.7, cy - 0.7, rx - 1.2, ry - 1.2, base);
    if (light) this.ell(cx - rx * 0.38, cy - ry * 0.4, Math.max(1, rx * 0.28), Math.max(1, ry * 0.24), light);
    return this;
  }
  line(x0, y0, x1, y1, col, th = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      if (th === 1) this.px(x, y, col);
      else this.rect(Math.round(x - (th - 1) / 2), Math.round(y - (th - 1) / 2), th, th, col);
    }
    return this;
  }
  poly(pts, col) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i];
          const [xj, yj] = pts[j];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.px(x, y, col);
      }
    }
    return this;
  }
  text(str, x, y, col) {
    [...String(str)].forEach((ch, k) => {
      const glyph = FONT[ch];
      if (!glyph) throw new Error(`No glyph for "${ch}"`);
      glyph.forEach((row, j) => [...row].forEach((v, i) => v === '#' && this.px(x + k * 4 + i, y + j, col)));
    });
    return this;
  }
  /** Recolour every filled pixel matching `test`. */
  recolor(test, col) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.get(x, y) && test(x, y, this.get(x, y))) this.px(x, y, col);
    return this;
  }
  erase(test) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (test(x, y, this.get(x, y))) this.d[y * this.w + x] = 0;
    return this;
  }
  shiftRows(y0, y1, dx) {
    for (let y = y0; y <= y1; y++) {
      const row = this.d.slice(y * this.w, (y + 1) * this.w);
      for (let x = 0; x < this.w; x++) this.d[y * this.w + x] = row[x - dx] ?? 0;
    }
    return this;
  }
  /** RGB-split fringe: magenta on the left edge, cyan on the right edge of each row. */
  chroma(y0, y1) {
    for (let y = y0; y <= y1; y++) {
      let lo = -1;
      let hi = -1;
      for (let x = 0; x < this.w; x++) if (this.get(x, y)) { if (lo < 0) lo = x; hi = x; }
      if (lo > 0) this.px(lo - 1, y, M);
      if (hi >= 0 && hi < this.w - 1) this.px(hi + 1, y, C);
    }
    return this;
  }
  translate(dx, dy) {
    const src = this.d.slice();
    this.d.fill(0);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const v = src[y * this.w + x];
      if (v) this.px(x + dx, y + dy, v);
    }
    return this;
  }
  /** 1px dark outline around every filled region (4-neighbour). */
  outline(col = O) {
    const src = this.d.slice();
    const at = (x, y) => (x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : src[y * this.w + x]);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (at(x, y)) continue;
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) this.d[y * this.w + x] = col;
    }
    return this;
  }
}

const BOB = [0, -1, 0, 1];
const eye = (gr, x, y, px = 0, py = 0, pupil = N) => {
  gr.rect(x, y, 3, 3, W);
  gr.px(x + 1 + px, y + 1 + py, pupil);
};

// ---------------------------------------------------------------------------
// Regular enemies — 32x32
// ---------------------------------------------------------------------------
const ENEMY_DRAW = {
  glitch(gr, f) {
    // CRT monster that tears horizontally.
    gr.line(12, 8, 9, 4, S).line(19, 8, 22, 4, S).px(9, 3, M).px(22, 3, M);
    gr.rect(7, 8, 18, 16, N).rect(9, 10, 14, 10, c);
    gr.rect(9, 10, 14, 1, C);
    eye(gr, 11, 12, f % 2, 0);
    eye(gr, 18, 12, f % 2, 0);
    for (let x = 11; x <= 20; x++) gr.px(x, 17 + ((x + f) % 2), R);
    gr.rect(9, 24, 3, 4, N).rect(20, 24, 3, 4, N);
    const rand = rng(100 + f);
    for (let i = 0; i < 4; i++) gr.px(10 + Math.floor(rand() * 12), 11 + Math.floor(rand() * 8), W);
    const bands = [[11, 13], [15, 17], [19, 22], [8, 10]];
    const [y0, y1] = bands[f];
    gr.shiftRows(y0, y1, [2, -2, 3, -3][f]);
    gr.chroma(y0, y1);
  },
  'memory-leak'(gr, f) {
    const p = [0, 1, 1, 0][f];
    for (const [x, len] of [[10, 3 + f], [16, 5 - (f % 2)], [22, 2 + ((f + 2) % 4)]]) gr.rect(x, 22, 2, len + 2, m);
    gr.disc(19.5, 27 + f, 1.2, m);
    gr.ball(16, 17, 11 + p, 9 + p, P, m, M);
    eye(gr, 11, 14, 1, 1);
    eye(gr, 18, 14, 0, 1);
    gr.rect(14, 20, 4, 1, P).px(13, 19, P).px(18, 19, P);
  },
  'syntax-error'(gr, f) {
    const tri = (inset, col) => {
      for (let y = 4 + inset * 2; y <= 27 - inset; y++) {
        const hw = ((y - 4) * 12) / 23 - inset;
        if (hw >= 0) gr.rect(Math.round(16 - hw), y, Math.round(hw * 2), 1, col);
      }
    };
    tri(0, f % 2 ? F : Y);
    tri(2, R);
    tri(4, r);
    gr.rect(15, 11, 2, 8, W).rect(15, 21, 2, 2, W);
    gr.rect(9 + (f % 2), 28, 2, 2, r).rect(21 - (f % 2), 28, 2, 2, r);
    gr.translate([0, 1, 0, -1][f], 0);
  },
  'infinite-loop'(gr, f) {
    const a0 = (f * Math.PI) / 2;
    const inArc = (a) => {
      const d = (((a - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return d < Math.PI * 0.6;
    };
    gr.ring(16, 16, 13, 4, c);
    gr.ring(16, 16, 13, 4, C, (x, y, a) => inArc(a));
    const ha = a0 + Math.PI * 0.6;
    gr.disc(16 + Math.cos(ha) * 11, 16 + Math.sin(ha) * 11, 2.2, W);
    gr.disc(16, 16, 7.5, N);
    eye(gr, 11, 13, 1, 0);
    eye(gr, 18, 13, 1, 0);
    gr.rect(14, 19, 4, 1, C);
  },
  'race-condition'(gr, f) {
    const ax = [9, 13, 22, 18][f];
    const bx = [22, 18, 9, 13][f];
    const runner = (x, y, dark, base, light, dir) => {
      for (let i = 0; i < 3; i++) gr.rect(x - dir * (8 + i), y - 3 + i * 3, 3, 1, S);
      gr.ball(x, y, 6, 6, dark, base, light);
      gr.rect(x - 1 + dir * 2, y - 2, 3, 3, W).px(x + dir * 3, y - 1, N);
    };
    const back = f < 2 ? 'a' : 'b';
    const drawA = () => runner(ax, 13, c, C, W, f < 2 ? 1 : -1);
    const drawB = () => runner(bx, 20, m, M, W, f < 2 ? -1 : 1);
    if (back === 'a') { drawA(); drawB(); } else { drawB(); drawA(); }
  },
  segfault(gr, f) {
    for (let i = 0; i < 4; i++) {
      const k = 9 + i * 4;
      gr.rect(k, 3, 2, 4, S).rect(k, 25, 2, 4, S).rect(3, k, 4, 2, S).rect(25, k, 4, 2, S);
    }
    gr.rect(7, 7, 18, 18, N).rect(9, 9, 14, 14, P);
    const crack = [[8, 10], [13, 14], [11, 18], [17, 21], [24, 24]];
    const glow = [R, Y, R, F][f];
    for (let i = 0; i < crack.length - 1; i++) {
      const [x0, y0] = crack[i];
      const [x1, y1] = crack[i + 1];
      gr.line(x0, y0 + 1, x1, y1 + 1, r);
      gr.line(x0, y0, x1, y1, glow);
    }
    gr.px(19, 11, f % 2 ? R : r).px(20, 11, f % 2 ? R : r);
  },
  'dependency-hell'(gr, f) {
    const flames = [[3, 5, 2, 4], [5, 3, 4, 2], [4, 4, 3, 5], [2, 5, 4, 3]][f];
    flames.forEach((h, i) => {
      const x = 9 + i * 4;
      gr.rect(x, 29 - h, 3, h, R).rect(x + 1, 29 - Math.max(1, h - 2), 1, Math.max(1, h - 2), Y);
    });
    for (let y = 8; y <= 10; y++) gr.rect(10 - (y - 8), y, 16, 1, Y);
    for (let x = 23; x <= 25; x++) gr.rect(x, 9 + (25 - x), 1, 14, r);
    gr.rect(7, 11, 16, 14, F);
    gr.rect(14, 8, 2, 7, S);
    gr.line(9, 7, 7, 3, R, 2).line(24, 7, 26, 3, R, 2);
    gr.rect(9, 15, 4, 3, W).rect(17, 15, 4, 3, W).px(11, 16, N).px(18, 16, N);
    gr.line(9, 14, 12, 15, N).line(20, 15, 23, 14, N);
    for (let x = 10; x <= 20; x += 2) gr.px(x, 21, N).px(x + 1, 22, N);
  },
  'stack-overflow'(gr, f) {
    gr.rect(5, 28, 22, 2, S);
    for (let i = 0; i < 6; i++) {
      const off = Math.round(Math.sin(f * (Math.PI / 2) + i * 0.7) * (i * 0.45));
      const y = 24 - i * 4;
      gr.rect(7 + off, y, 18, 3, i % 2 ? Y : F).rect(7 + off, y + 3, 18, 1, r);
    }
    const o = Math.round(Math.sin(f * (Math.PI / 2) + 1.4) * 0.9);
    gr.rect(11 + o, 16, 3, 3, W).rect(18 + o, 16, 3, 3, W).px(12 + o, 17, N).px(19 + o, 17, N);
    gr.disc(24 + f, 3 + f * 2, 1.3, F);
  },
  hallucination(gr, f) {
    gr.disc(16, 12, 9, C);
    gr.rect(7, 12, 18, 12, C);
    for (let x = 7; x <= 24; x++) {
      const h = (x + f * 2) % 4 < 2 ? 2 : 0;
      gr.rect(x, 24, 1, h + 1, C);
    }
    gr.recolor((x, y) => y > 17 && (x + y) % 2 === 0, c);
    gr.disc(11.5, 12, 3, W).disc(20.5, 12, 3, W);
    const pp = [[0, -1], [1, 0], [0, 1], [-1, 0]][f];
    gr.rect(11 + pp[0], 11 + pp[1], 2, 2, M).rect(20 + pp[0], 11 + pp[1], 2, 2, M);
    gr.disc(16, 19, 1.6, N);
    gr.translate(0, BOB[f]);
  },
  'token-overflow'(gr, f) {
    for (const [x, ph] of [[8, 0], [16, 2], [24, 1]]) {
      const t = (f + ph) % 4;
      gr.ball(x, 9 - t * 2, 2.5, 2.5, F, Y, null);
    }
    gr.ball(16, 20, 10, 9, F, Y, W);
    gr.rect(12, 16, 8, 2, F).rect(15, 16, 2, 9, F);
  },
  'context-loss'(gr, f) {
    gr.ell(16, 16, 12, 10, M);
    gr.ell(16, 16, 12, 10, m, (x, y) => y > 20);
    for (const [x0, y0, x1, y1] of [[9, 11, 13, 14], [13, 14, 11, 19], [16, 7, 16, 25], [19, 12, 22, 15], [21, 18, 18, 21]]) gr.line(x0, y0, x1, y1, m);
    const thr = [0.25, 0.5, 0.75, 0.5][f];
    const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) % 1000 / 1000;
    const moved = [];
    gr.erase((x, y, v) => {
      const hit = v && x > 17 && y < 16 && Math.abs(hash(x, y)) < thr;
      if (hit && Math.abs(hash(y, x)) < 0.3) moved.push([x, y]);
      return hit;
    });
    for (const [x, y] of moved) gr.px(x + 2 + f, y - 2 - f, M);
    gr.text('?', 21, 6, W);
  },
  'prompt-injection'(gr, f) {
    const py = 2 + [0, 1, 2, 1][f];
    gr.rect(11, py, 10, 2, S).rect(15, py + 2, 2, 6 - (py - 2), S);
    gr.rect(12, 7, 8, 15, W);
    const level = 7 + [0, 1, 2, 1][f];
    gr.rect(13, level, 6, 22 - level, M);
    gr.rect(13, level, 6, 1, m);
    for (let y = 9; y <= 19; y += 3) gr.px(19, y, S);
    gr.text('>', 14, 14, W);
    gr.rect(10, 22, 12, 2, S);
    gr.rect(15, 24, 2, 4, S).px(15, 28, W);
    if (f % 2) gr.px(16, 29, M);
  },
  '404-not-found'(gr) {
    gr.poly([[8, 4], [20, 4], [24, 8], [24, 28], [8, 28]], W);
    gr.poly([[20, 4], [24, 8], [20, 8]], S);
    gr.text('404', 9, 11, R);
    gr.rect(10, 20, 12, 1, S).rect(10, 23, 9, 1, S);
    gr.rect(11, 25, 2, 1, N).rect(19, 25, 2, 1, N);
  },
  'cors-error'(gr, f) {
    const oct = (rad, col) => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const dx = Math.abs(x + 0.5 - 16);
        const dy = Math.abs(y + 0.5 - 16);
        if (dx <= rad && dy <= rad && dx + dy <= rad * 1.42) gr.px(x, y, col);
      }
    };
    oct(13.5, f % 2 ? Y : W);
    oct(11.5, f % 2 ? R : r);
    oct(10, R);
    gr.line(11, 11, 20, 20, W, 2).line(20, 11, 11, 20, W, 2);
  },
  'type-error'(gr, f) {
    const body = [Y, G, C, G][f];
    const shade = [F, g, c, g][f];
    if (f === 0) gr.rect(7, 7, 18, 18, shade).rect(7, 7, 17, 17, body);
    else if (f === 2) gr.disc(16, 16, 9.5, shade).disc(15.6, 15.6, 8.6, body);
    else gr.poly([[10, 7], [22, 7], [25, 10], [25, 22], [22, 25], [10, 25], [7, 22], [7, 10]], shade).poly([[10, 7], [21, 7], [24, 10], [24, 21], [21, 24], [10, 24], [7, 21], [7, 10]], body);
    eye(gr, 10, 12, 1, f === 2 ? 0 : 1);
    eye(gr, 19, 12, 1, f === 2 ? 0 : 1);
    gr.text(['T', '?', '{', '?'][f], 14, 18, N);
  },
  'git-conflict'(gr, f) {
    gr.line(16, 7, 16, 3, S).line(16, 6, 11, 2, S);
    gr.disc(16, 2.5, 1.4, G).disc(11, 2.5, 1.4, G);
    gr.rect(10, 26, 3, 3, c).rect(19, 26, 3, 3, m);
    gr.ell(16, 17, 11, 10, c, (x) => x < 16);
    gr.ell(16, 17, 11, 10, m, (x) => x >= 16);
    gr.ell(15.4, 16.4, 9.8, 8.8, C, (x) => x < 16);
    gr.ell(15.4, 16.4, 9.8, 8.8, M, (x) => x >= 16);
    for (let y = 8; y <= 26; y++) gr.px(15 + ((y + f) % 2), y, W);
    eye(gr, 9, 14, -1, 0);
    eye(gr, 20, 14, 1, 0);
    gr.rect(13, 21, 3, 1, N).rect(16, 22, 3, 1, N);
  },
  overfitting(gr, f) {
    const d = [0, 1, 0, -1][f];
    for (const [x, y, sx, sy] of [[2, 2, 1, 1], [29, 2, -1, 1], [2, 29, 1, -1], [29, 29, -1, -1]]) {
      const bx = x + sx * (1 + d);
      const by = y + sy * (1 + d);
      gr.rect(sx > 0 ? bx : bx - 3, by, 4, 1, G).rect(bx, sy > 0 ? by : by - 3, 1, 4, G);
    }
    gr.rect(15, 26, 2, 2 + (f % 2), F);
    gr.ball(16, 15, 11, 11, N, P, S);
    gr.disc(16, 15, 7, W);
    const [px, py] = [[0, 0], [2, -1], [0, 1], [-2, 0]][f];
    gr.disc(16 + px, 15 + py, 4, G).disc(16 + px, 15 + py, 2, N).px(15 + px - 1, 13 + py, W);
  },
  'mode-collapse'(gr, f) {
    const d = [8, 5, 1, 5][f];
    const cube = (x, y) => {
      gr.rect(x - 4, y - 4, 8, 8, m).rect(x - 4, y - 4, 7, 7, M).rect(x - 4, y - 4, 7, 2, W);
      gr.px(x - 2, y, N).px(x + 1, y, N);
    };
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cube(16 + sx * d, 16 + sy * d);
    if (f === 2) {
      gr.rect(10, 10, 13, 13, m).rect(10, 10, 12, 12, M).rect(10, 10, 12, 3, W);
      gr.rect(12, 15, 2, 2, N).rect(18, 15, 2, 2, N).rect(13, 19, 6, 1, N);
    }
  },

  // —— Early pool (waves 1-5) ——————————————————————————————————————————
  typo(gr, f) {
    // Amber ink-blob letter running sideways, red spell-check squiggle underneath (zigzag mover).
    const lean = [-2, 0, 2, 0][f];
    gr.line(11, 23, 9 + lean, 28, F, 2).line(20, 23, 22 + lean, 28, F, 2);
    gr.ball(16 + lean, 15, 9, 9, F, Y, W);
    gr.rect(13 + lean, 6, 6, 3, Y).px(18 + lean, 5, F);
    eye(gr, 11 + lean, 12, lean > 0 ? 1 : lean < 0 ? -1 : 0, 0);
    eye(gr, 17 + lean, 12, lean > 0 ? 1 : lean < 0 ? -1 : 0, 0);
    gr.rect(14 + lean, 18, 4, 1, r);
    for (let x = 6; x <= 26; x++) gr.px(x, 29 + ((x + f) % 2), R);
  },
  'null-byte'(gr, f) {
    // Heavy slate block with "00" plate: slow tank, stomps.
    const b = [0, 1, 0, 1][f];
    gr.rect(8 + (f % 2), 27, 5, 3, N).rect(19 - (f % 2), 27, 5, 3, N);
    gr.rect(4, 5 + b, 24, 22, N).rect(5, 6 + b, 22, 20, S).rect(5, 6 + b, 22, 2, W);
    gr.rect(5, 24 + b, 22, 2, N);
    gr.rect(8, 9 + b, 16, 7, N).text('00', 11, 10 + b, f % 2 ? C : c);
    gr.rect(9, 18 + b, 4, 3, R).rect(19, 18 + b, 4, 3, R).px(10, 19 + b, Y).px(20, 19 + b, Y);
    gr.rect(12, 22 + b, 8, 1, N);
  },
  'pop-up'(gr, f) {
    // Browser pop-up window that blinks in and out (short teleports).
    const sq = [0, 1, 2, 1][f];
    const x0 = 4 + sq;
    const x1 = 28 - sq;
    gr.rect(x0, 6 + sq, x1 - x0, 20 - sq * 2, W);
    gr.rect(x0, 6 + sq, x1 - x0, 4, M).rect(x1 - 5, 7 + sq, 3, 2, R);
    gr.rect(x0 + 1, 7 + sq, 1, 1, W).rect(x0 + 3, 7 + sq, 1, 1, W);
    gr.text('!', 15, 12, R);
    eye(gr, 8 + sq, 14, 0, f % 2);
    eye(gr, 21 - sq, 14, 0, f % 2);
    gr.rect(x0 + 2, 22 - sq, x1 - x0 - 4, 2, C).rect(x0 + 2, 22 - sq, Math.max(1, (x1 - x0 - 4) >> 1), 2, c);
    gr.rect(x0, 26 - sq, x1 - x0, 1, S);
  },
  'spam-bot'(gr, f) {
    // Envelope drone: dashes in straight lines (thruster flare grows on dash frames).
    const flame = [1, 2, 4, 2][f];
    gr.rect(15, 3, 2, 4, S).disc(16, 3, 1.6, f % 2 ? R : M);
    gr.rect(5, 8, 22, 15, S).rect(6, 9, 20, 13, W);
    gr.poly([[6, 9], [26, 9], [16, 17]], M);
    gr.poly([[8, 9], [24, 9], [16, 15]], m);
    gr.rect(9, 17, 14, 3, N).rect(10 + f, 18, 3, 1, G).rect(18 - f, 18, 3, 1, G);
    gr.text('$', 22, 22, Y);
    gr.rect(10, 23, 12, 2, S);
    gr.rect(12, 25, 8, flame, F).rect(14, 25, 4, Math.max(1, flame - 1), Y);
  },
  cookie(gr, f) {
    // Tracking cookie with a bite missing; splits into crumbs on death.
    const b = BOB[f];
    gr.ball(16, 16 + b, 12, 12, F, Y, null);
    gr.disc(16, 16 + b, 9, F, (x, y) => (x + y) % 3 === 0);
    gr.erase((x, y) => Math.hypot(x + 0.5 - 27, y + 0.5 - (7 + b)) < 5);
    for (const [cx, cy] of [[10, 12], [20, 21], [12, 22], [22, 14], [16, 9]]) gr.rect(cx, cy + b, 2, 2, N);
    eye(gr, 11, 14 + b, f === 1 ? 1 : 0, 0);
    eye(gr, 17, 14 + b, f === 1 ? 1 : 0, 0);
    gr.rect(13, 19 + b, 5, 1, r);
  },
  'lag-spike'(gr, f) {
    // Spiky red ball inside a loading ring that spins; sprints in bursts.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + f * 0.2;
      gr.line(16 + Math.cos(a) * 6, 16 + Math.sin(a) * 6, 16 + Math.cos(a) * (f % 2 ? 11 : 10), 16 + Math.sin(a) * (f % 2 ? 11 : 10), r, 2);
    }
    gr.ball(16, 16, 7, 7, r, R, W);
    eye(gr, 12, 14, 1, 0);
    eye(gr, 17, 14, -1, 0);
    gr.rect(14, 19, 4, 1, N);
    for (let i = 0; i < 6; i++) {
      const a = ((i + f * 1.5) / 6) * Math.PI * 2;
      gr.rect(Math.round(16 + Math.cos(a) * 13) - 1, Math.round(16 + Math.sin(a) * 13) - 1, 2, 2, i === 0 ? W : i < 3 ? C : c);
    }
  }
};

// ---------------------------------------------------------------------------
// XP gems — 8/10/12 px diamonds, 2-frame shine (src/scenes/boot/enemyAssets.js XP_GEM_SPRITES)
// ---------------------------------------------------------------------------
const GEM_COLOURS = { blue: [c, C], green: [g, G], red: [m, M] };
function drawGem(tier) {
  const [dark, base] = GEM_COLOURS[tier];
  return (gr, f) => {
    const n = gr.w;
    const cx = n / 2;
    const top = 1;
    const bot = n - 1;
    const mid = n / 2;
    gr.poly([[cx, top], [n - 1, mid], [cx, bot], [1, mid]], dark);
    gr.poly([[cx, top + 0.5], [n - 1.5, mid], [cx, mid + 0.5], [1.5, mid]], base);
    if (f === 0) gr.px(Math.floor(cx) - 1, Math.floor(mid) - 1, W);
    else gr.px(Math.floor(cx), Math.floor(top) + 1, W).px(Math.floor(cx) - 1, Math.floor(mid), W).px(Math.floor(cx) + 1, Math.floor(mid) - 1, W);
  };
}

// ---------------------------------------------------------------------------
// Mini-bosses — 48x48
// ---------------------------------------------------------------------------
const MINIBOSS_DRAW = {
  'miniboss-deadlock'(gr, f) {
    const a = [0, 1, 0, -1][f];
    // Interlocked shackles behind the bodies.
    gr.ring(17, 21, 9, 3, S, (x, y) => y < 22);
    gr.ring(31, 23, 9, 3, S, (x, y) => y < 24);
    gr.ring(17, 21, 9, 1, W, (x, y) => y < 16);
    gr.ring(31, 23, 9, 1, W, (x, y) => y < 18);
    const lock = (x, y, body, shade, dir) => {
      gr.rect(x, y, 16, 15, shade).rect(x, y, 15, 14, body).rect(x + 1, y + 1, 13, 2, Y);
      gr.rect(x + 3, y + 5, 3, 3, W).rect(x + 9, y + 5, 3, 3, W);
      gr.px(x + 4 + dir, y + 6, N).px(x + 10 + dir, y + 6, N);
      gr.line(x + 2, y + 4, x + 6, y + 5, N).line(x + 9, y + 5, x + 13, y + 4, N);
      gr.disc(x + 7.5, y + 11, 1.5, N).rect(x + 7, y + 11, 1, 3, N);
    };
    lock(8, 21 + a, F, r, 1);
    lock(24, 23 - a, F, r, -1);
    if (f % 2) gr.text('!', 22, 4, R);
  },
  'miniboss-thrashing'(gr, f) {
    gr.disc(24, 24, 20, N);
    gr.disc(23.5, 23.5, 19, S);
    for (const rad of [16, 12, 8]) gr.ring(24, 24, rad, 1, P);
    const a0 = (f * Math.PI) / 4;
    gr.ring(24, 24, 18, 14, W, (x, y, a) => {
      const d = (((a - a0) % Math.PI) + Math.PI) % Math.PI;
      return d < 0.22;
    });
    gr.line(7, 30, 15, 22, R).line(15, 22, 13, 18, R);
    gr.disc(24, 24, 4, P).disc(24, 24, 2.5, R).px(23, 23, W);
    gr.line(42, 6, 30, 20, M, 2).rect(40, 4, 5, 5, m);
    gr.rect(28, 19, 3, 3, M);
  },
  'miniboss-ddos'(gr, f) {
    gr.rect(15, 11, 18, 26, N).rect(16, 12, 16, 24, P);
    for (let i = 0; i < 5; i++) {
      gr.rect(18, 14 + i * 4, 12, 2, c);
      gr.px(28, 14 + i * 4, (i + f) % 2 ? G : g).px(26, 14 + i * 4, (i + f) % 3 ? G : g);
    }
    gr.rect(19, 15, 3, 2, W).rect(26, 15, 3, 2, W);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + (f * Math.PI) / 16;
      const x = 24 + Math.cos(a) * 19;
      const y = 24 + Math.sin(a) * 19;
      const xi = 24 + Math.cos(a) * 14;
      const yi = 24 + Math.sin(a) * 14;
      gr.line(x, y, xi, yi, g);
      gr.ball(x, y, 3, 3, g, G, W);
    }
  },
  'miniboss-zeroday'(gr, f) {
    const j = [0, 1, 2, 1][f];
    gr.rect(15, 30 + j, 18, 8, S).rect(15, 30 + j, 17, 7, W);
    for (let x = 17; x <= 30; x += 3) gr.rect(x, 30 + j, 1, 4, N);
    gr.ball(24, 20, 15, 13, S, W, null);
    gr.ring(17, 20, 5, 2, R);
    gr.disc(31, 20, 4.5, N).disc(31, 20, 2, f % 2 ? Y : R);
    gr.rect(23, 25, 2, 3, N);
    gr.line(24, 7, 27, 12, N).line(27, 12, 25, 15, N);
  },
  'miniboss-botnet'(gr, f) {
    const nodes = [[7, 7], [40, 7], [7, 40], [40, 40]];
    nodes.forEach(([x, y]) => gr.line(x, y, 24, 24, S));
    gr.line(24, 13, 24, 5, S).disc(24, 4.5, 2, f % 2 ? C : W);
    gr.rect(13, 13, 22, 20, c).rect(13, 13, 21, 19, C).rect(13, 13, 21, 2, W);
    gr.rect(15, 18, 17, 7, N);
    const sweep = 16 + f * 4;
    gr.rect(sweep, 20, 3, 3, R).px(sweep + 1, 20, W);
    gr.rect(17, 27, 13, 2, c);
    nodes.forEach(([x, y], i) => {
      gr.ball(x, y, 4.5, 4.5, c, i === f ? W : C, null);
      gr.px(x - 1, y, N).px(x + 1, y, N);
    });
  }
};

// ---------------------------------------------------------------------------
// Bosses — 64x64
// ---------------------------------------------------------------------------
const BOSS_DRAW = {
  'boss-stackoverflow'(gr, f) {
    gr.rect(6, 58, 52, 3, S);
    for (let i = 0; i < 8; i++) {
      const off = Math.round(Math.sin(f * (Math.PI / 2) + i * 0.6) * (i * 0.55));
      const y = 50 - i * 6;
      const w = 44 - i * 2;
      const x = 32 - w / 2 + off;
      gr.rect(x, y, w, 5, i % 2 ? Y : F).rect(x, y + 5, w, 1, r).rect(x, y, w, 1, i % 2 ? W : Y);
    }
    const o = Math.round(Math.sin(f * (Math.PI / 2) + 1.2) * 1.1);
    gr.rect(20 + o, 33, 7, 6, W).rect(37 + o, 33, 7, 6, W);
    gr.rect(23 + o, 35, 3, 3, N).rect(38 + o, 35, 3, 3, N);
    gr.line(19 + o, 31, 27 + o, 33, N, 2).line(37 + o, 33, 45 + o, 31, N, 2);
    gr.rect(26 + o, 41, 12, 2, N);
    // Overflowing blocks tumbling off the top.
    gr.rect(44 + f * 2, 4 + f * 3, 6, 4, F).rect(45 + f * 2, 4 + f * 3, 5, 1, Y);
    gr.rect(12 - f, 8 + f * 2, 5, 3, Y);
  },
  'boss-nullpointer'(gr, f) {
    const ptr = [[14, 4], [14, 50], [24, 40], [32, 58], [40, 54], [32, 37], [46, 37]];
    gr.poly(ptr, m);
    gr.poly([[14, 4], [14, 48], [23, 39], [31, 56], [37, 53], [29, 35], [43, 35]], M);
    gr.line(15, 6, 15, 44, W);
    gr.disc(23, 28, 8, N).ring(23, 28, 8, 2, W).line(17, 34, 29, 22, W, 2);
    gr.disc(23, 28, 2.5, f % 2 ? C : M);
    const bands = [[10, 14], [30, 34], [44, 48], [20, 24]];
    const [y0, y1] = bands[f];
    gr.shiftRows(y0, y1, [3, -3, 2, -2][f]);
    gr.chroma(y0, y1);
    const rand = rng(900 + f);
    for (let i = 0; i < 6; i++) gr.px(44 + Math.floor(rand() * 16), 6 + Math.floor(rand() * 20), i % 2 ? C : W);
  },
  'boss-memoryleakprime'(gr, f) {
    const p = [0, 1, 1, 0][f];
    for (const [x, len] of [[14, 3 + f], [24, 6 - (f % 2) * 2], [36, 4 + ((f + 1) % 4)], [48, 2 + ((f + 3) % 4)]]) gr.rect(x, 50, 3, len + 2, m);
    gr.disc(30, 58 + (f % 2), 1.8, m);
    gr.ball(32, 38, 27 + p, 18 + p, P, m, M);
    // Crown (prime).
    gr.poly([[20, 22], [20, 12], [25, 17], [32, 8], [39, 17], [44, 12], [44, 22]], Y);
    gr.rect(20, 20, 25, 2, F).disc(32, 16, 1.6, R);
    const bigEye = (x, y, dx) => gr.rect(x, y, 6, 6, W).rect(x + 2 + dx, y + 2, 2, 3, N);
    bigEye(15, 36, 1);
    bigEye(29, 34, 1);
    bigEye(43, 37, 0);
    gr.rect(22, 46, 20, 2, P);
    for (let x = 24; x <= 40; x += 4) gr.rect(x, 45, 2, 2, W);
  },
  'boss-kernelpanic'(gr, f) {
    const fl = [[6, 9, 5, 8, 6], [8, 6, 9, 5, 7], [5, 8, 7, 9, 5], [9, 5, 6, 7, 9]][f];
    fl.forEach((h, i) => {
      const x = 14 + i * 8;
      gr.rect(x, 12 - h, 5, h + 2, R).rect(x + 1, 13 - Math.max(2, h - 3), 3, Math.max(2, h - 3), F).rect(x + 2, 13 - Math.max(1, h - 5), 1, Math.max(1, h - 5), Y);
    });
    for (let k = 0; k < 9; k++) {
      const t = 13 + k * 4;
      gr.rect(t, 55, 2, 5, S).rect(4, t, 5, 2, S).rect(55, t, 5, 2, S);
    }
    gr.rect(9, 12, 46, 44, N).rect(11, 14, 42, 40, P);
    gr.rect(17, 20, 30, 28, f % 2 ? R : r).rect(19, 22, 26, 24, f % 2 ? r : R);
    gr.poly([[21, 27], [30, 30], [30, 34], [21, 34]], W).poly([[43, 27], [34, 30], [34, 34], [43, 34]], W);
    gr.rect(25, 31, 3, 3, N).rect(36, 31, 3, 3, N);
    for (let x = 23; x <= 41; x += 2) gr.px(x, 40 + ((x + f) % 2), W).px(x, 41 + ((x + f) % 2), W);
    gr.translate([0, 1, -1, 0][f], 0);
  }
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
async function writeSheet(file, frames) {
  const w = frames[0].w;
  const h = frames[0].h;
  const buf = Buffer.alloc(w * frames.length * h * 4);
  const used = new Set();
  frames.forEach((fr, k) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = fr.get(x, y);
      if (!v) continue;
      used.add(v);
      const o = (y * w * frames.length + k * w + x) * 4;
      const [cr, cg, cb] = PAL[v];
      buf[o] = cr;
      buf[o + 1] = cg;
      buf[o + 2] = cb;
      buf[o + 3] = 255;
    }
  });
  if (used.size + 1 > 16) throw new Error(`${file}: ${used.size + 1} colours (max 16)`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(buf, { raw: { width: w * frames.length, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
  return used.size + 1;
}

/** Effects applied after the outline (e.g. dithered fade-out that also eats the outline). */
const POST = {
  '404-not-found'(gr, f) {
    const level = [0, 1, 2, 1][f];
    if (level) gr.erase((x, y) => (level === 1 ? (x + y) % 4 === 0 : (x + y) % 2 === 0));
  }
};

function drawFrames(entry, draw) {
  if (!draw) throw new Error(`No drawing for ${entry.id}`);
  return Array.from({ length: entry.frames }, (_, f) => {
    const gr = new Grid(entry.frameWidth, entry.frameHeight);
    draw(gr, f);
    // Keep a 1px transparent margin for the outline.
    gr.erase((x, y) => x === 0 || y === 0 || x === gr.w - 1 || y === gr.h - 1);
    gr.outline();
    if (POST[entry.id]) POST[entry.id](gr, f);
    return gr;
  });
}

/** White silhouette sheet with the exact layout of a player composite texture (for i-frame flashes). */
async function writeHitSheet(sheet) {
  const frameSize = sheet.frameSize;
  const parts = [];
  for (const part of sheet.compose) {
    const src = path.join(SPRITES, part.file);
    const meta = await sharp(src).metadata();
    for (const idx of part.frames) {
      const left = Math.min(idx * frameSize, meta.width - frameSize);
      parts.push(await sharp(src).extract({ left, top: 0, width: frameSize, height: frameSize }).ensureAlpha().raw().toBuffer());
    }
  }
  const out = Buffer.alloc(frameSize * parts.length * frameSize * 4);
  parts.forEach((raw, k) => {
    for (let y = 0; y < frameSize; y++) for (let x = 0; x < frameSize; x++) {
      const i = (y * frameSize + x) * 4;
      const a = raw[i + 3];
      if (a < 16) continue;
      const o = (y * frameSize * parts.length + k * frameSize + x) * 4;
      out[o] = 255;
      out[o + 1] = 255;
      out[o + 2] = 255;
      out[o + 3] = a;
    }
  });
  const file = path.join(SPRITES, sheet.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(out, { raw: { width: frameSize * parts.length, height: frameSize, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
  return parts.length;
}

async function main() {
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  const want = (id) => !only.length || only.includes(id);
  const DRAW = { ...ENEMY_DRAW, ...MINIBOSS_DRAW, ...BOSS_DRAW };
  const report = [];

  for (const e of ENEMY_SPRITES) {
    if (!want(e.id)) continue;
    const colours = await writeSheet(path.join(SPRITES, e.file), drawFrames(e, DRAW[e.id]));
    report.push(`${e.file}  ${e.frameWidth}x${e.frameHeight} x${e.frames}  ${colours} colours`);
  }
  for (const gem of XP_GEM_SPRITES) {
    if (!want(gem.id)) continue;
    const colours = await writeSheet(path.join(SPRITES, gem.file), drawFrames(gem, drawGem(gem.tier)));
    report.push(`${gem.file}  ${gem.frameWidth}x${gem.frameHeight} x${gem.frames}  ${colours} colours`);
  }
  if (only.some((id) => id.startsWith('item-'))) {
    console.warn('[gen-sprites] item icons are generated by scripts/assets/gen-items.mjs (32x32); ignoring', only.filter((id) => id.startsWith('item-')).join(','));
  }
  for (const sheet of CHARACTER_HIT_SHEETS) {
    if (!want(sheet.key)) continue;
    const n = await writeHitSheet(sheet);
    if (n !== sheet.frames) throw new Error(`${sheet.key}: expected ${sheet.frames} frames, built ${n}`);
    report.push(`${sheet.file}  128x128 x${n}  (white silhouette)`);
  }
  console.log(report.join('\n'));
  console.log(`\n${report.length} sprite files written.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
