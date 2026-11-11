#!/usr/bin/env node
/**
 * Deterministic generator for biome backgrounds + map sprites (art direction v3: "polished deep space").
 *
 *   node scripts/assets/gen-biomes.mjs            # write every PNG
 *   node scripts/assets/gen-biomes.mjs --preview  # also 2x2 tiled previews ($PREVIEW_DIR or os.tmpdir()/biome-preview)
 *   node scripts/assets/gen-biomes.mjs --sheet    # also a contact sheet at scripts/evil-player/reports/art-sheet.png
 *   node scripts/assets/gen-biomes.mjs --zones    # only the mechanic zone discs + zone icons (hard pixel art)
 *
 * Style: soft nebulae, gaussian-haloed stars, glow, antialiasing everywhere. No grids, scanlines or
 * hard pixels: the characters are pixel sprites, so the environment stays smooth and lets them pop.
 *
 * Tiling: backgrounds and border tiles use periodic value noise (lattice indices taken mod the period)
 * and wrapped splats/curves, so they tile seamlessly by construction.
 * Sprites are rendered analytically with 4x4 supersampling (premultiplied alpha, then un-premultiplied).
 * Animated strips loop because every time-dependent term is periodic in t ∈ [0,1).
 * Output names/sizes come from src/data/biomes.js (BIOMES, MAP_ART, HAZARD_DEFS, OBSTACLE_DEFS).
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIOMES, MAP_ART, HAZARD_DEFS, OBSTACLE_DEFS, BIOME_MECHANICS } from '../../src/data/biomes.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BG_DIR = join(ROOT, 'public/assets/backgrounds/biomes');
const MAP_DIR = join(ROOT, 'public/assets/sprites/map');
const PREVIEW = process.argv.includes('--preview');
const SHEET = process.argv.includes('--sheet');
const ZONES_ONLY = process.argv.includes('--zones');
const PREVIEW_DIR = process.env.PREVIEW_DIR || join(tmpdir(), 'biome-preview');
const SHEET_PATH = join(ROOT, 'scripts/evil-player/reports/art-sheet.png');
const S = MAP_ART.bgSize;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- math + noise
const hex = (h) => {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const frac = (v) => v - Math.floor(v);

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in cell units, periodic with period P cells on both axes. */
function vnoise(x, y, P, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = fade(x - xi), v = fade(y - yi);
  const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P;
  const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise over a tile of `size` px: octave o has period P*2^o cells, so the sum tiles with `size`. */
function fbm(px, py, size, P, oct, seed, gain = 0.5) {
  let s = 0, amp = 1, norm = 0, p = P;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise((px / size) * p, (py / size) * p, p, seed + o * 131);
    norm += amp; amp *= gain; p *= 2;
  }
  return s / norm;
}

// ---------------------------------------------------------------- float image buffers
/** Premultiplied float RGBA image. */
class Img {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Float32Array(w * h * 4); }
  /** Additive light (premultiplied), with coverage `k` added to alpha (screen-like). */
  add(i, c, k) {
    const d = this.d, j = i * 4;
    d[j] += c[0] * k; d[j + 1] += c[1] * k; d[j + 2] += c[2] * k;
    d[j + 3] = 1 - (1 - d[j + 3]) * (1 - clamp01(k));
  }
  /** Normal "over" compositing of a straight colour with coverage a. */
  over(i, c, a) {
    const d = this.d, j = i * 4, ia = 1 - a;
    d[j] = c[0] * a + d[j] * ia; d[j + 1] = c[1] * a + d[j + 1] * ia; d[j + 2] = c[2] * a + d[j + 2] * ia;
    d[j + 3] = a + d[j + 3] * ia;
  }
}

/** Wrapped gaussian splat (tileable). intensity * exp(-d²/2σ²). */
function splat(img, cx, cy, sigma, color, intensity, wrap = true) {
  const r = Math.ceil(sigma * 3.2), inv = 1 / (2 * sigma * sigma);
  const x0 = Math.floor(cx) - r, y0 = Math.floor(cy) - r;
  for (let y = y0; y <= y0 + 2 * r + 1; y++) {
    for (let x = x0; x <= x0 + 2 * r + 1; x++) {
      let X = x, Y = y;
      if (wrap) { X = ((x % img.w) + img.w) % img.w; Y = ((y % img.h) + img.h) % img.h; }
      else if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const g = Math.exp(-(dx * dx + dy * dy) * inv) * intensity;
      if (g > 0.002) img.add(Y * img.w + X, color, g);
    }
  }
}

/** Soft star: core + halo, optional soft diffraction cross. */
function star(img, x, y, size, color, bright) {
  splat(img, x, y, 0.45 + size * 0.35, mix(color, [1, 1, 1], 0.6), bright);
  if (size > 0.8) splat(img, x, y, 1.6 + size * 1.6, color, bright * 0.16);
  if (size > 1.6) {
    splat(img, x, y, 6 + size * 3, color, bright * 0.05);
    const len = 7 + size * 5;
    for (let s = -len; s <= len; s += 0.5) {
      const k = Math.pow(1 - Math.abs(s) / len, 2.2) * bright * 0.22;
      splat(img, x + s, y, 0.55, color, k);
      splat(img, x, y + s, 0.55, color, k);
    }
  }
}

/** Glowing periodic curve: points generated by fn(u) for u ∈ [0,1), wrapped on the tile. */
function curve(img, fn, steps, sigma, color, intensity, glowSigma = 0, glowK = 0) {
  // consecutive splats overlap: scale so the line's peak ≈ intensity regardless of step count
  const density = (steps / S) * 1.2;
  intensity /= density * sigma * 2.5;
  if (glowSigma) glowK /= density * glowSigma * 2.5;
  for (let i = 0; i < steps; i++) {
    const u = i / steps;
    const [x, y, k = 1] = fn(u);
    if (k <= 0.003) continue;
    splat(img, x, y, sigma, color, intensity * k);
    if (glowSigma) splat(img, x, y, glowSigma, color, glowK * k);
  }
}

/** Soft shoulder so bright cores bloom instead of clipping. */
const shoulder = (v) => (v < 0.62 ? v : 0.62 + 0.38 * (1 - Math.exp(-(v - 0.62) / 0.38)));

