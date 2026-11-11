/**
 * hudLayout — pure HUD geometry (no Phaser).
 *
 * Pixel HUD v4 (ui/hud-scale-by-viewport): every widget is designed in ART pixels and drawn at an
 * integer number of CSS px per art pixel picked from the rendered canvas height (hudArtPx), so the
 * HUD stays discreet on small windows (Vampire Survivors / Brotato feel) instead of a fixed 2 css px.
 *
 * The game canvas is a fixed 1920x1080 logical surface scaled with Scale.FIT; k = logical px per css px
 * and P = round(art * k) logical units per art pixel (integer, so every widget sits on one pixel grid).
 *
 * Footprint (art px): margin 6, portrait 20, HP 96x8 (+ number at its right), XP 96x3 + level chip 12,
 * WAVE chip 12 (20 with the 2x number when art >= 2), score chip 12 with an 8 px star, weapon / ability
 * discs 20 (2 px ring), buffs 16 px icons framed by a 1 px duration ring (slot 18), boss bar 160x6.
 */

export const BUFF_SLOTS = 5; // 4 timed buffs + revive
export const HUD_MARGIN = 6; // art px from the screen edge

/** Art pixel sizes (art px), shared by the scene and the tests. */
export const HUD_ART = Object.freeze({
  margin: HUD_MARGIN,
  inset: 2, // vitals panel padding
  portrait: 20,
  hpW: 96,
  hpH: 8,
  xpH: 3,
  levelH: 12,
  chipH: 12, // 1-line chip (score, wave at art 1)
  waveH2x: 20, // wave chip with the 2x number
  scoreIcon: 8,
  discR: 10, // weapon / ability disc radius (20 px)
  discRing: 2,
  buffIcon: 16,
  buffRingR: 9, // half size of the slot: 16 px icon + 1 px square duration ring (18 px)
  buffGap: 3,
  bossW: 160,
  bossH: 6,
  font: 8
});

const finitePos = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * CSS px per HUD art pixel for a rendered canvas of cssW x cssH.
 * < 480 tall -> 1 (small windows / phones), < 1440 -> 2 (720p, 1080p), >= 1440 -> 3 (1440p, 4K).
 */
export function hudArtPx(cssW, cssH) {
  const h = finitePos(cssH) || (finitePos(cssW) ? (finitePos(cssW) * 9) / 16 : 0);
  if (!h) return 2;
  if (h < 480) return 1;
  if (h < 1440) return 2;
  return 3;
}

/** Logical units per art pixel: art css px * k rounded to an integer (>= 1). */
export function logicalPerArt(art, k) {
  const v = art * k;
  return Number.isFinite(v) && v > 0 ? Math.max(1, Math.round(v)) : 1;
}

/**
 * @param {{w:number,h:number,displayW?:number,displayH?:number,touch?:boolean}} size logical + rendered canvas size
 */
