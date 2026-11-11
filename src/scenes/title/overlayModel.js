/**
 * Pure model for the title submenus (UPGRADES / WEAPONS / CHARACTER). No Phaser import.
 * Sizes are in logical canvas units; `unit` = logical units per CSS px (1 / cssPerUnit).
 */
import { compactNumber } from './titleMenu.js';

const pos = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);

/** Panel rect centred in the visible view: max size in css px (times unit), never closer than margin to the edges. */
export function overlayFrame(view, unit, { maxW = 880, maxH = 600, margin = 16 } = {}) {
  const v = view && typeof view === 'object' ? view : {};
  const vx = Number.isFinite(v.x) ? v.x : 0;
  const vy = Number.isFinite(v.y) ? v.y : 0;
  const vw = pos(v.w, 1920);
  const vh = pos(v.h, 1080);
  const u = pos(unit, 1);
  const m = margin * u;
  const w = Math.max(1, Math.min(maxW * u, vw - 2 * m));
  const h = Math.max(1, Math.min(maxH * u, vh - 2 * m));
  return { x: vx + (vw - w) / 2, y: vy + (vh - h) / 2, w, h };
}

/** Vertical chrome of an overlay panel in css px: header (60) + gap (14) + footer (+8) or bottom padding (20). */
export function overlayChromeH(footerH = 0) {
  return 60 + 14 + (footerH > 0 ? footerH + 8 : 20);
}

/** Row-major grid that fits `width`: as many columns of >= cellMin as fit (1..maxCols, never more than count). */
export function gridLayout({ width, count, cellMin, cellMax = Infinity, gap = 0, cellH, maxCols = Infinity }) {
  const W = pos(width, 1);
  const n = Math.max(0, count | 0);
  const fit = Math.floor((W + gap) / (pos(cellMin, 1) + gap));
  const cols = Math.max(1, Math.min(fit, maxCols, Math.max(1, n)));
  const rows = n === 0 ? 0 : Math.ceil(n / cols);
  const cellW = Math.min(cellMax, (W - gap * (cols - 1)) / cols);
  const offsetX = (W - (cellW * cols + gap * (cols - 1))) / 2;
  const contentH = rows === 0 ? 0 : rows * cellH + (rows - 1) * gap;
  const cell = (i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return { x: offsetX + c * (cellW + gap), y: r * (cellH + gap), w: cellW, h: cellH };
  };
  return { cols, rows, cellW, cellH, gap, offsetX, contentH, cell };
}

export function wrapIndex(i, n) {
  if (!(n > 0)) return 0;
  return ((i % n) + n) % n;
}

/** Arrow navigation in a grid: left/right wrap over the list, up/down move a row and clamp. */
export function gridMove(index, dir, cols, count) {
  if (!(count > 0)) return 0;
  const c = Math.max(1, cols | 0);
  switch (dir) {
    case 'left': return wrapIndex(index - 1, count);
    case 'right': return wrapIndex(index + 1, count);
    case 'up': return index - c >= 0 ? index - c : index;
    case 'down': return index + c < count ? index + c : (Math.floor(index / c) < Math.floor((count - 1) / c) ? count - 1 : index);
    default: return index;
  }
}

export function clampScroll(y, contentH, viewH) {
  const max = Math.max(0, contentH - viewH);
  return Math.min(max, Math.max(0, Number.isFinite(y) ? y : 0));
}

/** Minimum scroll change so [itemTop, itemTop+itemH] (+pad) is inside the viewport. */
export function scrollToReveal(scrollY, viewH, itemTop, itemH, pad, contentH) {
  let y = scrollY;
  if (itemTop - pad < y) y = itemTop - pad;
  else if (itemTop + itemH + pad > y + viewH) y = itemTop + itemH + pad - viewH;
  return clampScroll(y, contentH, viewH);
}

export function formatCost(cost, maxed = false) {
  if (maxed || !Number.isFinite(cost)) return 'MAX';
  return compactNumber(cost);
}

export function canPurchase(currency, cost, level, maxLevel) {
  return Number.isFinite(cost) && level < maxLevel && currency >= cost;
}

export function levelDots(level, max) {
  const m = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  const l = Math.max(0, Math.min(m, Number.isFinite(level) ? Math.floor(level) : 0));
  return Array.from({ length: m }, (_, i) => i < l);
}

