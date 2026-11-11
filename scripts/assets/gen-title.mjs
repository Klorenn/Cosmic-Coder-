#!/usr/bin/env node
/**
 * Title screen art: deep-space nebula, star layers, planet, pedestal glow and soft particle.
 * Output: public/assets/UI/title/*.png (loaded by src/scenes/title/titleAssets.js).
 * Deterministic (seeded) so re-running produces identical files.  Run: node scripts/assets/gen-title.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public/assets/UI/title');
mkdirSync(OUT, { recursive: true });

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

async function svgToPng(svg, file) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
  console.log('wrote', file); // eslint-disable-line no-console
}

// 1) Nebula backdrop 1920x1080 (not tiled; drawn "cover").
async function nebula() {
  const W = 1920; const H = 1080;
  const blob = (id, cx, cy, r, color, op) => `
    <radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${color}" stop-opacity="${op}"/>
      <stop offset="0.45" stop-color="${color}" stop-opacity="${op * 0.45}"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#070a1f"/><stop offset="0.6" stop-color="#05061a"/><stop offset="1" stop-color="#03040f"/>
    </linearGradient>
    ${blob('v1', 420, 330, 760, '#7c3aed', 0.55)}
    ${blob('m1', 1240, 180, 560, '#db2777', 0.32)}
    ${blob('c1', 1560, 760, 680, '#0891b2', 0.38)}
    ${blob('b1', 860, 900, 700, '#1d4ed8', 0.30)}
    ${blob('v2', 1700, 260, 420, '#8b5cf6', 0.28)}
    <filter id="clouds" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.0016 0.0026" numOctaves="6" seed="11" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.9 -0.78" result="a"/>
      <feComposite in="SourceGraphic" in2="a" operator="in"/>
    </filter>
    <filter id="dust" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="4" seed="4" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.02  0 0 0 0 0.02  0 0 0 0 0.06  0 0 0 2.2 -1.15" result="a"/>
      <feComposite in="a" in2="SourceGraphic" operator="in"/>
    </filter>
    <radialGradient id="vig" cx="960" cy="540" r="1150" gradientUnits="userSpaceOnUse">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#base)"/>
  <g opacity="0.55">
    <rect width="100%" height="100%" fill="url(#v1)"/><rect width="100%" height="100%" fill="url(#m1)"/>
    <rect width="100%" height="100%" fill="url(#c1)"/><rect width="100%" height="100%" fill="url(#b1)"/>
  </g>
  <g filter="url(#clouds)">
    <rect width="100%" height="100%" fill="url(#v1)"/><rect width="100%" height="100%" fill="url(#m1)"/>
    <rect width="100%" height="100%" fill="url(#c1)"/><rect width="100%" height="100%" fill="url(#b1)"/>
    <rect width="100%" height="100%" fill="url(#v2)"/>
  </g>
  <rect width="100%" height="100%" fill="#000" filter="url(#dust)" opacity="0.8"/>
  <rect width="100%" height="100%" fill="url(#vig)"/>
</svg>`;
  await svgToPng(svg, 'nebula.png');
}

// 2) Tileable star layers (1024x1024, transparent).
async function stars(file, seed, count, rMin, rMax, glowCount) {
  const S = 1024; const r = rng(seed);
  const tints = ['#ffffff', '#ffffff', '#dbeafe', '#e9d5ff', '#cffafe', '#fde68a'];
  let dots = '';
  for (let i = 0; i < count; i++) {
    const x = 4 + r() * (S - 8); const y = 4 + r() * (S - 8);
    const rad = rMin + Math.pow(r(), 3) * (rMax - rMin);
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(2)}" fill="${tints[(r() * tints.length) | 0]}" opacity="${(0.35 + r() * 0.65).toFixed(2)}"/>`;
  }
  let glows = '';
  for (let i = 0; i < glowCount; i++) {
    const x = 24 + r() * (S - 48); const y = 24 + r() * (S - 48);
    glows += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="url(#g)"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="#fff"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <defs><radialGradient id="g"><stop offset="0" stop-color="#c4b5fd" stop-opacity="0.9"/><stop offset="1" stop-color="#c4b5fd" stop-opacity="0"/></radialGradient></defs>
  ${dots}${glows}</svg>`;
  await svgToPng(svg, file);
}

// 3) Planet with atmosphere glow (720x720, planet r=230).
async function planet() {
  const S = 720; const c = S / 2; const R = 230;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <defs>
    <radialGradient id="atm" cx="${c}" cy="${c}" r="${R * 1.55}" gradientUnits="userSpaceOnUse">
      <stop offset="${(R / (R * 1.55)).toFixed(3)}" stop-color="#22d3ee" stop-opacity="0.55"/>
      <stop offset="0.8" stop-color="#8b5cf6" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="body" cx="${c - R * 0.45}" cy="${c - R * 0.5}" r="${R * 1.7}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#67e8f9"/><stop offset="0.25" stop-color="#3b82f6"/>
      <stop offset="0.55" stop-color="#4c1d95"/><stop offset="0.85" stop-color="#120a2e"/><stop offset="1" stop-color="#05040f"/>
    </radialGradient>
    <clipPath id="clip"><circle cx="${c}" cy="${c}" r="${R}"/></clipPath>
    <filter id="bands" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.004 0.035" numOctaves="4" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.85  0 0 0 0 0.9  0 0 0 0 1  0 0 0 1.4 -0.55"/>
    </filter>
    <radialGradient id="shade" cx="${c + R * 0.55}" cy="${c + R * 0.55}" r="${R * 1.35}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000" stop-opacity="0.85"/><stop offset="0.6" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${c}" cy="${c}" r="${R * 1.55}" fill="url(#atm)"/>
  <circle cx="${c}" cy="${c}" r="${R}" fill="url(#body)"/>
  <g clip-path="url(#clip)">
    <rect width="${S}" height="${S}" filter="url(#bands)" opacity="0.28" transform="rotate(-18 ${c} ${c})"/>
    <circle cx="${c}" cy="${c}" r="${R}" fill="url(#shade)"/>
  </g>
  <circle cx="${c}" cy="${c}" r="${R - 1}" fill="none" stroke="#a5f3fc" stroke-opacity="0.35" stroke-width="2"/>
</svg>`;
  await svgToPng(svg, 'planet.png');
}

// 4) Pedestal: soft elliptical light pool + rim (600x220).
async function pedestal() {
  const W = 600; const H = 220;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#a78bfa" stop-opacity="0.75"/><stop offset="0.5" stop-color="#7c3aed" stop-opacity="0.28"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/></radialGradient>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#0b0a24"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22d3ee" stop-opacity="0"/><stop offset="0.5" stop-color="#67e8f9" stop-opacity="1"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient>
  </defs>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2}" ry="${H / 2}" fill="url(#pool)"/>
  <ellipse cx="${W / 2}" cy="${H / 2 + 14}" rx="190" ry="40" fill="#05051a" opacity="0.9"/>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="190" ry="40" fill="url(#top)"/>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="190" ry="40" fill="none" stroke="url(#rim)" stroke-width="3"/>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="150" ry="28" fill="none" stroke="#8b5cf6" stroke-opacity="0.45" stroke-width="1.5"/>
</svg>`;
  await svgToPng(svg, 'pedestal.png');
}

// 5) Light beam behind the character (360x720).
async function beam() {
  const W = 360; const H = 720;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b5cf6" stop-opacity="0"/><stop offset="0.75" stop-color="#8b5cf6" stop-opacity="0.35"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0.5"/></linearGradient>
    <linearGradient id="h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="m"><rect width="${W}" height="${H}" fill="url(#h)"/></mask>
  </defs>
  <polygon points="${W * 0.3},0 ${W * 0.7},0 ${W},${H} 0,${H}" fill="url(#v)" mask="url(#m)"/>
</svg>`;
  await svgToPng(svg, 'beam.png');
}

// 6) Soft particle dot (32x32).
async function dot() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><circle cx="16" cy="16" r="16" fill="url(#g)"/></svg>`;
  await svgToPng(svg, 'dot.png');
}

await nebula();
await stars('stars-far.png', 1337, 900, 0.4, 1.3, 0);
await stars('stars-near.png', 4242, 140, 0.8, 2.2, 10);
await planet();
await pedestal();
await beam();
await dot();