export function computeHudLayout({ w = 1920, h = 1080, displayW, displayH, touch = false } = {}) {
  const W = finitePos(w) || 1920;
  const H = finitePos(h) || 1080;
  const dW = finitePos(displayW) || W;
  const dH = finitePos(displayH) || (dW * H) / W;
  const k = W / dW; // logical px per css px
  const art = hudArtPx(dW, dH);
  const P = logicalPerArt(art, k);
  const labels = art >= 2; // secondary labels (level, mode dot, key hint, boss attack) only when roomy
  const A = HUD_ART;
  const aW = Math.floor(W / P); // screen size in art px
  const aH = Math.floor(H / P);
  const M = A.margin;
  const u = (v) => v * P; // art -> logical (always on the art grid)

  // ---- top-left vitals: portrait well | HP bar + number | XP bar + level chip (+ mode dot)
  const hpW = Math.max(48, Math.min(A.hpW, Math.floor(aW * 0.3)));
  const portrait = { x: M + A.inset, y: M + A.inset, s: A.portrait };
  const hp = { x: portrait.x + A.portrait + A.inset, y: M + A.inset, w: hpW, h: A.hpH };
  const levelY = hp.y + hp.h + 1;
  const levelW = labels ? 13 : 0;
  const xp = { x: hp.x, y: levelY + Math.floor((A.levelH - A.xpH) / 2), w: hpW - (labels ? levelW + 2 : 0), h: A.xpH };
  const numX = hp.x + hp.w + 3; // HP number column (also holds the mode dot)
  const numW = labels ? 42 : 20; // reserved for "100/100" (1x) or "100"
  const vitalsW = numX + numW + A.inset - M;
  const vitalsH = A.portrait + A.inset * 2;

  // ---- top-centre WAVE chip (centred on screen, else centred in the free strip), top-right score chip
  const waveH = labels ? A.waveH2x : A.chipH;
  const waveW = labels ? 64 : 48; // reserve for "WAVE 99" (chip grows at runtime)
  const scoreW = 64; // reserve for star + 7 digits
  const scoreRight = aW - M;
  const leftEnd = M + vitalsW + 4;
  const rightStart = scoreRight - scoreW - 4;
  let waveCx = Math.round(aW / 2);
  if (waveCx - waveW / 2 < leftEnd || waveCx + waveW / 2 > rightStart) waveCx = Math.round((leftEnd + rightStart) / 2);

  // ---- bottom: weapon (left, or under the vitals on touch: the joystick owns the corner), ability, buffs
  const weapon = touch
    ? { x: M + A.discR, y: M + vitalsH + 4 + A.discR }
    : { x: M + A.discR, y: aH - M - A.discR };
  const ability = { x: aW - M - A.discR, y: aH - M - A.discR };
  const slot = A.buffRingR * 2;
  const buffsW = BUFF_SLOTS * slot + (BUFF_SLOTS - 1) * A.buffGap;
  const buffsY = aH - M - slot;
  const bossW = Math.min(A.bossW, aW - 2 * (M + A.discR * 2 + 8));
  const bossBarY = buffsY - 4 - A.bossH;

  const box = (x, y, bw, bh) => ({ x: u(x), y: u(y), w: u(bw), h: u(bh) });
  return {
    k,
    art,
    px: P,
    menuPx: Math.max(1, Math.round(2 * k)), // pause menu keeps the kit's 2 css px per art px
    labels,
    compact: !labels,
    touch: !!touch,
    pad: u(M),
    gap: u(3),
    inner: u(A.inset),
    fontScale: { wave: labels ? 2 : 1, score: 1, banner: 1, stage: 2 },
    vitals: {
      ...box(M, M, vitalsW, vitalsH),
      portrait: { x: u(portrait.x), y: u(portrait.y), s: u(portrait.s) },
      hp: box(hp.x, hp.y, hp.w, hp.h),
      num: { x: u(numX), y: u(hp.y + 1) },
      xp: box(xp.x, xp.y, xp.w, xp.h),
      level: labels ? { right: u(hp.x + hp.w), y: u(levelY), h: u(A.levelH), minW: u(levelW) } : null,
      modeDot: labels ? { x: u(numX + 3), y: u(levelY + A.levelH / 2), r: u(3) } : null
    },
    wave: { cx: u(waveCx), y: u(M), h: u(waveH), ...box(waveCx - waveW / 2, M, waveW, waveH) },
    score: { right: u(scoreRight), y: u(M), h: u(A.chipH), ...box(scoreRight - scoreW, M, scoreW, A.chipH) },
    weapon: { x: u(weapon.x), y: u(weapon.y), r: u(A.discR) },
    ability: { x: u(ability.x), y: u(ability.y), r: u(A.discR) },
    buffs: { ...box(Math.round(aW / 2 - buffsW / 2), buffsY, buffsW, slot), slot: u(slot), ringR: A.buffRingR, step: u(slot + A.buffGap) },
    boss: { ...box(Math.round(aW / 2 - bossW / 2), bossBarY - 2 - A.font, bossW, A.font + 2 + A.bossH), barY: u(bossBarY), barH: u(A.bossH) }
  };
}

export default { computeHudLayout, hudArtPx, logicalPerArt, HUD_ART, HUD_MARGIN, BUFF_SLOTS };