/** Float image → 8-bit straight RGBA. `opaque` forces a = 1 (far layers, borders). */
function toRaw(img, { opaque = false, dither = 0, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const out = Buffer.alloc(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) {
    const j = i * 4;
    let a = clamp01(img.d[j + 3]);
    let r = img.d[j], g = img.d[j + 1], b = img.d[j + 2];
    if (!opaque) {
      if (a < 1 / 512) { r = g = b = a = 0; } else { r /= a; g /= a; b /= a; }
    } else a = 1;
    const n = dither ? (rng() - 0.5) * dither : 0;
    out[j] = Math.round(clamp01(shoulder(r) + n) * 255);
    out[j + 1] = Math.round(clamp01(shoulder(g) + n) * 255);
    out[j + 2] = Math.round(clamp01(shoulder(b) + n) * 255);
    out[j + 3] = Math.round(a * 255);
  }
  return out;
}

const written = [];
async function writePng(img, file, opts) {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(toRaw(img, opts), { raw: { width: img.w, height: img.h, channels: 4 } })
    .png({ compressionLevel: 9 }).toFile(file);
  written.push(file);
}

// ---------------------------------------------------------------- backgrounds (far, opaque)
/**
 * Per-biome recipe.
 *  base: deep backdrop; nebula: layers {c, P, oct, lo, hi, k, pow}; mass: low-frequency density field
 *  stars: [tiny, mid, big] counts; starTint; extraFar/extraNear: identity details.
 */
const BG = {
  'debug-zone': {
    base: '#070a1a', seed: 11, warp: 38,
    nebula: [
      { c: '#0d4468', P: 2, oct: 5, lo: 0.28, hi: 0.76, k: 0.95, pow: 1.3 },
      { c: '#1aa6c4', P: 3, oct: 5, lo: 0.55, hi: 0.9, k: 0.32, pow: 2.0 },
      { c: '#3b2a7a', P: 2, oct: 4, lo: 0.5, hi: 0.85, k: 0.28, pow: 1.6 }
    ],
    stars: [520, 70, 6], starTint: '#bfefff',
    near: { dust: '#9ae8ff', neb: '#22d3ee', nebK: 0.1 }
  },
  'memory-banks': {
    base: '#0a0618', seed: 23, warp: 44,
    nebula: [
      { c: '#3a1878', P: 2, oct: 5, lo: 0.24, hi: 0.74, k: 1.1, pow: 1.2 },
      { c: '#8b5cf6', P: 3, oct: 5, lo: 0.5, hi: 0.9, k: 0.45, pow: 1.8 },
      { c: '#c026d3', P: 2, oct: 5, lo: 0.6, hi: 0.92, k: 0.22, pow: 2.2 }
    ],
    stars: [460, 60, 5], starTint: '#e9d5ff',
    near: { dust: '#f0abfc', neb: '#a78bfa', nebK: 0.12 }
  },
  'network-layer': {
    base: '#050a1f', seed: 37, warp: 30,
    nebula: [
      { c: '#10267a', P: 2, oct: 5, lo: 0.3, hi: 0.8, k: 0.9, pow: 1.3 },
      { c: '#2f6bff', P: 3, oct: 5, lo: 0.55, hi: 0.9, k: 0.34, pow: 2.0 },
      { c: '#0e7490', P: 2, oct: 4, lo: 0.55, hi: 0.88, k: 0.22, pow: 1.8 }
    ],
    stars: [500, 60, 5], starTint: '#c7dbff',
    near: { dust: '#93c5fd', neb: '#3b82f6', nebK: 0.08 }
  },
  'kernel-space': {
    base: '#0d0608', seed: 53, warp: 46,
    nebula: [
      { c: '#4a120c', P: 2, oct: 5, lo: 0.28, hi: 0.78, k: 0.95, pow: 1.3 },
      { c: '#c2410c', P: 3, oct: 5, lo: 0.58, hi: 0.92, k: 0.34, pow: 2.1 },
      { c: '#f59e0b', P: 3, oct: 5, lo: 0.7, hi: 0.95, k: 0.22, pow: 2.4 }
    ],
    stars: [300, 40, 3], starTint: '#ffd8a8',
    near: { dust: '#fbbf24', neb: '#ea580c', nebK: 0.1 }
  },
  'cloud-cluster': {
    base: '#0a1022', seed: 71, warp: 52,
    nebula: [
      { c: '#2a3a78', P: 2, oct: 4, lo: 0.25, hi: 0.75, k: 0.95, pow: 1.1 },
      { c: '#8aa0e8', P: 2, oct: 5, lo: 0.5, hi: 0.9, k: 0.36, pow: 1.6 },
      { c: '#7dd3fc', P: 3, oct: 4, lo: 0.6, hi: 0.92, k: 0.2, pow: 1.8 }
    ],
    stars: [380, 50, 4], starTint: '#e0e7ff',
    near: { dust: '#e0e7ff', neb: '#c7d2fe', nebK: 0.14 }
  },
  singularity: {
    base: '#05030c', seed: 89, warp: 40,
    nebula: [
      { c: '#24104a', P: 2, oct: 5, lo: 0.3, hi: 0.8, k: 0.85, pow: 1.4 },
      { c: '#6d28d9', P: 3, oct: 5, lo: 0.6, hi: 0.92, k: 0.26, pow: 2.2 }
    ],
    stars: [420, 50, 4], starTint: '#ede9fe',
    near: { dust: '#fde68a', neb: '#8b5cf6', nebK: 0.1 }
  }
};

function nebulaField(r, seed, x, y, warpX, warpY) {
  return fbm(x + warpX, y + warpY, S, r.P, r.oct, seed);
}

function drawFar(id, recipe) {
  const img = new Img(S, S);
  const base = hex(recipe.base);
  const seed = recipe.seed;
  const layers = recipe.nebula.map((l) => ({ ...l, col: hex(l.c) }));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wx = (fbm(x, y, S, 3, 4, seed + 1) - 0.5) * recipe.warp * 2;
      const wy = (fbm(x, y, S, 3, 4, seed + 2) - 0.5) * recipe.warp * 2;
      const mass = smooth(0.25, 0.75, fbm(x, y, S, 2, 2, seed + 3));
      const i = y * S + x;
      img.over(i, base, 1);
      layers.forEach((l, li) => {
        const n = nebulaField(l, seed + 10 + li * 7, x, y, wx * (1 + li * 0.4), wy * (1 + li * 0.4));
        const m = Math.pow(smooth(l.lo, l.hi, n), l.pow) * (0.35 + 0.65 * mass);
        img.add(i, l.col, m * l.k);
      });
      // dark dust lanes give depth: subtract a little light in ridged bands
      // gaussian ridge (smooth, no crease) on a doubly warped field so lanes never align to the lattice
      const ln = fbm(x + wy * 1.6, y + wx * 1.6, S, 3, 4, seed + 4);
      const dk = Math.exp(-Math.pow((ln - 0.5) / 0.06, 2)) * 0.32;
      const j = i * 4;
      img.d[j] *= 1 - dk; img.d[j + 1] *= 1 - dk; img.d[j + 2] *= 1 - dk;
    }
  }
  const rng = mulberry32(seed * 7 + 5);
  const tint = hex(recipe.starTint);
  const [tiny, mid, big] = recipe.stars;
  for (let i = 0; i < tiny; i++) star(img, rng() * S, rng() * S, rng() * 0.5, mix(tint, [1, 1, 1], rng()), 0.18 + rng() * 0.45);
  for (let i = 0; i < mid; i++) star(img, rng() * S, rng() * S, 0.9 + rng() * 0.6, mix(tint, [1, 1, 1], rng() * 0.5), 0.5 + rng() * 0.4);
  for (let i = 0; i < big; i++) star(img, rng() * S, rng() * S, 1.8 + rng() * 0.8, tint, 0.85 + rng() * 0.15);
  FAR_EXTRA[id]?.(img, rng);
  return img;
}

/** Periodic wavy curve across the tile (horizontal when !vertical). */
function wave(y0, terms, vertical = false, fadeTerms = null) {
  return (u) => {
    let off = 0;
    terms.forEach(([amp, k, ph]) => { off += amp * Math.sin(TAU * (k * u) + ph); });
    let vis = 1;
    if (fadeTerms) { const [k, ph, lo] = fadeTerms; vis = lo + (1 - lo) * (0.5 + 0.5 * Math.sin(TAU * k * u + ph)); }
    const a = u * S, b = y0 + off;
    return vertical ? [b, a, vis] : [a, b, vis];
  };
}

const FAR_EXTRA = {
  'network-layer': (img, rng) => {
    // faint light threads: smooth periodic curves, never a grid
    const c = hex('#5eead4'), c2 = hex('#60a5fa');
    for (let i = 0; i < 4; i++) {
      const terms = [[18 + rng() * 26, 1, rng() * TAU], [6 + rng() * 10, 2, rng() * TAU]];
      curve(img, wave(rng() * S, terms, i % 2 === 1, [1, rng() * TAU, 0]), 1400, 0.7, i % 2 ? c : c2, 0.14, 4, 0.05);
    }
  },
  'kernel-space': (img, rng) => {
    const a = hex('#f59e0b'), r = hex('#ef4444');
    for (let i = 0; i < 90; i++) {
      const x = rng() * S, y = rng() * S;
      const heat = fbm(x, y, S, 3, 5, 53 + 10);
      if (heat < 0.45) continue;
      const col = mix(r, a, rng());
      splat(img, x, y, 0.6 + rng() * 0.6, mix(col, [1, 0.9, 0.7], 0.4), 0.5 + rng() * 0.4);
      splat(img, x, y, 3 + rng() * 3, col, 0.06);
    }
  },
  'cloud-cluster': (img) => {
    // ethereal cloud veils: low-octave soft fbm, bright lavender tops
    const lav = hex('#c4b5fd'), sky = hex('#bae6fd');
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = fbm(x, y, S, 2, 3, 77);
        const m = Math.pow(smooth(0.52, 0.82, n), 1.6);
        const n2 = fbm(x + 40, y - 20, S, 2, 3, 78);
        img.add(y * S + x, mix(lav, sky, n2), m * 0.16);
      }
    }
  },
  singularity: (img) => {
    // soft vortex at the centre + faint accretion disk; fades to nothing well before the edges
    const vio = hex('#7c3aed'), mag = hex('#e879f9'), gold = hex('#f59e0b');
    const C = S / 2;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - C, dy = y + 0.5 - C;
        const r = Math.hypot(dx, dy) / (S * 0.46);
        if (r > 1) continue;
        const th = Math.atan2(dy, dx);
        const env = Math.pow(1 - r, 1.6) * smooth(0.06, 0.2, r);
        const arms = Math.pow(0.5 + 0.5 * Math.cos(3 * th + 7 * Math.log(r + 0.05)), 3);
        const i = y * S + x;
        img.add(i, mix(vio, mag, arms * 0.5), env * (0.12 + arms * 0.22));
        // tilted disk: ellipse ring
        const ex = dx / (S * 0.2), ey = dy / (S * 0.07);
        const er = Math.hypot(ex, ey);
        const ring = Math.exp(-Math.pow((er - 1) / 0.12, 2));
        img.add(i, gold, ring * 0.1 * (0.6 + 0.4 * Math.cos(th * 2)));
        // dark core
        const core = 1 - smooth(0.05, 0.12, r);
        const j = i * 4;
        img.d[j] *= 1 - core * 0.85; img.d[j + 1] *= 1 - core * 0.85; img.d[j + 2] *= 1 - core * 0.85;
      }
    }
  }
};

