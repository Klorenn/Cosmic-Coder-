/**
 * Spawn director (pure, no Phaser) — Vampire Survivors style continuous spawning.
 *
 *  - The wave is the run clock (waveRules.waveForTime); kills never end a wave.
 *  - Every spawnIntervalMs(wave) a group of groupSize(wave) enemies appears in a ring just outside
 *    the camera (DIRECTOR_RING_MIN..MAX x view radius), never inside the view.
 *  - Population target maxAlive(wave): below FILL_RATIO of it the director bursts (interval / BURST_DIV),
 *    at or above it the director pauses.
 *  - Type pool: waveMin gates entry, spawnWeight decays with (wave - waveMin), and a per-wave tier mix
 *    (trash -> normal/elite) picks the bucket first.
 *  - Wave events every 3-5 waves (seeded): swarm (closing ring of trash), horde (column marching across),
 *    elitePack (4-6 elites together).
 *
 * All randomness comes from a seeded mulberry32 RNG, so a (config, seed, inputs) triple is reproducible.
 * Tunables live in config/balance.js (DIRECTOR_*). Docs: docs/WAVES.md.
 */
import * as BALANCE from '../config/balance.js';
import { ENEMIES } from '../data/enemies.js';
import { waveForTime, waveStartMs } from './waveRules.js';

