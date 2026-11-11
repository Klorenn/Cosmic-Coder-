/**
 * hudLayout — pure HUD geometry (no Phaser).
 *
 * Minimal HUD (ui/hud-minimal-v2): at a glance the player reads three things — health (top-left),
 * wave (top-centre) and score (top-right). Everything else is an icon: weapon (bottom-left),
 * buffs (bottom-centre), ability (bottom-right), boss bar above the buffs.
 *
 * The game canvas is a fixed 1920x1080 logical surface scaled with Scale.FIT, so sizes are designed
 * in CSS pixels (what the player actually sees) and converted to logical pixels with k = w / displayW.
 */

export const MIN_FONT_CSS_PX = 12;
export const COMPACT_BELOW_CSS_PX = 900;
export const BUFF_SLOTS = 5; // 4 timed buffs + revive

const finitePos = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {{w:number,h:number,displayW?:number,displayH?:number}} size logical + rendered canvas size
 */
export function computeHudLayout({ w = 1920, h = 1080, displayW, displayH } = {}) {
  const W = finitePos(w) || 1920;
  const H = finitePos(h) || 1080;
  const dW = finitePos(displayW) || W;
  const dH = finitePos(displayH) || (dW * H) / W;
  const k = W / dW; // logical px per css px
  const compact = dW < COMPACT_BELOW_CSS_PX;

  // ---- type scale (css px). Only three numbers are big: wave, score (and HP inside its bar).
  const fontCss = {
    small: MIN_FONT_CSS_PX,
    num: compact ? MIN_FONT_CSS_PX : 13,
    wave: compact ? 18 : clamp(dH / 38, 20, 30),
    score: compact ? 18 : clamp(dH / 38, 20, 30)
  };
  const pad = compact ? 8 : 16;
  const gap = compact ? 6 : 10;
  const inner = compact ? 6 : 8; // glass panel padding

  // ---- top-left: portrait + HP bar (+ mode dot) + thin XP bar with level badge
  const portraitD = compact ? 32 : 40;
  const hpW = compact ? clamp(dW * 0.24, 72, 110) : clamp(dW * 0.14, 190, 280);
  const hpH = compact ? 14 : 18;
  const xpH = 4;
  const levelR = compact ? 9 : 10;
  const dotR = 4; // 8 px mode dot
  const vx = pad + inner;
  const vy = pad + inner;
  const hpX = vx + portraitD + gap;
  const hpY = vy + Math.max(0, (portraitD - (hpH + 6 + levelR * 2)) / 2);
  const levelCy = hpY + hpH + 6 + levelR;
  const xpY = levelCy - xpH / 2;
  const dotCx = hpX + hpW + gap + dotR;
  const vitalsW = dotCx + dotR + inner - pad;
  const vitalsH = Math.max(portraitD, levelCy + levelR - vy) + inner * 2;

  // ---- top-right: score (star icon + number), width reserved for ~7 digits
  const scoreW = compact ? 96 : clamp(dW * 0.1, 150, 210);
  const scoreH = fontCss.score * 1.25 + inner * 2;
  const scoreX = dW - pad - scoreW;

  // ---- top-centre: WAVE n. Centred on screen when it fits, else centred in the free strip.
  const waveW = compact ? 92 : clamp(dW * 0.09, 140, 190);
  const waveH = fontCss.wave * 1.25 + inner * 2;
  const leftEnd = pad + vitalsW;
  let waveX = dW / 2 - waveW / 2;
  if (waveX < leftEnd + gap || waveX + waveW > scoreX - gap) waveX = leftEnd + (scoreX - leftEnd - waveW) / 2;

  // ---- bottom-left: weapon icon (compact: under the vitals panel, the joystick owns the corner)
  const weaponR = compact ? 16 : 22;
  const weaponCx = pad + weaponR + (compact ? inner : 0);
  const weaponCy = compact ? pad + vitalsH + gap + weaponR : dH - pad - weaponR;

  // ---- bottom-right: ability ring
  const abilityR = compact ? 24 : 28;
  const abilityCx = dW - pad - abilityR;
  const abilityCy = dH - pad - abilityR - (compact ? 0 : MIN_FONT_CSS_PX + 4); // room for the SPACE hint

  // ---- bottom-centre: buff icons
  const slot = compact ? 32 : 36;
  const slotGap = compact ? 6 : 10;
  const buffsW = BUFF_SLOTS * slot + (BUFF_SLOTS - 1) * slotGap;
  const buffsY = dH - pad - slot;

  // ---- boss bar above the buffs
  const bossW = compact ? Math.min(dW * 0.55, 240) : clamp(dW * 0.3, 280, 460);
  const bossBarH = compact ? 5 : 6;
  const bossBarY = buffsY - gap - bossBarH;
  const bossNameY = bossBarY - 4 - fontCss.small * 1.25;

  const L = (v) => v * k;
  const box = (x, y, bw, bh) => ({ x: L(x), y: L(y), w: L(bw), h: L(bh) });

  return {
    k,
    px: Math.max(1, Math.round(2 * k)), // logical units per art pixel (pixel HUD: 2 css px per art px)
    compact,
    pad: L(pad),
    gap: L(gap),
    inner: L(inner),
    radius: L(compact ? 10 : 14),
    font: {
      small: L(fontCss.small),
      num: L(fontCss.num),
      wave: L(fontCss.wave),
      score: L(fontCss.score)
    },
    vitals: {
      ...box(pad, pad, vitalsW, vitalsH),
      portrait: { x: L(vx + portraitD / 2), y: L(vy + portraitD / 2), r: L(portraitD / 2) },
      hp: box(hpX, hpY, hpW, hpH),
      xp: box(hpX, xpY, hpW - levelR * 2 - 4, xpH),
      level: { x: L(hpX + hpW - levelR), y: L(levelCy), r: L(levelR) },
      modeDot: { x: L(dotCx), y: L(hpY + hpH / 2), r: L(dotR) }
    },
    wave: box(waveX, pad, waveW, waveH),
    score: box(scoreX, pad, scoreW, scoreH),
    weapon: { x: L(weaponCx), y: L(weaponCy), r: L(weaponR) },
    ability: { x: L(abilityCx), y: L(abilityCy), r: L(abilityR) },
    buffs: { ...box(dW / 2 - buffsW / 2, buffsY, buffsW, slot), slot: L(slot), slotGap: L(slotGap) },
    boss: { ...box(dW / 2 - bossW / 2, bossNameY, bossW, bossBarY + bossBarH - bossNameY), barY: L(bossBarY), barH: L(bossBarH) }
  };
}

export default { computeHudLayout, MIN_FONT_CSS_PX, COMPACT_BELOW_CSS_PX, BUFF_SLOTS };
