#!/usr/bin/env node
/**
 * Deterministic generator for the animated space background (title-screen look, one variant per stage).
 *
 *   node scripts/assets/gen-space-bg.mjs            # write every PNG
 *   node scripts/assets/gen-space-bg.mjs --sheet    # also a contact sheet at scripts/evil-player/reports/space-bg-sheet.png
 *
 * Style: hard pixel art like public/assets/backgrounds/blue/blue-back.png — 4x4 ordered (Bayer) dithering,
 * a 6-tone ramp + 3-tone accent hue per variant, 1-2 px stars, no smooth gradients, no antialiasing.
 * Displayed nearest-neighbour at tileScale 2-3 (src/data/biomes.js SPACE_BG).
 *
 * Output (public/assets/backgrounds/space/):
 *   <variant>/back.png      512x512 opaque nebula (tileable)
 *   <variant>/stars-a.png   512x512 alpha star field, twinkle frame A (tileable)
 *   <variant>/stars-b.png   same stars, the twinkling groups swapped
 *   <variant>/near.png      512x512 alpha wisps (tileable)
 *   <variant>/prop-<name>.png  64x64 loose props (planet / asteroid / ring / vortex)
 *   mote.png                3x3 white mote (tinted at runtime)
 * Tiling: periodic value noise (lattice indices mod the period); star writes wrap mod 512.
 * Palettes come from SPACE_PALETTES in src/data/biomes.js.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPACE_PALETTES, SPACE_BG } from '../../src/data/biomes.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/assets/backgrounds/space');
const SHEET = process.argv.includes('--sheet');
const S = SPACE_BG.tileSize;
const P = SPACE_BG.propSize;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- helpers
const rgb = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
const bayer = (x, y) => BAYER[(x & 3) + (y & 3) * 4];

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
/** Periodic value noise: u,v in [0,1) units, `per` lattice cells per unit (tiles at integer u/v). */
function vnoise(u, v, per, seed) {
  const x = u * per; const y = v * per;
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const fx = x - x0; const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
  const m = (i) => ((i % per) + per) % per;
  const a = hash2(m(x0), m(y0), seed); const b = hash2(m(x0 + 1), m(y0), seed);
  const c = hash2(m(x0), m(y0 + 1), seed); const d = hash2(m(x0 + 1), m(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(u, v, per, oct, seed, gain = 0.5) {
  let sum = 0; let amp = 1; let norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += vnoise(u, v, per << o, seed + o * 101) * amp;
    norm += amp; amp *= gain;
  }
  return sum / norm;
}

function canvas(w, h) { return { w, h, d: new Uint8ClampedArray(w * h * 4) }; }
function put(img, x, y, c, a = 255, wrap = true) {
  if (wrap) { x = ((x % img.w) + img.w) % img.w; y = ((y % img.h) + img.h) % img.h; } else if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  img.d[i] = c[0]; img.d[i + 1] = c[1]; img.d[i + 2] = c[2]; img.d[i + 3] = a;
}
async function writePng(img, file) {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(Buffer.from(img.d.buffer), { raw: { width: img.w, height: img.h, channels: 4 } }).png({ compressionLevel: 9, palette: false }).toFile(file);
}

// ---------------------------------------------------------------- layers
const VARIANT_SEEDS = { 'debug-zone': 11, 'memory-banks': 23, 'network-layer': 37, 'kernel-space': 41, 'cloud-cluster': 53, singularity: 67 };

/** Opaque nebula: domain-warped fbm + ridged filaments + diagonal streaks, ordered-dithered to the ramp. */
function drawBack(id, pal, seed) {
  const img = canvas(S, S);
  const base = pal.base.map(rgb); const acc = pal.accent.map(rgb);
  const swirl = id === 'singularity' ? 0.55 : 0.32;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S; const v = y / S;
      const wx = fbm(u, v, 3, 3, seed + 1) - 0.5; const wy = fbm(u, v, 3, 3, seed + 2) - 0.5;
      const uw = u + swirl * wx; const vw = v + swirl * wy;
      const n = fbm(uw + 2, vw + 2, 4, 5, seed);
      const ridge = Math.pow(1 - Math.abs(2 * fbm(uw + 2, vw + 2, 8, 4, seed + 3) - 1), 9);
      const streak = Math.pow(vnoise(u + v, 0, 48, seed + 4), 3) * smooth(0.5, 0.8, fbm(u, v, 2, 2, seed + 5));
      const big = smooth(0.25, 0.75, fbm(u, v, 2, 2, seed + 6));
      let val = smooth(0.38, 0.82, n) * (0.25 + 0.75 * big) * 0.62 + ridge * 0.5 * (0.4 + 0.6 * big) + streak * 0.25;
      val = clamp01(val * 1.12);
      const t = bayer(x, y);
      const idx = Math.max(0, Math.min(base.length - 1, Math.floor(val * (base.length - 0.6) + 0.5 + t * 0.95)));
      const am = fbm(u + 5, v + 5, 2, 3, seed + 7) + t * 0.08;
      let c = base[idx];
      if (idx > 0 && am > 0.66) c = acc[Math.min(acc.length - 1, Math.floor((idx - 1) * acc.length / (base.length - 1)))];
      put(img, x, y, c);
    }
  }
  return img;
}