export const SPAWN_RING_MIN = BALANCE.DIRECTOR_RING_MIN;
export const SPAWN_RING_MAX = BALANCE.DIRECTOR_RING_MAX;
export const EVENT_KINDS = ['swarm', 'horde', 'elitePack'];
const TIERS = ['trash', 'normal', 'elite'];
const DEFAULT_VIEW_RADIUS = 640;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const normWave = (w) => (finite(w) && w >= 1 ? Math.floor(w) : 1);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Seeded PRNG (mulberry32) returning floats in [0, 1). Garbage seeds fall back to 1. */
export function createRng(seed) {
  let a = (finite(seed) ? Math.floor(seed) : 1) >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const asRng = (rng) => (typeof rng === 'function' ? rng : createRng(1));
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// —— Curves ——————————————————————————————————————————————————————————————

/** Target population for a wave: 20 at w1, +12 per wave, capped (perf). */
export function maxAlive(wave) {
  const w = normWave(wave);
  return Math.min(BALANCE.DIRECTOR_MAX_ALIVE_CAP, BALANCE.DIRECTOR_MAX_ALIVE_START + (w - 1) * BALANCE.DIRECTOR_MAX_ALIVE_PER_WAVE);
}

/** Ms between spawn groups: 1200 at w1, x0.9 per wave, floor 150. */
export function spawnIntervalMs(wave) {
  const w = normWave(wave);
  const v = BALANCE.DIRECTOR_INTERVAL_START_MS * Math.pow(BALANCE.DIRECTOR_INTERVAL_DECAY, w - 1);
  return Math.max(BALANCE.DIRECTOR_INTERVAL_MIN_MS, Math.round(v));
}

/** Enemies per spawn group: 1 at w1, +1 every 4 waves, max 6. */
export function groupSize(wave) {
  const w = normWave(wave);
  return Math.min(BALANCE.DIRECTOR_GROUP_MAX, 1 + Math.floor((w - 1) / BALANCE.DIRECTOR_GROUP_WAVES_PER_STEP));
}

/** Tier mix for a wave: trash 70% -> 25%, elite 5% -> 20%, normal = rest. */
export function tierShares(wave) {
  const t = clamp01((normWave(wave) - 1) / BALANCE.DIRECTOR_TIER_RAMP_WAVES);
  const trash = BALANCE.DIRECTOR_TRASH_SHARE_START + (BALANCE.DIRECTOR_TRASH_SHARE_END - BALANCE.DIRECTOR_TRASH_SHARE_START) * t;
  const elite = BALANCE.DIRECTOR_ELITE_SHARE_START + (BALANCE.DIRECTOR_ELITE_SHARE_END - BALANCE.DIRECTOR_ELITE_SHARE_START) * t;
  return { trash, normal: 1 - trash - elite, elite };
}

/** Chance that a regular spawn rolls an elite modifier (shield / speedBurst / criticalHit). */
export function eliteModChance(wave) {
  const w = normWave(wave);
  return Math.min(BALANCE.DIRECTOR_ELITE_MOD_CAP, BALANCE.DIRECTOR_ELITE_MOD_START + (w - 1) * BALANCE.DIRECTOR_ELITE_MOD_PER_WAVE);
}

/** Pool weight at a wave (0 if locked): max(FLOOR, spawnWeight * 0.5^((wave-waveMin)/HALF_LIFE)). */
export function effectiveWeight(data, wave) {
  if (!data || typeof data !== 'object') return 0;
  const w = normWave(wave);
  const waveMin = finite(data.waveMin) ? data.waveMin : 1;
  if (w < waveMin) return 0;
  const base = finite(data.spawnWeight) && data.spawnWeight > 0 ? data.spawnWeight : 1;
  // Absolute floor (not scaled by spawnWeight): once decayed, every old type is equally rare filler.
  return Math.max(BALANCE.DIRECTOR_WEIGHT_FLOOR, base * Math.pow(0.5, (w - waveMin) / BALANCE.DIRECTOR_WEIGHT_HALF_LIFE));
}

function weightedPick(rng, entries) {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (!(total > 0)) return null;
  let r = rng() * total;
  for (const e of entries) {
    if (r < e.weight) return e;
    r -= e.weight;
  }
  return entries[entries.length - 1];
}

/**
 * Pick an enemy type for `wave` from `pool` ({id: data}). Tier first (tierShares, renormalised over tiers
 * that have unlocked enemies), then type by decayed weight. `onlyTier` restricts the bucket (falls back to
 * every tier when that bucket is empty). Returns null when nothing is unlocked.
 */
export function pickEnemyType(rng, wave, pool, onlyTier) {
  const r = asRng(rng);
  if (!pool || typeof pool !== 'object') return null;
  const all = [];
  for (const [type, data] of Object.entries(pool)) {
    const weight = effectiveWeight(data, wave);
    if (weight > 0) all.push({ type, weight, tier: TIERS.includes(data.tier) ? data.tier : 'normal' });
  }
  if (!all.length) return null;
  let bucket = all;
  if (onlyTier && TIERS.includes(onlyTier)) {
    const only = all.filter((e) => e.tier === onlyTier);
    if (only.length) bucket = only;
  } else {
    const shares = tierShares(wave);
    const tiers = TIERS.filter((t) => all.some((e) => e.tier === t)).map((t) => ({ type: t, weight: shares[t] }));
    const tier = weightedPick(r, tiers);
    if (tier) bucket = all.filter((e) => e.tier === tier.type);
  }
  const picked = weightedPick(r, bucket);
  return picked ? picked.type : null;
}

const sanePos = (p) => ({ x: p && finite(p.x) ? p.x : 0, y: p && finite(p.y) ? p.y : 0 });

/**
 * View shape: a number is a circle radius; {halfW, halfH} is the camera rectangle (half extents, world
 * units) — the Vampire Survivors case: spawns hug the screen edge instead of a half-diagonal away.
 */
function saneView(v) {
  if (v && typeof v === 'object' && typeof v.rect === 'boolean' && finite(v.halfW) && finite(v.halfH) && v.halfW > 0 && v.halfH > 0) return v;
  if (v && typeof v === 'object' && finite(v.halfW) && finite(v.halfH) && v.halfW > 0 && v.halfH > 0) {
    return { rect: true, halfW: v.halfW, halfH: v.halfH };
  }
  const r = finite(v) && v > 0 ? v : DEFAULT_VIEW_RADIUS;
  return { rect: false, halfW: r, halfH: r };
}
/** Distance from the centre to the view boundary along angle a. */
function boundaryDist(view, a) {
  if (!view.rect) return view.halfW;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return Math.min(c > 1e-9 ? view.halfW / c : Infinity, s > 1e-9 ? view.halfH / s : Infinity);
}
/** Support distance: max projection of the view onto direction a (a line beyond it never crosses the view). */
function supportDist(view, a) {
  if (!view.rect) return view.halfW;
  return view.halfW * Math.abs(Math.cos(a)) + view.halfH * Math.abs(Math.sin(a));
}
const outerRadius = (view) => (view.rect ? Math.hypot(view.halfW, view.halfH) : view.halfW);

/**
 * Point between RING_MIN and RING_MAX times the view boundary around the player (always off-screen).
 * viewRadius: number (circle) or {halfW, halfH} (screen rectangle). `angle` optional.
 */
export function spawnPointOutsideView(rng, playerPos, viewRadius, angle) {
  const r = asRng(rng);
  const p = sanePos(playerPos);
  const view = saneView(viewRadius);
  const a = finite(angle) ? angle : r() * Math.PI * 2;
  const dist = boundaryDist(view, a) * (SPAWN_RING_MIN + (SPAWN_RING_MAX - SPAWN_RING_MIN) * r());
  return { x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist };
}

// —— Director ————————————————————————————————————————————————————————————

function buildEvent(d, kind, wave, playerPos, viewRadius, aliveCount) {
  const rng = d.rng;
  const p = sanePos(playerPos);
  const view = saneView(viewRadius);
  const alive = finite(aliveCount) && aliveCount > 0 ? aliveCount : 0;
  const room = Math.max(0, d.hardCap - alive);
  const spawns = [];
  const push = (pt, type, extra) => { if (type && spawns.length < room) spawns.push({ type, x: pt.x, y: pt.y, elite: false, ...extra }); };

  if (kind === 'swarm') {
    // Closing ring: evenly spaced trash just outside the view, all chasing at once.
    const n = Math.max(30, Math.min(60, 30 + 2 * normWave(wave)));
    const radius = outerRadius(view) * (SPAWN_RING_MIN + 0.05);
    const off = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      push({ x: p.x + Math.cos(a) * radius, y: p.y + Math.sin(a) * radius }, pickEnemyType(rng, wave, d.pool, 'trash'), { swarm: true });
    }
  } else if (kind === 'horde') {
    // Column entering from one side and marching straight across (scene behaviour 'march').
    const n = Math.max(20, Math.min(40, 20 + normWave(wave)));
    const a = rng() * Math.PI * 2;
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const perp = { x: -dir.y, y: dir.x };
    const back = supportDist(view, a) * (SPAWN_RING_MIN + 0.1);
    const span = boundaryDist(view, a + Math.PI / 2) * 0.9;
    for (let i = 0; i < n; i++) {
      const t = ((i / Math.max(1, n - 1)) - 0.5) * 2 * span;
      const pt = { x: p.x - dir.x * back + perp.x * t, y: p.y - dir.y * back + perp.y * t };
      push(pt, pickEnemyType(rng, wave, d.pool, rng() < 0.7 ? 'trash' : 'normal'), { march: { x: dir.x, y: dir.y } });
    }
  } else if (kind === 'elitePack') {
    const n = randInt(rng, 4, 6);
    const a = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const pt = spawnPointOutsideView(rng, p, view, a + (rng() - 0.5) * 0.35);
      push(pt, pickEnemyType(rng, wave, d.pool, 'elite'), { elite: true });
    }
  }
  return { kind, spawns };
}