// ---------------------------------------------------------------- backgrounds (near, alpha)
function drawNear(id, recipe) {
  const img = new Img(S, S);
  const seed = recipe.seed + 500;
  const neb = hex(recipe.near.neb);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x, y, S, 2, 5, seed);
      const m = Math.pow(smooth(0.55, 0.9, n), 1.8);
      img.add(y * S + x, neb, m * recipe.near.nebK);
    }
  }
  const rng = mulberry32(seed);
  const dust = hex(recipe.near.dust);
  // fine drifting dust
  for (let i = 0; i < 160; i++) splat(img, rng() * S, rng() * S, 0.6 + rng() * 0.5, dust, 0.12 + rng() * 0.2);
  // bokeh discs (out-of-focus foreground motes)
  for (let i = 0; i < 18; i++) bokeh(img, rng() * S, rng() * S, 4 + rng() * 9, dust, 0.05 + rng() * 0.08);
  NEAR_EXTRA[id]?.(img, rng);
  return img;
}

/** Flat soft disc with slightly brighter rim (lens bokeh). Wrapped. */
function bokeh(img, cx, cy, R, color, k) {
  const r = Math.ceil(R + 2);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x + 0.5 - (cx - Math.floor(cx)), y + 0.5 - (cy - Math.floor(cy)));
      const cov = 1 - smooth(R - 1.2, R + 0.6, d);
      if (cov <= 0) continue;
      const rim = 0.7 + 0.3 * smooth(R * 0.6, R, d);
      const X = (((Math.floor(cx) + x) % S) + S) % S, Y = (((Math.floor(cy) + y) % S) + S) % S;
      img.add(Y * S + X, color, cov * rim * k);
    }
  }
}

const NEAR_EXTRA = {
  'debug-zone': (img, rng) => {
    // wide faint aurora ribbon
    const c = hex('#22d3ee'), v = hex('#8b5cf6');
    curve(img, wave(170, [[40, 1, 0.4], [14, 2, 2.1]], false, [1, 0.3, 0.15]), 900, 14, c, 0.3, 34, 0.12);
    curve(img, wave(420, [[30, 1, 2.4], [10, 3, 0.6]], false, [2, 1.2, 0.1]), 900, 10, v, 0.24);
    for (let i = 0; i < 6; i++) star(img, rng() * S, rng() * S, 1.2, c, 0.35);
  },
  'memory-banks': (img, rng) => {
    // drifting crystalline dust clumps
    const c = hex('#e879f9'), v = hex('#a78bfa');
    for (let k = 0; k < 3; k++) {
      const cx = rng() * S, cy = rng() * S;
      splat(img, cx, cy, 34, v, 0.07);
      for (let i = 0; i < 26; i++) splat(img, cx + (rng() - 0.5) * 90, cy + (rng() - 0.5) * 90, 0.8, c, 0.35 + rng() * 0.3);
    }
  },
  'network-layer': (img, rng) => {
    // light threads with travelling sparks
    const c = hex('#22d3ee'), b = hex('#60a5fa');
    for (let i = 0; i < 3; i++) {
      const f = wave(rng() * S, [[30 + rng() * 30, 1, rng() * TAU], [8 + rng() * 8, 2, rng() * TAU]], i === 1, [1, rng() * TAU, 0]);
      curve(img, f, 1600, 0.75, i === 1 ? b : c, 0.55, 5, 0.14);
      for (let s = 0; s < 4; s++) { const [x, y, k] = f(rng()); if (k > 0.3) star(img, x, y, 1.3, c, 0.6 * k); }
    }
  },
  'kernel-space': (img, rng) => {
    // rising embers + heat wisp
    const a = hex('#fbbf24'), r = hex('#f97316');
    curve(img, wave(300, [[50, 1, 1.0], [16, 2, 0.2]], false, [1, 2, 0.1]), 900, 22, r, 0.24);
    for (let i = 0; i < 70; i++) {
      const x = rng() * S, y = rng() * S, col = mix(r, a, rng());
      splat(img, x, y, 0.7 + rng() * 0.5, mix(col, [1, 0.95, 0.8], 0.5), 0.45 + rng() * 0.4);
      splat(img, x, y, 3.5, col, 0.05);
    }
  },
  'cloud-cluster': (img) => {
    // translucent cloud veil
    const lav = hex('#e0e7ff');
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = fbm(x, y, S, 2, 4, 991);
        img.add(y * S + x, lav, Math.pow(smooth(0.58, 0.85, n), 2) * 0.16);
      }
    }
  },
  singularity: (img, rng) => {
    // curving dust lanes spiralling inward + gold specks
    const v = hex('#c4b5fd'), g = hex('#fcd34d');
    curve(img, wave(120, [[46, 1, 0], [20, 2, 1.3]], false, [1, 0.5, 0.05]), 900, 12, v, 0.26);
    curve(img, wave(360, [[46, 1, 3.1], [20, 2, 4.4]], true, [1, 2.5, 0.05]), 900, 12, v, 0.26);
    for (let i = 0; i < 40; i++) star(img, rng() * S, rng() * S, rng() * 1.3, g, 0.3 + rng() * 0.4);
  }
};

// ---------------------------------------------------------------- sprite renderer (supersampled)
const L = (() => { const v = [-0.55, -0.65, 0.75]; const n = Math.hypot(...v); return v.map((c) => c / n); })();
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Render a strip of `frames` frames, each fw x fh. shade(x, y, t, px) writes into px (a Px accumulator)
 * in frame-local coords (pixel centres at .5). 4x4 supersampling for antialiasing.
 */
function renderStrip(fw, fh, frames, shade, ss = 4) {
  const img = new Img(fw * frames, fh);
  const px = new Px();
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let sy = 0; sy < ss; sy++) {
          for (let sx = 0; sx < ss; sx++) {
            px.reset();
            shade(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss, t, px);
            r += px.r; g += px.g; b += px.b; a += px.a;
          }
        }
        const n = ss * ss, j = (y * img.w + f * fw + x) * 4;
        img.d[j] = r / n; img.d[j + 1] = g / n; img.d[j + 2] = b / n; img.d[j + 3] = clamp01(a / n);
      }
    }
  }
  return img;
}

/** Premultiplied pixel accumulator. */
class Px {
  reset() { this.r = this.g = this.b = this.a = 0; }
  over(c, a) { if (a <= 0) return; a = clamp01(a); const ia = 1 - a; this.r = c[0] * a + this.r * ia; this.g = c[1] * a + this.g * ia; this.b = c[2] * a + this.b * ia; this.a = a + this.a * ia; }
  glow(c, k) { if (k <= 0) return; this.r += c[0] * k; this.g += c[1] * k; this.b += c[2] * k; this.a = 1 - (1 - this.a) * (1 - clamp01(k)); }
  shadow(k) { this.over([0.01, 0.01, 0.03], k); }
}

/** Lit surface colour from a normal: dark → base by diffuse, plus soft specular. */
function lit(n, dark, base, spec = 0.35) {
  const d = Math.max(0, dot3(n, L));
  const c = mix(dark, base, 0.15 + 0.85 * d);
  const h = [L[0], L[1], L[2] + 1]; const hl = Math.hypot(...h);
  const s = Math.pow(Math.max(0, dot3(n, h.map((v) => v / hl))), 28) * spec;
  return [c[0] + s, c[1] + s, c[2] + s];
}

// ---------------------------------------------------------------- obstacles (48x48)
const OB = MAP_ART.obstacleSize;
const OC = OB / 2;