/** Alpha wisps: thin ridged filaments in 3 tones, everything else transparent; a little dust. */
function drawNear(id, pal, seed) {
  const img = canvas(S, S);
  const cols = pal.near.map(rgb);
  const alphas = [110, 160, 210];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S; const v = y / S;
      const wx = fbm(u, v, 2, 3, seed + 21) - 0.5; const wy = fbm(u, v, 2, 3, seed + 22) - 0.5;
      const r = Math.pow(1 - Math.abs(2 * fbm(u + 0.4 * wx, v + 0.4 * wy, 5, 4, seed + 23) - 1), 7);
      const mask = smooth(0.42, 0.7, fbm(u, v, 2, 2, seed + 24));
      const val = r * mask + bayer(x, y) * 0.12;
      if (val < 0.3) continue;
      const lvl = val < 0.45 ? 0 : val < 0.62 ? 1 : 2;
      put(img, x, y, cols[lvl], alphas[lvl]);
    }
  }
  const rnd = mulberry32(seed + 25);
  for (let i = 0; i < 260; i++) put(img, Math.floor(rnd() * S), Math.floor(rnd() * S), cols[Math.floor(rnd() * 2)], 90 + Math.floor(rnd() * 70));
  return img;
}

/** Two twinkle frames: same stars, the twinkling groups swap bright/dim between A and B. */
function drawStars(pal, seed) {
  const a = canvas(S, S); const b = canvas(S, S);
  const cols = pal.stars.map(rgb);
  const rnd = mulberry32(seed + 31);
  const both = (fn) => { fn(a, 0); fn(b, 1); };
  // 1 px stars: 60% steady, 40% twinkle in two groups.
  for (let i = 0; i < 320; i++) {
    const x = Math.floor(rnd() * S); const y = Math.floor(rnd() * S);
    const c = cols[rnd() < 0.6 ? 0 : 1 + Math.floor(rnd() * 2)];
    const base = 120 + Math.floor(rnd() * 100);
    const g = rnd() < 0.6 ? -1 : (rnd() < 0.5 ? 0 : 1);
    both((img, f) => put(img, x, y, c, g < 0 ? base : (g === f ? 255 : 70)));
  }
  // 2 px stars (2x1 / 1x2): brighter, all twinkle.
  for (let i = 0; i < 36; i++) {
    const x = Math.floor(rnd() * S); const y = Math.floor(rnd() * S);
    const c = cols[Math.floor(rnd() * 2)]; const g = i % 2; const horiz = rnd() < 0.5;
    both((img, f) => {
      const al = g === f ? 255 : 120;
      put(img, x, y, c, al); put(img, x + (horiz ? 1 : 0), y + (horiz ? 0 : 1), c, al);
    });
  }
  // Crosses (like blue-stars.png): centre always lit, arms only on the group's bright frame.
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(rnd() * S); const y = Math.floor(rnd() * S);
    const c = cols[1 + (i % 2)]; const g = i % 2;
    both((img, f) => {
      put(img, x, y, cols[0], 255);
      const arm = g === f ? 2 : 1; const al = g === f ? 230 : 140;
      for (let k = 1; k <= arm; k++) { put(img, x + k, y, c, al); put(img, x - k, y, c, al); put(img, x, y + k, c, al); put(img, x, y - k, c, al); }
    });
  }
  return [a, b];
}

// ---------------------------------------------------------------- props (64x64, hard edges, dithered shading)
const LIGHT = (() => { const l = [-0.55, -0.6, 0.58]; const m = Math.hypot(...l); return l.map((v) => v / m); })();

