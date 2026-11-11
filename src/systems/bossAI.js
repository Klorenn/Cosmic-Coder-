/**
 * Boss / mini-boss AI brain (pure, no Phaser, never mutates its inputs).
 *
 * A boss `mechanics` block (src/data/enemies.js) looks like:
 *   {
 *     phases: [1, 0.66, 0.33],          // HP ratio at which phase N starts (phase 1 = full HP)
 *     openingDelayMs: 1500,             // grace period after spawning
 *     globalCooldownMs: 900,            // pause between two attacks
 *     phaseCooldownMult: [1, 0.85, 0.7],// later phases attack more often
 *     attacks: { id: { phase, nameKey, telegraphMs, activeMs, cooldownMs, weight?, range?, once? } }
 *   }
 *
 * Every attack runs telegraph (visual warning, no damage) -> active (damage window) -> end.
 * The scene owns the visuals (systems/bossFx.js) and reacts to the events stepBoss() returns:
 *   { type: 'phase', phase, from }            HP crossed a threshold (phases never go back)
 *   { type: 'telegraph', attack, durationMs } warning starts
 *   { type: 'execute', attack }               damage window starts
 *   { type: 'end', attack }                   attack finished
 */

export const TELEGRAPH_MIN_MS = 600;
export const TELEGRAPH_MAX_MS = 1200;
/** The boss bar shows the attack name for this long after its telegraph starts. */
export const LABEL_MS = 1000;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** mulberry32 step: returns the value and the next seed so the brain stays a plain object. */
export function nextRandom(seed) {
  const a = ((finite(seed) ? Math.floor(seed) : 1) + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: a };
}

/** 1-based phase for a HP ratio. thresholds[0] is phase 1 (full HP); phase N starts at ratio <= thresholds[N-1]. */
export function phaseForHp(hp, maxHp, thresholds = [1, 0.66, 0.33]) {
  if (!finite(hp) || !finite(maxHp) || maxHp <= 0 || !Array.isArray(thresholds)) return 1;
  const ratio = hp / maxHp;
  let phase = 1;
  for (let i = 1; i < thresholds.length; i++) if (ratio <= thresholds[i] + 1e-9) phase = i + 1;
  return phase;
}

/** Attack ids available in a phase, in declaration order. */
export function unlockedAttacks(mech, phase) {
  return Object.entries(mech?.attacks || {}).filter(([, a]) => (a.phase || 1) <= phase).map(([id]) => id);
}

export function phasePips(phase, phases) {
  const n = Math.max(1, phases | 0);
  const p = Math.min(n, Math.max(1, phase | 0));
  return '●'.repeat(p) + '○'.repeat(n - p);
}

export function createBossBrain(mech, { seed = 1, now = 0 } = {}) {
  const readyAt = {};
  for (const id of Object.keys(mech?.attacks || {})) readyAt[id] = now;
  return {
    phase: 1,
    rngSeed: finite(seed) ? Math.floor(seed) : 1,
    readyAt,
    globalReadyAt: now + (mech?.openingDelayMs ?? 1500),
    current: null,
    used: {},
    priority: null,
    lastAttack: null
  };
}

function cooldownMult(mech, phase) {
  const list = mech.phaseCooldownMult || [];
  const m = list[phase - 1];
  return finite(m) && m > 0 ? m : 1;
}

function pickAttack(brain, mech, now, dist) {
  const candidates = unlockedAttacks(mech, brain.phase).filter((id) => {
    const a = mech.attacks[id];
    if (a.once && brain.used[id]) return false;
    if (now < (brain.readyAt[id] ?? 0)) return false;
    if (finite(a.range) && finite(dist) && dist > a.range) return false;
    return true;
  });
  if (candidates.length === 0) return { id: null, seed: brain.rngSeed };
  if (brain.priority && candidates.includes(brain.priority)) return { id: brain.priority, seed: brain.rngSeed };
  const pool = candidates.length > 1 ? candidates.filter((id) => id !== brain.lastAttack) : candidates;
  const total = pool.reduce((s, id) => s + Math.max(0, mech.attacks[id].weight ?? 1), 0);
  const r = nextRandom(brain.rngSeed);
  let roll = r.value * (total || pool.length);
  for (const id of pool) {
    roll -= total ? Math.max(0, mech.attacks[id].weight ?? 1) : 1;
    if (roll < 0) return { id, seed: r.seed };
  }
  return { id: pool[pool.length - 1], seed: r.seed };
}