/** Sphere-ish body with outer glow and drop shadow. surface(nx, ny, nz, r, th) → {col, emit} optional. */
function orbShader({ R, dark, base, rim, glow, glowK = 0.35, ring, surface, radius }) {
  const cD = hex(dark), cB = hex(base), cR = hex(rim), cG = hex(glow), cRing = ring ? hex(ring.c) : null;
  return (x, y, t, px) => {
    const dx = x - OC, dy = y - OC;
    const d = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    const Rr = radius ? radius(th) : R;
    // drop shadow
    const sd = Math.hypot(dx - 2, dy - 3);
    px.shadow(0.5 * (1 - smooth(Rr - 2, Rr + 3, sd)));
    // outer glow
    if (d > Rr - 1) px.glow(cG, glowK * Math.exp(-Math.pow((d - Rr) / 4.5, 2)));
    // back half of the ring
    const ringHit = (back) => {
      if (!cRing) return;
      const ex = dx / ring.rx, ey = dy / ring.ry;
      const er = Math.hypot(ex, ey);
      const isBack = dy < 0;
      if (isBack !== back) return;
      const k = Math.exp(-Math.pow((er - 1) / ring.w, 2));
      px.over(cRing, k * 0.85);
      px.glow(cRing, k * 0.25);
    };
    ringHit(true);
    if (d < Rr + 0.5) {
      const rr = Math.min(1, d / Rr);
      const nz = Math.sqrt(Math.max(0, 1 - rr * rr));
      const n = [dx / Rr, dy / Rr, nz];
      let col = lit(n, cD, cB);
      let emit = null;
      if (surface) { const s = surface(n, rr, th, x, y); if (s.col) col = s.col(col); emit = s.emit; }
      // rim light (accent from behind)
      const rimK = Math.pow(1 - nz, 3) * 0.9;
      col = mix(col, cR, clamp01(rimK));
      px.over(col, 1 - smooth(Rr - 0.5, Rr + 0.5, d));
      if (emit) px.glow(emit[0], emit[1]);
    }
    ringHit(false);
  };
}

/** Faceted elongated hexagonal crystal(s). */
function crystalShader({ parts, dark, base, rim, glow, core }) {
  const cD = hex(dark), cB = hex(base), cR = hex(rim), cG = hex(glow), cC = hex(core);
  const N = {
    left: [-0.75, 0, 0.66], front: [0, 0, 1], right: [0.75, 0, 0.66],
    tl: [-0.45, -0.6, 0.66], tr: [0.45, -0.6, 0.66], bl: [-0.45, 0.6, 0.66], br: [0.45, 0.6, 0.66]
  };
  const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
  Object.keys(N).forEach((k) => { N[k] = norm(N[k]); });
  return (x, y, t, px) => {
    // shadow + glow from union of parts
    let glowD = 99;
    parts.forEach((p) => {
      const sx = (x - p.x - 2) / p.w, sy = (y - p.y - 3) / p.h;
      if (Math.abs(sx) < 1 && Math.abs(sy) < 1 - Math.abs(sx) * 0.3) px.shadow(0.12);
      glowD = Math.min(glowD, Math.hypot((x - p.x) / (p.w + 1), (y - p.y) / (p.h + 1)));
    });
    px.glow(cG, 0.3 * Math.exp(-Math.pow(Math.max(0, glowD - 0.7) / 0.28, 2)));
    parts.forEach((p) => {
      const ux = (x - p.x) / p.w, uy = (y - p.y) / p.h, ax = Math.abs(ux);
      const hs = p.hs; // shoulder height (0..1)
      if (ax > 1 || Math.abs(uy) > hs + (1 - hs) * (1 - ax)) return;
      let f;
      if (uy < -hs + (ax) * 0) f = null;
      const capTop = uy < -hs * (1 - 0) && Math.abs(uy) > hs - 0.0001 && uy < 0;
      const capBot = uy > hs;
      if (uy < -hs) f = ux < 0 ? N.tl : N.tr;
      else if (capBot) f = ux < 0 ? N.bl : N.br;
      else f = ux < -0.32 ? N.left : ux > 0.32 ? N.right : N.front;
      void capTop;
      let col = lit(f, cD, cB, 0.55);
      // inner light: brighter towards the core
      const inner = Math.exp(-(ux * ux * 2 + uy * uy * 1.2) * 2.2);
      col = mix(col, cC, inner * 0.45);
      // facet edges: subtle bright seams
      const seam = Math.max(
        Math.exp(-Math.pow((ax - 0.32) / 0.05, 2)) * (Math.abs(uy) < hs ? 1 : 0),
        Math.exp(-Math.pow((Math.abs(uy) - hs) / 0.04, 2))
      );
      col = mix(col, cR, seam * 0.45);
      // edge rim
      const edge = Math.max(ax, Math.abs(uy) / (hs + (1 - hs) * (1 - ax)));
      col = mix(col, cR, Math.pow(edge, 8) * 0.7);
      px.over(col, 0.94);
    });
  };
}

/** Light torus (rings, portals). */
function torusShader({ R, tube, dark, base, glow, inner }) {
  const cD = hex(dark), cB = hex(base), cG = hex(glow), cI = inner ? hex(inner) : null;
  return (x, y, t, px) => {
    const dx = x - OC, dy = (y - OC) * 1.08, d = Math.hypot(dx, dy);
    const sd = Math.hypot(dx - 2, dy - 3);
    px.shadow(0.4 * Math.exp(-Math.pow((sd - R) / (tube + 1.5), 2)));
    px.glow(cG, 0.32 * Math.exp(-Math.pow((d - R) / (tube + 5), 2)));
    if (cI && d < R - tube) {
      const th = Math.atan2(dy, dx);
      const sw = 0.5 + 0.5 * Math.cos(2 * th + 6 * (d / R));
      px.glow(cI, (0.12 + 0.22 * sw) * (1 - d / R) + 0.1 * Math.exp(-d * d / 30));
    }
    const q = (d - R) / tube;
    if (Math.abs(q) < 1.05) {
      const nz = Math.sqrt(Math.max(0, 1 - q * q));
      const n = [(dx / (d || 1)) * q, (dy / (d || 1)) * q, nz];
      const col = lit(n, cD, cB, 0.6);
      px.over(col, 1 - smooth(0.95, 1.05, Math.abs(q)));
    }
  };
}

const noiseRadius = (R, amp, seed) => (th) => R * (1 + amp * (vnoise(((th + Math.PI) / TAU) * 8, 0.5, 8, seed) - 0.5) * 2);