function shadeSphere(img, cx, cy, R, ramp, seed, { bands = 0, crater = 0 } = {}) {
  const rnd = mulberry32(seed);
  const craters = Array.from({ length: crater }, () => [cx + (rnd() - 0.5) * R * 1.2, cy + (rnd() - 0.5) * R * 1.2, 1.5 + rnd() * R * 0.18]);
  for (let y = Math.floor(cy - R); y <= cy + R; y++) {
    for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      const dx = (x + 0.5 - cx) / R; const dy = (y + 0.5 - cy) / R;
      const rr = dx * dx + dy * dy;
      if (rr > 1) continue;
      const dz = Math.sqrt(1 - rr);
      let l = clamp01(dx * LIGHT[0] + dy * LIGHT[1] + dz * LIGHT[2]);
      if (bands) l += (vnoise((dy + 1) * 0.5, (dx + 1) * 0.08, bands, seed + 3) - 0.5) * 0.35;
      for (const [kx, ky, kr] of craters) if (Math.hypot(x + 0.5 - kx, y + 0.5 - ky) < kr) l -= 0.22;
      const idx = Math.max(0, Math.min(ramp.length - 1, Math.floor(clamp01(l) * (ramp.length - 0.01) + bayer(x, y) * 0.9)));
      put(img, x, y, ramp[rr > 0.86 && idx > 0 ? idx - 1 : idx], 255, false);
    }
  }
}

function drawPlanet(pal, seed) {
  const img = canvas(P, P);
  const ramp = [pal.base[1], pal.base[2], pal.accent[1], pal.accent[2], pal.base[4], pal.base[5]].map(rgb);
  shadeSphere(img, 32, 32, 24, ramp, seed + 41, { bands: 9 });
  return img;
}

function drawAsteroid(pal, seed) {
  const img = canvas(P, P);
  const grey = (h, k) => { const c = rgb(h); const m = (c[0] + c[1] + c[2]) / 3; return c.map((v) => Math.round(v * 0.45 + m * 0.55 + k)); };
  const ramp = [grey(pal.base[1], 8), grey(pal.base[2], 18), grey(pal.base[3], 28), grey(pal.base[4], 40), grey(pal.base[5], 55)];
  const cx = 32; const cy = 32;
  const rnd = mulberry32(seed + 51);
  const craters = Array.from({ length: 5 }, () => [cx + (rnd() - 0.5) * 20, cy + (rnd() - 0.5) * 16, 1.5 + rnd() * 3]);
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const dx = x + 0.5 - cx; const dy = (y + 0.5 - cy) * 1.25;
      const ang = Math.atan2(dy, dx); const d = Math.hypot(dx, dy);
      const R = 17 + 5 * (vnoise((ang + Math.PI) / TAU, 0.5, 6, seed + 52) - 0.5) * 2;
      if (d > R) continue;
      const nx = dx / R; const ny = dy / R; const nz = Math.sqrt(clamp01(1 - nx * nx - ny * ny));
      let l = clamp01(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) + (vnoise(x / P, y / P, 8, seed + 53) - 0.5) * 0.3;
      for (const [kx, ky, kr] of craters) {
        const k = Math.hypot(x + 0.5 - kx, y + 0.5 - ky);
        if (k < kr) l -= 0.28; else if (k < kr + 1 && y < ky) l -= 0.12;
      }
      const idx = Math.max(0, Math.min(ramp.length - 1, Math.floor(clamp01(l) * (ramp.length - 0.01) + bayer(x, y) * 0.8)));
      put(img, x, y, ramp[d > R - 1.2 && idx > 0 ? idx - 1 : idx], 255, false);
    }
  }
  return img;
}

function drawRing(pal, seed) {
  const img = canvas(P, P);
  const ramp = [pal.base[1], pal.base[2], pal.base[3], pal.accent[2], pal.base[5]].map(rgb);
  const ring = pal.near.map(rgb);
  const cx = 32; const cy = 32; const tilt = -0.28;
  const ringPx = (front) => {
    for (let y = 0; y < P; y++) {
      for (let x = 0; x < P; x++) {
        const dx = x + 0.5 - cx; const dy = y + 0.5 - cy - dx * tilt;
        const e = Math.hypot(dx / 29, dy / 7.5);
        if (e < 0.72 || e > 1) continue;
        if ((dy > 0) !== front) continue;
        if (e > 0.82 && e < 0.86) continue; // Cassini gap
        const lvl = e > 0.93 ? 0 : e < 0.78 ? 1 : 2;
        put(img, x, y, ring[lvl], 255, false);
      }
    }
  };
  ringPx(false);
  shadeSphere(img, cx, cy, 14, ramp, seed + 61, { bands: 6 });
  ringPx(true);
  return img;
}