/**
 * Advance the brain to `now`.
 * @param {object} brain from createBossBrain / a previous stepBoss
 * @param {object} mech  mechanics block
 * @param {{now:number, hp:number, maxHp:number, dist?:number}} ctx
 * @returns {{brain: object, events: object[]}}
 */
export function stepBoss(brain, mech, ctx) {
  const events = [];
  if (!brain || !mech || !ctx || !finite(ctx.now)) return { brain, events };
  const now = ctx.now;
  const b = { ...brain, readyAt: { ...brain.readyAt }, used: { ...brain.used }, current: brain.current ? { ...brain.current } : null };

  // 1) Phase transitions (monotonic: healing never resets a phase)
  const hpPhase = phaseForHp(ctx.hp, ctx.maxHp, mech.phases);
  if (hpPhase > b.phase) {
    events.push({ type: 'phase', phase: hpPhase, from: b.phase });
    const fresh = unlockedAttacks(mech, hpPhase).filter((id) => (mech.attacks[id].phase || 1) > b.phase);
    for (const id of fresh) b.readyAt[id] = now;
    b.priority = fresh[fresh.length - 1] || null;
    b.phase = hpPhase;
  }

  // 2) Running attack: telegraph -> active -> end
  if (b.current) {
    const c = b.current;
    if (c.stage === 'telegraph' && now >= c.telegraphEnd) {
      c.stage = 'active';
      events.push({ type: 'execute', attack: c.id });
    }
    if (c.stage === 'active' && now >= c.activeEnd) {
      events.push({ type: 'end', attack: c.id });
      b.current = null;
      b.globalReadyAt = now + (mech.globalCooldownMs ?? 800);
    }
    return { brain: b, events };
  }

  // 3) Pick the next attack
  if (now < b.globalReadyAt) return { brain: b, events };
  const { id, seed } = pickAttack(b, mech, now, ctx.dist);
  b.rngSeed = seed;
  if (!id) return { brain: b, events };
  const a = mech.attacks[id];
  const telegraphMs = Math.min(TELEGRAPH_MAX_MS, Math.max(TELEGRAPH_MIN_MS, a.telegraphMs ?? 800));
  b.current = {
    id,
    stage: 'telegraph',
    startedAt: now,
    telegraphEnd: now + telegraphMs,
    activeEnd: now + telegraphMs + Math.max(0, a.activeMs ?? 0)
  };
  b.readyAt[id] = now + (a.cooldownMs ?? 5000) * cooldownMult(mech, b.phase);
  if (a.once) b.used[id] = true;
  if (b.priority === id) b.priority = null;
  b.lastAttack = id;
  events.push({ type: 'telegraph', attack: id, durationMs: telegraphMs });
  return { brain: b, events };
}

/** What the HUD boss bar shows: phase pips and (for LABEL_MS after a telegraph starts) the attack name. */
export function bossBarInfo(brain, mech, now) {
  const phases = Array.isArray(mech?.phases) ? mech.phases.length : 1;
  const phase = brain?.phase || 1;
  const c = brain?.current;
  const telegraphing = !!c && c.stage === 'telegraph';
  const showLabel = !!c && finite(now) && now - c.startedAt < LABEL_MS;
  return {
    phase,
    phases,
    pips: phasePips(phase, phases),
    labelKey: showLabel ? (mech.attacks[c.id]?.nameKey ?? null) : null,
    telegraphing
  };
}

export default { nextRandom, phaseForHp, unlockedAttacks, phasePips, createBossBrain, stepBoss, bossBarInfo };