const OBSTACLES = {
  codeBlock: crystalShader({
    parts: [{ x: 31, y: 27, w: 7, h: 13, hs: 0.45 }, { x: 15, y: 28, w: 6, h: 11, hs: 0.45 }, { x: 23, y: 23, w: 9, h: 17, hs: 0.5 }],
    dark: '#06263a', base: '#22d3ee', rim: '#cffafe', glow: '#22d3ee', core: '#a5f3fc'
  }),
  terminal: orbShader({
    R: 15, dark: '#05070f', base: '#1c2747', rim: '#22d3ee', glow: '#22d3ee', glowK: 0.25,
    ring: { c: '#67e8f9', rx: 21, ry: 6, w: 0.07 },
    surface: (n, rr) => ({ emit: [hex('#22d3ee'), Math.exp(-Math.pow(rr / 0.35, 2)) * 0.25] })
  }),
  serverRack: crystalShader({
    parts: [{ x: 15, y: 27, w: 6, h: 12, hs: 0.45 }, { x: 33, y: 29, w: 6, h: 11, hs: 0.45 }, { x: 24, y: 22, w: 9, h: 19, hs: 0.55 }],
    dark: '#1a0b3a', base: '#8b5cf6', rim: '#ede9fe', glow: '#8b5cf6', core: '#e879f9'
  }),
  memoryStick: crystalShader({
    parts: [{ x: 18, y: 27, w: 6, h: 14, hs: 0.5 }, { x: 29, y: 22, w: 7, h: 16, hs: 0.5 }],
    dark: '#3b0a3f', base: '#e879f9', rim: '#fdf4ff', glow: '#e879f9', core: '#f5d0fe'
  }),
  routerBox: orbShader({
    R: 13, dark: '#050b2a', base: '#2f6bff', rim: '#93c5fd', glow: '#3b82f6',
    ring: { c: '#22d3ee', rx: 20, ry: 7, w: 0.08 },
    surface: (n) => ({ col: (c) => mix(c, hex('#1e3a8a'), 0.35 * (0.5 + 0.5 * Math.sin(n[1] * 14))) })
  }),
  cableBundle: torusShader({ R: 13, tube: 4.5, dark: '#071a4a', base: '#60a5fa', glow: '#22d3ee', inner: '#3b82f6' }),
  cpuCore: orbShader({
    R: 16, dark: '#120605', base: '#4a2418', rim: '#f59e0b', glow: '#f97316', radius: noiseRadius(16, 0.12, 5),
    surface: (n, rr, th, x, y) => {
      const w = (fbm(x, y, 48, 3, 2, 12) - 0.5) * 10;
      const v = fbm(x + w, y - w, 48, 3, 3, 9), crack = Math.exp(-Math.pow((v - 0.5) / 0.035, 2));
      return { col: (c) => mix(c, [0.05, 0.02, 0.02], 0.3 * vnoise(x / 3, y / 3, 64, 4)), emit: [hex('#fbbf24'), crack * 0.8 * (0.4 + 0.6 * n[2])] };
    }
  }),
  registerBlock: orbShader({
    R: 14, dark: '#0c0606', base: '#3a2a26', rim: '#fb923c', glow: '#ef4444', glowK: 0.22, radius: noiseRadius(14, 0.16, 11),
    surface: (n, rr, th, x, y) => {
      const v = vnoise(x / 5, y / 5, 64, 21);
      return { col: (c) => mix(c, [0.02, 0.01, 0.01], 0.45 * vnoise(x / 2.5, y / 2.5, 64, 3)), emit: [hex('#f97316'), smooth(0.72, 0.85, v) * 0.6 * n[2]] };
    }
  }),
  cloudServer: orbShader({
    R: 15, dark: '#2a3170', base: '#c7d2fe', rim: '#e0f2fe', glow: '#a5b4fc', glowK: 0.4,
    surface: (n, rr, th, x, y) => ({ col: (c) => mix(c, hex('#eef2ff'), 0.35 * smooth(0.5, 0.8, vnoise(x / 6 + y / 14, y / 3, 64, 7))) })
  }),
  apiPortal: torusShader({ R: 14, tube: 3.5, dark: '#1e2a5a', base: '#bae6fd', glow: '#7dd3fc', inner: '#c4b5fd' }),
  voidFragment: orbShader({
    R: 15, dark: '#030208', base: '#2a1a4a', rim: '#e879f9', glow: '#8b5cf6', radius: noiseRadius(15, 0.22, 17),
    surface: (n, rr, th, x, y) => ({ col: (c) => mix(c, [0.01, 0, 0.03], 0.4 * vnoise(x / 3, y / 3, 64, 33)) })
  }),
  eventHorizon: orbShader({
    R: 12, dark: '#000000', base: '#07040e', rim: '#a78bfa', glow: '#f59e0b', glowK: 0.3,
    ring: { c: '#fbbf24', rx: 21, ry: 6.5, w: 0.09 }
  })
};

// ---------------------------------------------------------------- crate (32x32)
function crateShader() {
  const C = MAP_ART.crateSize / 2;
  const dark = hex('#141a33'), base = hex('#4b5694'), seam = hex('#22d3ee'), lamp = hex('#f59e0b');
  return (x, y, t, px) => {
    const sdBox = (cx, cy, hw, hh, r) => {
      const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    };
    const sh = sdBox(C + 1.5, C + 2.5, 11, 11, 5);
    px.shadow(0.5 * (1 - smooth(-1, 3, sh)));
    const d = sdBox(C, C, 11, 11, 5);
    px.glow(seam, 0.12 * Math.exp(-Math.pow(Math.max(0, d) / 3, 2)));
    if (d < 0.5) {
      const u = (x - C) / 11, v = (y - C) / 11;
      // pillowy bevel: normal from distance to edge
      const bevel = smooth(-4, 0, d);
      const n = [u * bevel * 0.9, v * bevel * 0.9, 1];
      const l = Math.hypot(...n);
      let col = lit(n.map((c) => c / l), dark, base, 0.4);
      // seam band with glow
      const band = Math.exp(-Math.pow(v / 0.08, 2));
      col = mix(col, hex('#0b1024'), Math.exp(-Math.pow(v / 0.16, 2)) * 0.6);
      px.over(col, 1 - smooth(-0.5, 0.5, d));
      px.glow(seam, band * 0.7 * (Math.abs(u) < 0.8 ? 1 : 0.3));
      const ld = Math.hypot(x - (C + 6), y - (C - 6));
      px.glow(lamp, Math.exp(-ld * ld / 3) * 0.9);
    }
  };
}

// ---------------------------------------------------------------- hazards (4-frame strips)
const HZ = MAP_ART.hazardSize;
const HC = HZ / 2;
const HR = HZ / 2 - 1.5;

/** Common area cue: faint fill + soft boundary so the damage radius reads at any scale. */
function area(px, r, col, fillK, edgeK) {
  if (r > 1.05) return;
  px.glow(col, fillK * (0.4 + 0.6 * r * r) * (1 - smooth(0.92, 1.02, r)));
  px.glow(col, edgeK * Math.exp(-Math.pow((r - 0.93) / 0.045, 2)));
}