/**
 * Create a director. config: { startWave=1, pool=ENEMIES, events=true, hardCap=DIRECTOR_HARD_CAP }.
 * `startWave` offsets the clock (continue from a save / rebirth prompt): nowMs=0 is the start of that wave.
 */
export function createDirector(config, seed) {
  const cfg = config && typeof config === 'object' ? config : {};
  const startWave = normWave(cfg.startWave);
  const rng = createRng(seed);
  const d = {
    rng,
    pool: cfg.pool && typeof cfg.pool === 'object' ? cfg.pool : ENEMIES,
    events: cfg.events !== false,
    hardCap: finite(cfg.hardCap) && cfg.hardCap > 0 ? cfg.hardCap : BALANCE.DIRECTOR_HARD_CAP,
    startOffsetMs: waveStartMs(startWave),
    wave: startWave,
    lastNow: 0,
    nextSpawnAt: null,
    nextEventWave: startWave < BALANCE.DIRECTOR_EVENT_FIRST_WAVE
      ? BALANCE.DIRECTOR_EVENT_FIRST_WAVE
      : startWave + randInt(rng, BALANCE.DIRECTOR_EVENT_GAP_MIN, BALANCE.DIRECTOR_EVENT_GAP_MAX)
  };
  d.buildEvent = (kind, wave, playerPos, viewRadius, aliveCount) => buildEvent(d, kind, wave, playerPos, viewRadius, aliveCount);
  return d;
}