/**
 * 9x9 pixel-art glyphs: '#' main colour, '+' highlight, '-' shade, '.' empty.
 * Rendered by overlayKit.pixelIcon() as crisp rectangles (no textures).
 */
export const PIXEL_ICONS = Object.freeze({
  sword: ['.......##', '......#+#', '.....#+#.', '....#+#..', '.#.#+#...', '..##-....', '..-##....', '.#..#....', '#........'],
  heart: ['.##...##.', '#++#.#+##', '#+#######', '#########', '.#######.', '..#####..', '...###...', '....#....', '.........'],
  chevron: ['.........', '..##.....', '...##....', '....##...', '.....##..', '....##...', '...##....', '..##.....', '.........'],
  chevrons: ['.........', '##..##...', '.##..##..', '..##..##.', '...##..##', '..##..##.', '.##..##..', '##..##...', '.........'],
  bolt: ['.....###.', '....###..', '...###...', '..######.', '....+##..', '....##...', '...##....', '..#......', '.........'],
  star: ['....#....', '....#....', '...#+#...', '####+####', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
  crosshair: ['....#....', '..#####..', '.#..#..#.', '.#.....#.', '###.+.###', '.#.....#.', '.#..#..#.', '..#####..', '....#....'],
  hourglass: ['#########', '.#+++++#.', '..#+++#..', '...#+#...', '....#....', '...#.#...', '..#.+.#..', '.#+++++#.', '#########'],
  lock: ['...###...', '..#...#..', '..#...#..', '.#######.', '.##+####.', '.###.###.', '.###.###.', '.#######.', '.........'],
  crown: ['.........', '#...#...#', '##.###.##', '#########', '#########', '.#######.', '.#+#+#+#.', '.#######.', '.........'],
  bullet: ['....#....', '...#+#...', '...#+#...', '...###...', '...###...', '...###...', '..#####..', '..#.#.#..', '.........'],
  shield: ['#########', '#+++++++#', '#+#####+#', '#+#####+#', '#+#####+#', '.#+###+#.', '..#+#+#..', '...#+#...', '....#....'],
  book: ['.........', '.###.###.', '#+++#+++#', '#+++#+++#', '#+++#+++#', '#+++#+++#', '####.####', '.........', '.........'],
  reload: ['..####...', '.#....#.#', '#......##', '#....####', '#........', '#.......#', '.#.....#.', '..#####..', '.........'],
  burst: ['#...#...#', '.#..#..#.', '..#.#.#..', '...#+#...', '####+####', '...#+#...', '..#.#.#..', '.#..#..#.', '#...#...#'],
  note: ['...######', '...#++++#', '...#....#', '...#....#', '...#....#', '.###..###', '#++#.#++#', '####.####', '.##...##.'],
  speaker: ['....#....', '...##..#.', '####+#..#', '#+++++#.#', '#+++++#.#', '####+#..#', '...##..#.', '....#....', '.........'],
  globe: ['..#####..', '.#+#+#+#.', '#..#.#..#', '#########', '#..#.#..#', '#########', '#..#.#..#', '.#+#+#+#.', '..#####..'],
  expand: ['###...###', '#.......#', '#.......#', '.........', '.........', '.........', '#.......#', '#.......#', '###...###'],
  user: ['...###...', '..#+++#..', '..#+++#..', '...###...', '.........', '.#######.', '#+++++++#', '#+++++++#', '#########'],
  gamepad: ['.........', '.#######.', '#+++++++#', '#.#+++-+#', '###+++++#', '#.#++-+-#', '#+++++++#', '.##...##.', '.........'],
  gear: ['...#.#...', '.#######.', '.##+++##.', '###+.+###', '.#+...+#.', '###+.+###', '.##+++##.', '.#######.', '...#.#...'],
  branch: ['.#.......', '#+#...#..', '.#...#+#.', '.#....#..', '.#...#...', '.#..#....', '.##......', '#+#......', '.#.......']
});

const SHADES = { '#': 'main', '+': 'hi', '-': 'lo' };

/** Painted cells of a glyph: [{x, y, shade}] (empty for unknown names). */
export function pixelIconCells(name) {
  const rows = PIXEL_ICONS[name];
  if (!rows) return [];
  const out = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const shade = SHADES[row[x]];
      if (shade) out.push({ x, y, shade });
    }
  });
  return out;
}