const hazardShaders = {
  ringPulse: ({ ring, core, fill = ring }) => {
    const cR = hex(ring), cC = hex(core), cF = hex(fill);
    return (x, y, t, px) => {
      const r = Math.hypot(x - HC, y - HC) / HR;
      area(px, r, cF, 0.14, 0.22);
      for (let k = 0; k < 3; k++) {
        const p = frac(t + k / 3);
        const rad = 0.18 + p * 0.74;
        const k2 = Math.sin(Math.PI * p) * 0.75;
        px.glow(cR, k2 * Math.exp(-Math.pow((r - rad) / 0.05, 2)));
        px.glow(cR, k2 * 0.25 * Math.exp(-Math.pow((r - rad) / 0.14, 2)));
      }
      const beat = 0.75 + 0.25 * Math.cos(TAU * t);
      px.glow(cC, beat * Math.exp(-Math.pow(r / 0.16, 2)));
      px.glow(cR, beat * 0.35 * Math.exp(-Math.pow(r / 0.35, 2)));
    };
  },
  plasma: ({ a, b, hot, seed }) => {
    const cA = hex(a), cB = hex(b), cH = hex(hot);
    return (x, y, t, px) => {
      const dx = x - HC, dy = y - HC, r = Math.hypot(dx, dy) / HR;
      if (r > 1.1) return;
      const ox = Math.cos(TAU * t) * 3, oy = Math.sin(TAU * t) * 3;
      const n = fbm(x + ox, y + oy, 48, 3, 2, seed);
      const n2 = fbm(x - oy * 1.4, y + ox * 1.4, 48, 3, 2, seed + 5);
      const edge = 1 - smooth(0.78, 0.98, r + (n - 0.5) * 0.3);
      if (edge <= 0) { px.glow(cA, 0.15 * Math.exp(-Math.pow((r - 0.95) / 0.08, 2))); return; }
      const col = mix(cB, cA, 0.25 + 0.35 * smooth(0.25, 0.8, n2) + 0.4 * r * r);
      px.over(col, edge * (0.35 + 0.25 * r));
      const rimK = edge * Math.exp(-Math.pow((r + (n - 0.5) * 0.3 - 0.8) / 0.07, 2));
      px.glow(cA, rimK * 0.6);
      px.glow(cH, smooth(0.68, 0.85, n2) * edge * 0.3);
      // bubbles
      const bub = Math.pow(smooth(0.7, 0.9, fbm(x * 1.5 - ox, y * 1.5 + oy, 72, 6, 2, seed + 9)), 2);
      px.glow(cH, bub * edge * 0.6);
    };
  },
  motes: ({ c, core, rings }) => {
    const cM = hex(c), cC = hex(core);
    return (x, y, t, px) => {
      const dx = x - HC, dy = y - HC, r = Math.hypot(dx, dy) / HR;
      area(px, r, cM, 0.1, 0.16);
      px.glow(cM, 0.2 * Math.exp(-Math.pow(r / 0.45, 2)));
      rings.forEach(([rad, n, dir, size]) => {
        for (let i = 0; i < n; i++) {
          const ang = (TAU * (i + dir * t)) / n + rad * 3;
          const mx = HC + Math.cos(ang) * rad * HR, my = HC + Math.sin(ang) * rad * HR * 0.9;
          const d2 = (x - mx) ** 2 + (y - my) ** 2;
          px.glow(cC, Math.exp(-d2 / (2 * size * size)) * 0.9);
          px.glow(cM, Math.exp(-d2 / (2 * (size * 2.6) ** 2)) * 0.35);
        }
      });
    };
  },
  arcs: ({ c, hot }) => {
    const cA = hex(c), cH = hex(hot);
    return (x, y, t, px) => {
      const dx = x - HC, dy = y - HC, r = Math.hypot(dx, dy) / HR, th = Math.atan2(dy, dx);
      area(px, r, cA, 0.12, 0.1);
      const u = (th + Math.PI) / TAU;
      for (let k = 0; k < 2; k++) {
        const jag = vnoise(u * 16 + k * 5, t * 4, 16, 40 + k) - 0.5;
        const rad = 0.72 + k * 0.14 + jag * 0.16;
        const line = Math.exp(-Math.pow((r - rad) / 0.03, 2));
        const vis = smooth(0.25, 0.6, vnoise(u * 6 + k * 3, t * 4, 6, 50 + k));
        px.glow(cH, line * vis * 0.95);
        px.glow(cA, Math.exp(-Math.pow((r - rad) / 0.1, 2)) * vis * 0.4);
      }
      px.glow(cA, 0.4 * Math.exp(-Math.pow(r / 0.3, 2)) * (0.8 + 0.2 * Math.cos(TAU * t)));
    };
  },
  dissolve: ({ c, core }) => {
    const cA = hex(c), cC = hex(core);
    return (x, y, t, px) => {
      const dx = x - HC, dy = y - HC, r = Math.hypot(dx, dy) / HR, th = Math.atan2(dy, dx);
      area(px, r, cA, 0.1, 0.05);
      const n = 10, seg = ((th + Math.PI) / TAU) * n, i = Math.floor(seg), fpos = seg - i;
      const on = 0.5 + 0.5 * Math.cos(TAU * (t + i / n * 3));
      const dash = smooth(0.08, 0.2, fpos) * (1 - smooth(0.8, 0.92, fpos));
      px.glow(cA, dash * on * Math.exp(-Math.pow((r - 0.86) / 0.06, 2)) * 0.9);
      const n2 = 7, seg2 = ((th + Math.PI) / TAU) * n2 + t, i2 = Math.floor(seg2), f2 = seg2 - i2;
      const on2 = 0.5 + 0.5 * Math.cos(TAU * (t * 2 + i2 * 0.37));
      px.glow(cC, smooth(0.15, 0.3, f2) * (1 - smooth(0.7, 0.85, f2)) * on2 * Math.exp(-Math.pow((r - 0.55) / 0.05, 2)) * 0.7);
      px.glow(cC, 0.35 * Math.exp(-Math.pow(r / 0.2, 2)));
    };
  },
  vortex: ({ arm, hot, rim }) => {
    const cA = hex(arm), cH = hex(hot), cR = hex(rim);
    return (x, y, t, px) => {
      const dx = x - HC, dy = y - HC, r = Math.hypot(dx, dy) / HR, th = Math.atan2(dy, dx);
      if (r > 1.08) return;
      const env = (1 - smooth(0.7, 1.0, r));
      const arms = Math.pow(0.5 + 0.5 * Math.cos(3 * th + 6 * Math.log(r + 0.08) + TAU * t), 2.5);
      px.glow(cA, env * (0.12 + arms * 0.55) * smooth(0.15, 0.3, r));
      px.glow(cH, env * arms * 0.3 * Math.exp(-Math.pow((r - 0.35) / 0.15, 2)));
      px.over([0, 0, 0.01], 1 - smooth(0.17, 0.22, r));
      px.glow(cR, Math.exp(-Math.pow((r - 0.22) / 0.03, 2)) * 0.9);
    };
  },
  sparkle: ({ c, hot, seed }) => {
    const cA = hex(c), cH = hex(hot);
    const rng = mulberry32(seed);
    const pts = Array.from({ length: 14 }, () => {
      const a = rng() * TAU, rr = Math.sqrt(rng()) * 0.85;
      return [HC + Math.cos(a) * rr * HR, HC + Math.sin(a) * rr * HR, rng(), 0.8 + rng() * 1.2];
    });
    return (x, y, t, px) => {
      const r = Math.hypot(x - HC, y - HC) / HR;
      area(px, r, cA, 0.14, 0.14);
      pts.forEach(([sx, sy, ph, sz]) => {
        const tw = Math.pow(0.5 + 0.5 * Math.cos(TAU * (t + ph)), 2);
        const dx = x - sx, dy = y - sy, d2 = dx * dx + dy * dy;
        px.glow(cH, tw * Math.exp(-d2 / (2 * sz * sz * 0.4)) * 0.95);
        const cross = (Math.exp(-(dy * dy) / 0.5) * Math.exp(-Math.abs(dx) / (sz * 2)) + Math.exp(-(dx * dx) / 0.5) * Math.exp(-Math.abs(dy) / (sz * 2)));
        px.glow(cA, tw * cross * 0.45);
      });
    };
  }
};

const HAZARDS = {
  bugSwarm: ['motes', { c: '#f59e0b', core: '#fde68a', rings: [[0.3, 3, 1, 1.3], [0.55, 5, -1, 1.2], [0.8, 7, 1, 1.1]] }],
  nullDeref: ['ringPulse', { ring: '#fde68a', core: '#ffffff', fill: '#f59e0b' }],
  memoryLeak: ['plasma', { a: '#e879f9', b: '#5b21b6', hot: '#fae8ff', seed: 301 }],
  heapFragment: ['motes', { c: '#e879f9', core: '#fdf4ff', rings: [[0.35, 4, -1, 1.5], [0.7, 6, 1, 1.3]] }],
  packetStorm: ['arcs', { c: '#22d3ee', hot: '#ecfeff' }],
  packetLoss: ['dissolve', { c: '#60a5fa', core: '#bfdbfe' }],
  kernelPanic: ['ringPulse', { ring: '#f87171', core: '#fde68a', fill: '#ef4444' }],
  thermal: ['plasma', { a: '#f59e0b', b: '#7f1d1d', hot: '#fef3c7', seed: 333 }],
  latencySpike: ['ringPulse', { ring: '#93c5fd', core: '#f59e0b', fill: '#3b82f6' }],
  coldStart: ['plasma', { a: '#bae6fd', b: '#1e3a8a', hot: '#ffffff', seed: 377 }],
  blackHole: ['vortex', { arm: '#8b5cf6', hot: '#e879f9', rim: '#fcd34d' }],
  entropyField: ['sparkle', { c: '#f59e0b', hot: '#fffbeb', seed: 411 }]
};

// ---------------------------------------------------------------- zones (hard-pixel art, 4-frame strips)
// Zones are gameplay signs, so unlike the smooth environment they are crisp pixel art: a translucent
// disc with a dotted (rotating) border in the effect colour + a 16x16 icon saying what the zone does.
const ZS = MAP_ART.zoneSize;
const IS = MAP_ART.iconSize;
const OUTLINE = '#0b1020';

/** Straight-alpha RGBA pixel canvas (no antialiasing) -> PNG. */
class PixCanvas {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  set(x, y, color, a = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const c = hex(color), j = (y * this.w + x) * 4;
    this.d[j] = Math.round(c[0] * 255); this.d[j + 1] = Math.round(c[1] * 255); this.d[j + 2] = Math.round(c[2] * 255);
    this.d[j + 3] = Math.round(clamp01(a) * 255);
  }
  alpha(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.d[(y * this.w + x) * 4 + 3]; }
  /** Blit `src` at (ox, oy). */
  blit(src, ox, oy) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const j = (y * src.w + x) * 4, k = ((oy + y) * this.w + ox + x) * 4;
      if (src.d[j + 3]) for (let c = 0; c < 4; c++) this.d[k + c] = src.d[j + c];
    }
  }
}