function drawVortex(pal, seed) {
  const img = canvas(P, P);
  const arms = [pal.base[3], pal.base[5], pal.near[1], pal.near[2]].map(rgb);
  const cx = 32; const cy = 32;
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const dx = x + 0.5 - cx; const dy = (y + 0.5 - cy) * 1.15; const r = Math.hypot(dx, dy);
      if (r > 31) continue;
      if (r < 7) { put(img, x, y, [0, 0, 0], 255, false); continue; }
      if (r < 8.2) { put(img, x, y, arms[3], 255, false); continue; }
      const th = Math.atan2(dy, dx);
      const spiral = 0.5 + 0.5 * Math.cos(2 * th - Math.log(r) * 4.2 + vnoise(th / TAU + 0.5, r / 32, 5, seed + 71) * 1.5);
      const fall = 1 - smooth(9, 31, r);
      const val = spiral * fall + bayer(x, y) * 0.3;
      if (val < 0.32) continue;
      const lvl = Math.min(3, Math.floor((val - 0.32) * 5.2));
      put(img, x, y, arms[lvl], lvl === 0 ? 170 : 255, false);
    }
  }
  return img;
}

const PROP_DRAW = { planet: drawPlanet, asteroid: drawAsteroid, ring: drawRing, vortex: drawVortex };

function drawMote() {
  const img = canvas(3, 3);
  const w = [255, 255, 255];
  put(img, 1, 1, w, 255, false);
  [[0, 1], [2, 1], [1, 0], [1, 2]].forEach(([x, y]) => put(img, x, y, w, 150, false));
  return img;
}

// ---------------------------------------------------------------- main
async function main() {
  const files = [];
  for (const [id, pal] of Object.entries(SPACE_PALETTES)) {
    const seed = VARIANT_SEEDS[id] || 99;
    const dir = join(OUT, id);
    const [sa, sb] = drawStars(pal, seed);
    const out = { back: drawBack(id, pal, seed), 'stars-a': sa, 'stars-b': sb, near: drawNear(id, pal, seed) };
    for (const name of pal.props) out[`prop-${name}`] = PROP_DRAW[name](pal, seed);
    for (const [name, img] of Object.entries(out)) {
      const f = join(dir, `${name}.png`);
      await writePng(img, f);
      if (name === 'back' && process.env.HIST) { const h = new Map(); for (let i = 0; i < img.d.length; i += 4) { const k = img.d[i] + ',' + img.d[i + 1] + ',' + img.d[i + 2]; h.set(k, (h.get(k) || 0) + 1); } console.log(id, [...h].sort((p, q) => q[1] - p[1]).map(([k, n]) => `${k}:${(n / (S * S) * 100).toFixed(0)}%`).join(' ')); }
      files.push(f);
    }
    console.log(`space bg: ${id}`);
  }
  await writePng(drawMote(), join(OUT, 'mote.png'));
  if (SHEET) await contactSheet();
  console.log(`wrote ${files.length + 1} files to ${OUT}`);
}

async function contactSheet() {
  const T = 256; const G = 8; const ids = Object.keys(SPACE_PALETTES);
  const comps = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]; const dir = join(OUT, id); const top = G + i * (T + G);
    const flat = await sharp(join(dir, 'back.png'))
      .composite([{ input: join(dir, 'near.png') }, { input: join(dir, 'stars-a.png') }]).png().toBuffer();
    comps.push({ input: await sharp(flat).extract({ left: 0, top: 0, width: T, height: T }).resize(T * 2, T * 2, { kernel: 'nearest' }).extract({ left: 0, top: 0, width: T, height: T }).toBuffer(), left: G, top });
    comps.push({ input: await sharp(join(dir, 'back.png')).resize(T, T, { kernel: 'nearest' }).toBuffer(), left: G * 2 + T, top });
    let x = G * 3 + T * 2;
    for (const name of SPACE_PALETTES[id].props) {
      comps.push({ input: await sharp(join(dir, `prop-${name}.png`)).resize(128, 128, { kernel: 'nearest' }).toBuffer(), left: x, top: top + 64 });
      x += 136;
    }
  }
  const W = G * 3 + T * 2 + 136 * 3; const H = G + ids.length * (T + G);
  const file = join(ROOT, 'scripts/evil-player/reports/space-bg-sheet.png');
  mkdirSync(dirname(file), { recursive: true });
  await sharp({ create: { width: W, height: H, channels: 4, background: '#111111ff' } }).composite(comps).png().toFile(file);
  console.log(`sheet: ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
