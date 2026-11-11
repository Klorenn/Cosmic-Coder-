/**
 * hudModel — pure view-model for the arena HUD (no Phaser).
 * ArenaScene gathers raw game state, this turns it into clamped, formatted values to draw.
 */

export const LOW_HP_PCT = 0.25;

// Minimal HUD palette (ui/hud-minimal-v2): green HP, amber warning, rose danger.
const HP_FULL = 0x34d399;
const HP_MID = 0xf59e0b;
const HP_EMPTY = 0xf43f5e;

// Autopilot mode -> 8 px dot colour next to the HP bar (label only in the hover tooltip).
const MODES = {
  hunt: { key: 'mode_hunt', color: 0x34d399 },
  evade: { key: 'mode_evade', color: 0xf59e0b },
  collect: { key: 'mode_collect', color: 0xa5f3fc },
  idle: { key: 'mode_idle', color: 0x94a3b8 },
  manual: { key: 'mode_manual', color: 0x22d3ee }
};

const finite = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp01 = (v) => Math.min(1, Math.max(0, finite(v, 0)));
const ratio = (a, b) => (finite(b) > 0 ? clamp01(finite(a) / b) : 0);

/** 12345 -> "12,345"; >= 1e6 -> "2.5M". Negative / NaN -> "0". */
export function formatNumber(n) {
  const v = Math.floor(finite(n, 0));
  if (v <= 0) return '0';
  if (v >= 1e6) return `${(Math.floor(v / 1e5) / 10).toString()}M`;
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** ms -> "8s" or "1:05"; Infinity -> "" (permanent). */
export function formatSeconds(ms) {
  if (ms === Infinity) return '';
  const s = Math.max(0, Math.ceil(finite(ms, 0) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function lerpColor(a, b, t) {
  const ch = (c, shift) => (c >> shift) & 0xff;
  const mix = (shift) => Math.round(ch(a, shift) + (ch(b, shift) - ch(a, shift)) * t);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** Health colour: solid green from half up, amber at a quarter, rose when empty. */
export function hpColor(pct) {
  const p = clamp01(pct);
  if (p >= 0.5) return HP_FULL;
  return p >= 0.25 ? lerpColor(HP_MID, HP_FULL, (p - 0.25) * 4) : lerpColor(HP_EMPTY, HP_MID, p * 4);
}

/** Autopilot mode -> locale key (hud.*) + colour. Unknown modes read as manual. */
export function modeStyle(mode) {
  return MODES[mode] || MODES.manual;
}

function buildBuffs(effects, items) {
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((e) => e && items && Object.prototype.hasOwnProperty.call(items, e.id) && finite(e.remaining) > 0)
    .map((e) => {
      const item = items[e.id];
      const total = finite(item.duration) > 0 ? item.duration : e.remaining;
      return {
        id: e.id,
        nameKey: item.nameKey || `items.${e.id}`,
        color: finite(item.color, 0xffffff),
        pct: ratio(e.remaining, total),
        remainingMs: e.remaining,
        timeText: formatSeconds(e.remaining)
      };
    })
    .sort((a, b) => a.remainingMs - b.remainingMs);
}

/**
 * @param {object} input raw HUD state gathered by the scene
 * @param {object} items ITEMS table (src/data/items.js)
 */
export function buildHudModel(input, items = {}) {
  const s = input && typeof input === 'object' ? input : {};
  const maxHp = Math.max(0, finite(s.maxHp));
  const hp = Math.min(maxHp, Math.max(0, finite(s.hp)));
  const hpPct = ratio(hp, maxHp);
  const xpNeeded = Math.max(0, finite(s.xpNeeded));
  const xp = Math.max(0, finite(s.xp));
  const w = s.weapon && typeof s.weapon === 'object' ? s.weapon : {};
  const temporary = finite(w.totalMs) > 0 && finite(w.remainingMs, -1) >= 0;
  const boss = s.boss && typeof s.boss === 'object'
    ? {
      name: String(s.boss.name ?? ''),
      pct: ratio(s.boss.hp, s.boss.maxHp),
      color: finite(s.boss.color, HP_EMPTY),
      phase: Math.max(0, Math.floor(finite(s.boss.phase, 0))),
      phases: Math.max(0, Math.floor(finite(s.boss.phases, 0))),
      attack: String(s.boss.attack ?? '')
    }
    : null;

  return {
    hpPct,
    hpText: `${Math.ceil(hp)}/${Math.ceil(maxHp)}`,
    hpColor: hpColor(hpPct),
    hpLow: maxHp > 0 && hpPct < LOW_HP_PCT,
    shieldPct: maxHp > 0 ? clamp01(finite(s.shield) / maxHp) : 0,
    xpPct: ratio(xp, xpNeeded),
    xpText: `${formatNumber(xp)}/${formatNumber(xpNeeded)}`,
    level: Math.max(1, Math.floor(finite(s.level, 1))),
    waveText: formatNumber(s.wave) === '0' ? '1' : formatNumber(s.wave),
    enemiesText: formatNumber(s.enemies),
    scoreText: formatNumber(s.score),
    killsText: formatNumber(s.kills),
    hiWaveText: formatNumber(s.hiWave),
    mode: modeStyle(s.mode),
    weapon: {
      label: String(w.label ?? ''),
      color: finite(w.color, 0x00ffff),
      timerPct: temporary ? ratio(w.remainingMs, w.totalMs) : null,
      timeText: temporary ? formatSeconds(w.remainingMs) : ''
    },
    buffs: buildBuffs(s.effects, items),
    revive: finite(s.revives) > 0,
    boss
  };
}

const ABILITY_DEFAULT_COLOR = 0x22d3ee;

/**
 * Ability chip (bottom-right HUD) from AbilityController.getHudModel().
 * cooldownPct: 0 = just used -> 1 = ready. `alpha` is a soft, slow pulse while ready (no text inside).
 * @param {object|null} ability
 * @param {{now?:number}} [opts] scene time for the blink
 */
export function abilityChipModel(ability, { now = 0 } = {}) {
  if (!ability || typeof ability !== 'object') return null;
  const ready = !!ability.ready;
  const active = !!ability.active;
  const blink = ready && !active;
  return {
    name: String(ability.name ?? ''),
    color: finite(ability.color, ABILITY_DEFAULT_COLOR),
    keyText: typeof ability.key === 'string' && ability.key ? ability.key : 'SPACE',
    ringPct: ready ? 1 : clamp01(ability.cooldownPct),
    timeText: ready ? '' : `${Math.max(0, Math.ceil(finite(ability.remainingMs, 0) / 1000))}s`,
    ready,
    active,
    blink,
    alpha: blink ? 0.7 + 0.3 * Math.abs(Math.cos(finite(now, 0) / 520)) : 1
  };
}

export default { buildHudModel, hpColor, formatNumber, formatSeconds, modeStyle, abilityChipModel, LOW_HP_PCT };