async function writePix(c, file) {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(Buffer.from(c.d.buffer), { raw: { width: c.w, height: c.h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
  written.push(file);
}

/** One 16x16 icon frame: paint(set) draws the body, then a 1 px dark outline is added around it. */
function iconFrame(paint) {
  const c = new PixCanvas(IS, IS);
  paint((x, y, col, a = 1) => c.set(x, y, col, a));
  const body = [];
  for (let y = 0; y < IS; y++) for (let x = 0; x < IS; x++) if (c.alpha(x, y)) body.push([x, y]);
  const isBody = (x, y) => c.alpha(x, y) > 0;
  const ring = [];
  for (let y = 0; y < IS; y++) for (let x = 0; x < IS; x++) {
    if (isBody(x, y)) continue;
    if (isBody(x - 1, y) || isBody(x + 1, y) || isBody(x, y - 1) || isBody(x, y + 1)) ring.push([x, y]);
  }
  ring.forEach(([x, y]) => c.set(x, y, OUTLINE, 1));
  return c;
}

/** Bitmap rows -> paint: chars map to colours, '.' is empty. */
const bitmap = (rows, pal, ox = 0, oy = 0) => (set) => rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) set(x + ox, y + oy, pal[ch]); }));

const ICONS = {
  /** Double chevron pointing up (speed up): the bright chevron alternates, and the pair hops 1 px. */
  boostZone: (f) => iconFrame((set) => {
    const lift = f === 1 || f === 2 ? -1 : 0;
    [2, 8].forEach((apex, k) => {
      const col = (f % 2) === k ? '#cffafe' : '#22d3ee';
      for (let r = 0; r < 5; r++) {
        const y = apex + r + 1 + lift;
        set(7 - r, y, col); set(8 + r, y, col);
        set(7 - r, y + 1, '#0e7490'); set(8 + r, y + 1, '#0e7490');
      }
    });
  }),
  /** Hourglass (slow): the sand runs from the top bulb to the bottom one. */
  slowZone: (f) => iconFrame((set) => {
    const hw = [5, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 5];
    for (let x = 2; x <= 13; x++) { set(x, 1, '#a78bfa'); set(x, 14, '#a78bfa'); }
    for (let i = 0; i < hw.length; i++) {
      const y = 2 + i;
      for (let x = 8 - hw[i]; x <= 7 + hw[i]; x++) set(x, y, '#2e1065', 0.9);
      set(8 - hw[i] - 0, y, '#7c3aed'); set(7 + hw[i], y, '#7c3aed');
    }
    const sand = '#f5d0fe';
    for (let y = 3 + f; y <= 6; y++) { const i = y - 2; for (let x = 9 - hw[i]; x <= 6 + hw[i]; x++) set(x, y, sand); }
    for (let y = 12 - f; y <= 13; y++) { const i = y - 2; for (let x = 9 - hw[i]; x <= 6 + hw[i]; x++) set(x, y, sand); }
    for (let y = 7; y < 12 - f; y++) set(f % 2 ? 8 : 7, y, sand);
  }),
  /** Skull (damage): amber while idle (frames 0-1), red with hot eyes while the pulse hurts (2-3). */
  pulseDamage: (f) => {
    const active = f >= 2;
    const pal = {
      c: active ? '#ef4444' : '#f59e0b',
      h: active ? '#fecaca' : '#fde68a',
      e: active ? (f === 3 ? '#ffffff' : '#fde047') : (f === 1 ? '#7c2d12' : '#1c0a00'),
      t: active ? '#7f1d1d' : '#78350f'
    };
    return iconFrame(bitmap([
      '................',
      '.....hhhhhh.....',
      '....hccccccc....',
      '...hccccccccc...',
      '...cccccccccc...',
      '...ceeecceeec...',
      '...ceeecceeec...',
      '...cccceecccc...',
      '....cccccccc....',
      '....ctctctcc....',
      '....cccccccc....',
      '.....cccccc.....',
      '................',
      '................',
      '................',
      '................'
    ], pal, 0, 1));
  },
  /** Three wind streaks blowing right (+x; rotated at runtime with the wind): a gap travels along each. */
  wind: (f) => iconFrame((set) => {
    const lines = [[4, 2, 10], [8, 0, 13], [12, 3, 9]];
    lines.forEach(([y, x0, x1], k) => {
      const len = x1 - x0 + 1;
      const gap = x0 + ((f * 3 + k * 4) % len);
      for (let x = x0; x <= x1; x++) if (x !== gap && x !== gap + 1) set(x, y, x >= x1 - 1 ? '#eef2ff' : '#c4b5fd');
      set(x1 + 1, y - 1, '#c4b5fd'); set(x1, y - 2, '#c4b5fd');
    });
  }),
  /** Spiral pulled into a gold core (gravity): turns a quarter per frame. */
  gravity: (f) => iconFrame((set) => {
    const rot = (f / 4) * TAU;
    for (let s = 0; s <= 260; s++) {
      const th = (s / 260) * 3 * Math.PI;
      const r = 1.2 + th * 0.62;
      if (r > 7.2) break;
      set(Math.floor(7.5 + Math.cos(th + rot) * r + 0.5), Math.floor(7.5 + Math.sin(th + rot) * r + 0.5), r > 4.5 ? '#8b5cf6' : '#c4b5fd');
    }
    set(7, 7, '#fcd34d'); set(8, 7, '#fcd34d'); set(7, 8, '#fcd34d'); set(8, 8, '#fde68a');
  }),
  /** Teleport end letters: frame 0 = A, 1 = B, 2/3 = highlighted A/B. */
  teleport: (f) => {
    const A = ['..XXXX..', '.XXXXXX.', 'XX....XX', 'XX....XX', 'XXXXXXXX', 'XXXXXXXX', 'XX....XX', 'XX....XX', 'XX....XX', 'XX....XX'];
    const B = ['XXXXXX..', 'XXXXXXX.', 'XX...XX.', 'XX...XX.', 'XXXXXX..', 'XXXXXXX.', 'XX....XX', 'XX....XX', 'XXXXXXX.', 'XXXXXX..'];
    return iconFrame(bitmap(f % 2 ? B : A, { X: f >= 2 ? '#fef9c3' : '#ffffff' }, 4, 3));
  }
};

/**
 * Zone disc (64x64): translucent fill, faint inner ring, a 2 px dotted border whose dashes advance a
 * quarter step per frame (seamless loop), and a dark rim for contrast on bright nebulae.
 */
function zoneDisc({ c, hot, fill = 0.16, frames = 4, style = () => ({}) }) {
  const strip = new PixCanvas(ZS * frames, ZS);
  const C = ZS / 2 - 0.5, R = ZS / 2 - 2;
  const DASHES = 14;
  for (let f = 0; f < frames; f++) {
    const st = { c, hot, fill, phase: f / frames, ...style(f) };
    const fr = new PixCanvas(ZS, ZS);
    for (let y = 0; y < ZS; y++) for (let x = 0; x < ZS; x++) {
      const dx = x - C, dy = y - C, d = Math.hypot(dx, dy);
      if (d > R + 1) continue;
      if (d > R) { fr.set(x, y, OUTLINE, 0.55); continue; }
      if (d > R - 2) {
        const u = frac(((Math.atan2(dy, dx) + Math.PI) / TAU) * DASHES + st.phase * 0.5);
        fr.set(x, y, u < 0.5 ? st.hot : st.c, u < 0.5 ? 0.95 : 0.35);
        continue;
      }
      if (d > R - 8 && d <= R - 7) { fr.set(x, y, st.c, 0.3); continue; }
      fr.set(x, y, st.c, st.fill);
    }
    strip.blit(fr, f * ZS, 0);
  }
  return strip;
}

const ZONES = {
  boostZone: () => zoneDisc({ c: '#22d3ee', hot: '#cffafe' }),
  slowZone: () => zoneDisc({ c: '#a78bfa', hot: '#ede9fe', fill: 0.2 }),
  // teleport zones render as portals; the disc stays a neutral fallback
  teleport: () => zoneDisc({ c: '#22d3ee', hot: '#ffffff', fill: 0.12 }),
  // frames 0-1 idle (amber, calm), 2-3 active (red, hot): MapManager picks the frame from the pulse phase
  pulseDamage: () => zoneDisc({ c: '#f59e0b', hot: '#fde68a', fill: 0.14, style: (f) => (f >= 2 ? { c: '#ef4444', hot: '#fecaca', fill: 0.32 } : {}) }),
  wind: () => zoneDisc({ c: '#c4b5fd', hot: '#eef2ff', fill: 0.1 }),
  gravity: () => zoneDisc({ c: '#8b5cf6', hot: '#fcd34d', fill: 0.18 })
};

