/**
 * pixelShapes — pure pixel-grid geometry for the pixel HUD (ui/arena-pixel-v3). No Phaser import.
 *
 * Everything is measured in ART pixels; callers multiply by P (logical units per art pixel, see
 * artPxFor). Shapes are centred on a grid corner, so a radius-r disc spans [-r, r) on both axes.
 * Drawing helpers only need a Graphics-like object with fillStyle(color, alpha) + fillRect(x, y, w, h).
 */

/** Logical units per art pixel for a HUD drawn at 2 css px per art px (k = logical px per css px). */
export function artPxFor(k) {
  const kk = typeof k === 'number' && Number.isFinite(k) && k > 0 ? k : 1;
  return Math.max(1, Math.round(2 * kk));
}

/** Snap a logical coordinate to the art grid. */
export const snapPx = (v, P) => Math.round((Number(v) || 0) / P) * P;

/** Discrete step for a 0..1 value: 0..steps (ready / full == steps). */
export function stepsFilled(pct, steps = 12) {
  const p = typeof pct === 'number' && Number.isFinite(pct) ? Math.min(1, Math.max(0, pct)) : 0;
  return p >= 1 ? steps : Math.floor(p * steps);
}

const ringCache = new Map();

/**
 * Cells of a segmented ring (annulus rOut - thick <= d < rOut), each tagged with its segment
 * (0 = first clockwise from 12 o'clock). Cells on a segment boundary are dropped to leave a 1 px gap.
 * @returns {{x:number,y:number,seg:number}[]} x/y = cell offset from the centre (art px)
 */
export function ringCells(rOut, thick = 2, segments = 12, gap = 1) {
  const R = Math.max(1, Math.round(rOut));
  const T = Math.max(1, Math.min(R, Math.round(thick)));
  const N = Math.max(1, Math.round(segments));
  const key = `${R}|${T}|${N}|${gap}`;
  if (ringCache.has(key)) return ringCache.get(key);
  const out = [];
  for (let j = -R; j < R; j++) {
    for (let i = -R; i < R; i++) {
      const cx = i + 0.5;
      const cy = j + 0.5;
      const d = Math.hypot(cx, cy);
      if (d >= R || d < R - T) continue;
      let a = Math.atan2(cx, -cy); // clockwise from 12 o'clock
      if (a < 0) a += Math.PI * 2;
      const f = (a / (Math.PI * 2)) * N;
      const seg = Math.min(N - 1, Math.floor(f));
      if (N > 1 && gap > 0) {
        const arc = (Math.PI * 2 * d) / N; // cells per segment at this radius
        const frac = f - seg;
        if (frac * arc < gap / 2 || (1 - frac) * arc < gap / 2) continue;
      }
      out.push({ x: i, y: j, seg });
    }
  }
  ringCache.set(key, out);
  return out;
}

/**
 * Horizontal runs of a ring for a given fill: [{ x, y, w, on }] (art px). Merging cells keeps the
 * per-frame fillRect count low (2-4 runs per row instead of one rect per cell).
 */
export function ringRuns(rOut, thick, segments, filled, gap = 1) {
  const cells = ringCells(rOut, thick, segments, gap);
  const runs = [];
  let cur = null;
  for (const c of cells) {
    const on = c.seg < filled;
    if (cur && cur.y === c.y && cur.on === on && cur.x + cur.w === c.x) { cur.w++; continue; }
    cur = { x: c.x, y: c.y, w: 1, on };
    runs.push(cur);
  }
  return runs;
}

/**
 * Draw a segmented ring centred on (cx, cy) (logical). filled = number of lit segments.
 * off = colour of unlit segments (null = skip them).
 */
export function drawSegRing(g, cx, cy, { r, thick = 2, segments = 12, filled = 0, P = 2, on = 0xffffff, off = null, alpha = 1, offAlpha = 1, gap = 1 }) {
  for (const run of ringRuns(r, thick, segments, filled, gap)) {
    if (!run.on && off == null) continue;
    g.fillStyle(run.on ? on : off, run.on ? alpha : offAlpha * alpha);
    g.fillRect(cx + run.x * P, cy + run.y * P, run.w * P, P);
  }
}

/** Filled pixel disc rows: [{ y, half }] for a radius-r disc (art px), half-width per row. */
export function discRows(r) {
  const R = Math.max(1, Math.round(r));
  const rows = [];
  for (let j = -R; j < R; j++) {
    const half = Math.round(R * Math.sqrt(Math.max(0, 1 - ((j + 0.5) / R) ** 2)));
    if (half > 0) rows.push({ y: j, half });
  }
  return rows;
}

/**
 * Bevelled pixel disc: ink outline, base fill, light top rows, dark bottom rows (art radius r).
 */
export function drawPixelDisc(g, cx, cy, { r, P = 2, fill, light = null, dark = null, outline = 0x0f1228, alpha = 1 }) {
  const rect = (y, h, col) => { if (h > 0) { g.fillStyle(col, alpha); g.fillRect(cx - h * P, cy + y * P, h * 2 * P, P); } };
  if (outline != null) for (const row of discRows(r)) rect(row.y, row.half, outline);
  const inner = discRows(Math.max(1, r - (outline != null ? 1 : 0)));
  const n = inner.length;
  inner.forEach((row, idx) => {
    let col = fill;
    if (light != null && idx < Math.max(1, Math.round(n * 0.22))) col = light;
    else if (dark != null && idx >= n - Math.max(1, Math.round(n * 0.22))) col = dark;
    rect(row.y, row.half, col);
  });
}

/**
 * Alpha steps for a retro fade (no smooth tween): [1, 0.75, 0.5, 0.25, 0] by default.
 */
export function fadeSteps(n = 4) {
  const k = Math.max(1, Math.round(n));
  return Array.from({ length: k + 1 }, (_, i) => Math.round((1 - i / k) * 1000) / 1000);
}

export default { artPxFor, snapPx, stepsFilled, ringCells, ringRuns, drawSegRing, discRows, drawPixelDisc, fadeSteps };