/**
 * Advance the director to `nowMs` (ms of run clock since createDirector).
 * @returns {{spawns: {type:string,x:number,y:number,elite:boolean}[], wave:number, waveChanged:boolean, event?: {kind:string, spawns:object[]}}}
 */
export function tick(d, input) {
  const inp = input && typeof input === 'object' ? input : {};
  const now = Math.max(d.lastNow, finite(inp.nowMs) && inp.nowMs >= 0 ? inp.nowMs : d.lastNow);
  d.lastNow = now;
  const alive = finite(inp.aliveCount) && inp.aliveCount > 0 ? Math.floor(inp.aliveCount) : 0;
  const playerPos = sanePos(inp.playerPos);
  const view = saneView(inp.viewRadius);

  const wave = waveForTime(d.startOffsetMs + now);
  const waveChanged = wave !== d.wave;
  d.wave = wave;

  const spawns = [];
  const target = Math.min(maxAlive(wave), d.hardCap);
  let count = alive;
  if (d.nextSpawnAt === null) d.nextSpawnAt = now;
  if (d.nextSpawnAt < now - 1000) d.nextSpawnAt = now; // after a hitch: no catch-up storm
  let guard = 0;
  while (now >= d.nextSpawnAt && guard++ < 8) {
    if (count >= target) { d.nextSpawnAt = now + spawnIntervalMs(wave); break; }
    const n = Math.min(groupSize(wave), target - count);
    const a = d.rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const type = pickEnemyType(d.rng, wave, d.pool);
      if (!type) break;
      const pt = spawnPointOutsideView(d.rng, playerPos, view, a + (d.rng() - 0.5) * 0.4);
      spawns.push({ type, x: pt.x, y: pt.y, elite: d.rng() < eliteModChance(wave) });
      count++;
    }
    let interval = spawnIntervalMs(wave);
    if (count < target * BALANCE.DIRECTOR_FILL_RATIO) interval = Math.max(1, interval / BALANCE.DIRECTOR_BURST_DIV);
    d.nextSpawnAt += interval;
  }

  const out = { spawns, wave, waveChanged };
  if (waveChanged && d.events && wave >= d.nextEventWave) {
    const kind = EVENT_KINDS[Math.floor(d.rng() * EVENT_KINDS.length)];
    out.event = buildEvent(d, kind, wave, playerPos, view, count);
    d.nextEventWave = wave + randInt(d.rng, BALANCE.DIRECTOR_EVENT_GAP_MIN, BALANCE.DIRECTOR_EVENT_GAP_MAX);
  }
  return out;
}

export default { createDirector, tick, maxAlive, spawnIntervalMs, groupSize, pickEnemyType, spawnPointOutsideView, tierShares, effectiveWeight, eliteModChance, createRng };