async function writeZones() {
  for (const m of BIOME_MECHANICS) {
    if (!ZONES[m] || !ICONS[m]) throw new Error(`missing zone/icon recipe for ${m}`);
    await writePix(ZONES[m](), join(MAP_DIR, `zone-${m}.png`));
    const strip = new PixCanvas(IS * MAP_ART.iconFrames, IS);
    for (let f = 0; f < MAP_ART.iconFrames; f++) strip.blit(ICONS[m](f), f * IS, 0);
    await writePix(strip, join(MAP_DIR, `zone-icon-${m}.png`));
  }
}

// ---------------------------------------------------------------- borders (32x32, tileable, opaque)
const BORDERS = {
  'debug-zone': { dark: '#06142a', glow: '#22d3ee', hot: '#cffafe' },
  'memory-banks': { dark: '#140830', glow: '#8b5cf6', hot: '#f5d0fe' },
  'network-layer': { dark: '#06103a', glow: '#3b82f6', hot: '#a5f3fc' },
  'kernel-space': { dark: '#1f0806', glow: '#f97316', hot: '#fde68a' },
  'cloud-cluster': { dark: '#141c44', glow: '#a5b4fc', hot: '#f0f9ff' },
  singularity: { dark: '#0c0518', glow: '#8b5cf6', hot: '#fcd34d' }
};

function drawBorder(id, i) {
  const B = MAP_ART.borderSize;
  const r = BORDERS[id];
  const cD = hex(r.dark), cG = hex(r.glow), cH = hex(r.hot);
  const img = new Img(B, B);
  const seed = 900 + i * 17;
  for (let y = 0; y < B; y++) {
    for (let x = 0; x < B; x++) {
      const k = y * B + x;
      // calm energy slab: low-contrast plasma + faint smooth filaments (no motif that reads as a wallpaper)
      const base = fbm(x, y, B, 2, 3, seed);
      img.over(k, mix(cD, mix(cD, cG, 0.18), smooth(0.2, 0.8, base)), 1);
      const wx = (fbm(x, y, B, 2, 2, seed + 3) - 0.5) * 10;
      const v = fbm(x + wx, y - wx, B, 2, 3, seed + 7);
      const fil = Math.exp(-Math.pow((v - 0.5) / 0.05, 2));
      img.add(k, cG, fil * 0.16 + 0.07);
      img.add(k, cH, Math.pow(fil, 4) * 0.08);
    }
  }
  return img;
}

// ---------------------------------------------------------------- main
async function main() {
  mkdirSync(BG_DIR, { recursive: true });
  mkdirSync(MAP_DIR, { recursive: true });
  if (ZONES_ONLY) {
    await writeZones();
    console.log(`wrote ${written.length} PNGs (zones + icons)`);
    return;
  }
  const biomes = Object.values(BIOMES);
  for (const [i, b] of biomes.entries()) {
    const recipe = BG[b.id];
    if (!recipe || !BORDERS[b.id]) throw new Error(`missing background/border recipe for biome ${b.id}`);
    await writePng(drawFar(b.id, recipe), join(BG_DIR, `${b.id}-far.png`), { opaque: true, dither: 1.2 / 255, seed: i + 1 });
    await writePng(drawNear(b.id, recipe), join(BG_DIR, `${b.id}-near.png`), { dither: 0.6 / 255, seed: i + 50 });
    await writePng(drawBorder(b.id, i), join(MAP_DIR, `border-${b.id}.png`), { opaque: true });
  }
  for (const t of Object.keys(OBSTACLE_DEFS)) {
    if (!OBSTACLES[t]) throw new Error(`missing obstacle recipe for ${t}`);
    await writePng(renderStrip(OB, OB, 1, OBSTACLES[t]), join(MAP_DIR, `obstacle-${t}.png`));
  }
  for (const t of Object.keys(HAZARD_DEFS)) {
    if (!HAZARDS[t]) throw new Error(`missing hazard recipe for ${t}`);
    const [kind, opts] = HAZARDS[t];
    await writePng(renderStrip(HZ, HZ, MAP_ART.hazardFrames, hazardShaders[kind](opts)), join(MAP_DIR, `hazard-${t}.png`));
  }
  await writeZones();
  await writePng(renderStrip(MAP_ART.crateSize, MAP_ART.crateSize, 1, crateShader()), join(MAP_DIR, 'crate.png'));

  if (PREVIEW) {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    for (const b of biomes) {
      for (const layer of ['far', 'near']) {
        const src = join(BG_DIR, `${b.id}-${layer}.png`);
        const tile = { input: src };
        await sharp({ create: { width: S * 2, height: S * 2, channels: 4, background: '#000000ff' } })
          .composite([{ ...tile, left: 0, top: 0 }, { ...tile, left: S, top: 0 }, { ...tile, left: 0, top: S }, { ...tile, left: S, top: S }])
          .png().toFile(join(PREVIEW_DIR, `${b.id}-${layer}-2x2.png`));
      }
    }
  }
  if (SHEET) await contactSheet(biomes);
  console.log(`wrote ${written.length} PNGs`);
}

/** far | far+near (2x2 tiled, shows seams) | near on black, per biome at 256 px; then every map sprite. */
async function contactSheet(biomes) {
  const T = 256, G = 12, W = 6 * (T + G) + G;
  const comps = [];
  const bgFile = (id, l) => join(BG_DIR, `${id}-${l}.png`);
  for (const [i, b] of biomes.entries()) {
    const x = G + i * (T + G);
    comps.push({ input: await sharp(bgFile(b.id, 'far')).resize(T, T, { kernel: 'lanczos3' }).toBuffer(), left: x, top: G });
    const tile2 = await sharp({ create: { width: S * 2, height: S * 2, channels: 4, background: '#000000ff' } })
      .composite([0, 1, 2, 3].flatMap((q) => {
        const left = (q % 2) * S, top = Math.floor(q / 2) * S;
        return [{ input: bgFile(b.id, 'far'), left, top }, { input: bgFile(b.id, 'near'), left, top }];
      })).png().toBuffer();
    comps.push({ input: await sharp(tile2).resize(T, T, { kernel: 'lanczos3' }).toBuffer(), left: x, top: G * 2 + T });
    const nearOnBlack = await sharp({ create: { width: S, height: S, channels: 4, background: '#000000ff' } })
      .composite([{ input: bgFile(b.id, 'near') }]).png().toBuffer();
    comps.push({ input: await sharp(nearOnBlack).resize(T, T, { kernel: 'lanczos3' }).toBuffer(), left: x, top: G * 3 + T * 2 });
  }
  let y = G * 4 + T * 3;
  const place = async (files, scale, perRow) => {
    let col = 0, rowH = 0, x = G;
    for (const f of files) {
      const meta = await sharp(f).metadata();
      const w = meta.width * scale, h = meta.height * scale;
      if (col === perRow) { col = 0; x = G; y += rowH + G; rowH = 0; }
      comps.push({ input: await sharp(f).resize(w, h, { kernel: 'cubic' }).toBuffer(), left: x, top: y });
      x += w + G; col++; rowH = Math.max(rowH, h);
    }
    y += rowH + G * 2;
  };
  const m = (n) => join(MAP_DIR, n);
  await place(Object.keys(OBSTACLE_DEFS).map((t) => m(`obstacle-${t}.png`)).concat([m('crate.png')]), 2, 13);
  // borders shown 3x3 tiled to reveal seams
  const borderTiles = [];
  for (const b of biomes) {
    const f = m(`border-${b.id}.png`), B = MAP_ART.borderSize;
    const buf = await sharp({ create: { width: B * 3, height: B * 3, channels: 4, background: '#000000ff' } })
      .composite([...Array(9)].map((_, k) => ({ input: f, left: (k % 3) * B, top: Math.floor(k / 3) * B }))).png().toBuffer();
    const tmp = join(PREVIEW_DIR, `sheet-border-${b.id}.png`);
    mkdirSync(PREVIEW_DIR, { recursive: true });
    await sharp(buf).toFile(tmp);
    borderTiles.push(tmp);
  }
  await place(borderTiles, 2, 6);
  await place(Object.keys(HAZARD_DEFS).map((t) => m(`hazard-${t}.png`)), 2, 4);
  await place(BIOME_MECHANICS.map((z) => m(`zone-${z}.png`)), 2, 3);
  await place(BIOME_MECHANICS.map((z) => m(`zone-icon-${z}.png`)), 6, 3);
  mkdirSync(dirname(SHEET_PATH), { recursive: true });
  await sharp({ create: { width: W, height: y, channels: 4, background: '#0b1024ff' } })
    .composite(comps).png().toFile(SHEET_PATH);
  console.log(`contact sheet: ${SHEET_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