const UPGRADE_ICONS = {
  damage: 'sword', health: 'heart', speed: 'chevrons', attackRate: 'bolt',
  xpGain: 'star', critChance: 'crosshair', weaponDuration: 'hourglass'
};
export const upgradeIconKind = (key) => UPGRADE_ICONS[key] || 'star';

/**
 * Character card profile. Base stats are shared by every character in ArenaScene; the bars express
 * each one's ability playstyle (Hot Reload heals -> survivability, rm -rf -> burst damage,
 * Sync Dash -> mobility), relative 0..1. `role` is a title.* i18n leaf key.
 */
const PROFILES = {
  vibecoder: { role: 'role_sustain', ability: 'reload', hp: 0.85, dmg: 0.5, spd: 0.5 },
  destroyer: { role: 'role_burst', ability: 'burst', hp: 0.55, dmg: 0.95, spd: 0.4 },
  swordsman: { role: 'role_agile', ability: 'bolt', hp: 0.45, dmg: 0.6, spd: 0.95 }
};
export function characterProfile(id) {
  return { ...(PROFILES[id] || PROFILES.vibecoder) };
}

/** On-chain (ZK) weapon card state, same rules as the old gallery. */
export function zkWeaponState({ unlocked, gamesPlayed, score, threshold }) {
  if (unlocked) return { state: 'unlocked' };
  const played = Number(gamesPlayed) || 0;
  if (played < 3) return { state: 'play_more', remaining: 3 - played };
  if ((Number(score) || 0) < threshold) return { state: 'score_low', need: threshold };
  return { state: 'unlockable' };
}

/* —— Leaderboard / settings helpers (LEADERBOARD, SETTINGS overlays) ———————————————— */

/** "GABCD…WXYZ" -> "G…WXYZ"; empty -> '???'. */
export function abbrevAddress(addr) {
  const a = String(addr || '').trim();
  if (!a) return '???';
  if (a.length <= 6) return a;
  return `${a[0]}…${a.slice(-4)}`;
}

const SHORT_ADDR_RE = /[a-z0-9]{3,}(\.\.\.|…)[a-z0-9]{3,}/i;

/** Display name for a leaderboard row: the player name, or the abbreviated wallet when the name is missing or is itself an address. */
export function leaderboardName(name, wallet) {
  const raw = String(name || '').trim();
  const n = raw.slice(0, 20);
  const looksLikeAddress = /^G[A-Z0-9]{20,}$/.test(raw) || SHORT_ADDR_RE.test(raw);
  if (!n || looksLikeAddress) return wallet ? abbrevAddress(wallet) : (n ? abbrevAddress(n) : '???');
  return n;
}

/** 1 -> 'gold', 2 -> 'silver', 3 -> 'bronze', else null. */
export function medalTier(position) {
  return ({ 1: 'gold', 2: 'silver', 3: 'bronze' })[Number(position)] || null;
}

const lbScore = (e) => Number(e?.bestScore ?? e?.score ?? 0) || 0;
const lbWave = (e) => Number(e?.bestWave ?? e?.wave ?? 0) || 0;

/**
 * Same rules the leaderboard always used: one row per wallet (best score), only real plays (score > 0),
 * sort by score, then wave, then games played, and renumber positions from 1. Rows without a wallet are dropped.
 */
export function prepareLeaderboard(entries) {
  const byWallet = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const key = String(entry.wallet || entry.address || '').trim().toLowerCase();
    if (!key || lbScore(entry) <= 0) return;
    const prev = byWallet.get(key);
    if (!prev || lbScore(entry) > lbScore(prev)) byWallet.set(key, { ...entry });
  });
  const out = Array.from(byWallet.values());
  out.sort((a, b) => (lbScore(b) - lbScore(a)) || (lbWave(b) - lbWave(a)) || ((b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0)));
  out.forEach((e, i) => { e.position = i + 1; e.bestScore = lbScore(e); e.bestWave = lbWave(e); });
  return out;
}

/** Slider step for keyboard (left/right): clamp to 0..1 and snap to 5 %. */
export function nudgeUnit(value, delta) {
  const v = Number(value);
  const next = (Number.isFinite(v) ? v : 0) + (Number(delta) || 0);
  return Math.round(Math.min(1, Math.max(0, next)) * 20) / 20;
}
