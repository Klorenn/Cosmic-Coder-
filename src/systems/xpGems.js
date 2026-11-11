/**
 * XP gems on the floor (Vampire Survivors style). Pure logic, no Phaser.
 *
 *  - Killing an enemy drops a gem worth its XP; XP is only granted when the gem reaches the player.
 *  - A gem inside `pickupRadius` (or every gem while a magnet is active) becomes "attracted": it flies
 *    to the player with growing speed and is collected on contact. Attraction is sticky.
 *  - At most XP_GEMS_MAX gems live at once: the oldest ones are fused into one bigger gem at their
 *    centre of mass (total XP is preserved).
 *
 * ArenaScene renders the state with a recycled sprite pool (gem.id -> sprite).
 */

export const XP_PICKUP_RADIUS = 56;
export const XP_GEMS_MAX = 250;
/** Distance at which an attracted gem counts as touching the player. */
export const XP_COLLECT_DIST = 14;
const ATTRACT_START_SPEED = 120; // px/s when the pull starts
const ATTRACT_ACCEL = 1800; // px/s^2
const ATTRACT_MAX_SPEED = 1400;
const MAX_DT_MS = 100; // hitch guard

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** blue 1-9 XP, green 10-49, red 50+. */
export function gemTier(value) {
  if (!finite(value) || value < 10) return 'blue';
  return value < 50 ? 'green' : 'red';
}

export function createGemState() {
  return { gems: [], nextId: 1 };
}

const validState = (s) => !!(s && typeof s === 'object' && Array.isArray(s.gems));

function makeGem(state, x, y, value) {
  const id = finite(state.nextId) ? state.nextId : state.gems.length + 1;
  state.nextId = id + 1;
  return { id, x, y, value, tier: gemTier(value), attracted: false, speed: 0 };
}

/** Drop a gem. Returns the gem, or null for garbage input. Value is floored, minimum 1. */
export function dropGem(state, drop) {
  if (!validState(state) || !drop || typeof drop !== 'object') return null;
  const { x, y, value } = drop;
  if (!finite(x) || !finite(y) || !finite(value) || value <= 0) return null;
  const gem = makeGem(state, x, y, Math.max(1, Math.floor(value)));
  state.gems.push(gem);
  return gem;
}

/**
 * Advance gems by dtMs. opts: { pickupRadius = XP_PICKUP_RADIUS, magnetActive = false }.
 * Collected gems are removed from the state and returned.
 * @returns {{collected: object[], moved: number}}
 */
export function tickGems(state, player, dtMs, opts) {
  const out = { collected: [], moved: 0 };
  if (!validState(state) || !player || !finite(player.x) || !finite(player.y)) return out;
  const o = opts && typeof opts === 'object' ? opts : {};
  const radius = finite(o.pickupRadius) && o.pickupRadius > 0 ? o.pickupRadius : XP_PICKUP_RADIUS;
  const magnet = o.magnetActive === true;
  const dt = (finite(dtMs) && dtMs > 0 ? Math.min(dtMs, MAX_DT_MS) : 0) / 1000;
  const r2 = radius * radius;
  const keep = [];
  for (const g of state.gems) {
    const dx = player.x - g.x;
    const dy = player.y - g.y;
    const d2 = dx * dx + dy * dy;
    if (!g.attracted && (magnet || d2 <= r2)) {
      g.attracted = true;
      g.speed = ATTRACT_START_SPEED;
    }
    if (d2 <= XP_COLLECT_DIST * XP_COLLECT_DIST) {
      out.collected.push(g);
      continue;
    }
    if (g.attracted && dt > 0) {
      g.speed = Math.min(ATTRACT_MAX_SPEED, (finite(g.speed) ? g.speed : ATTRACT_START_SPEED) + ATTRACT_ACCEL * dt);
      const d = Math.sqrt(d2);
      const step = g.speed * dt;
      if (step >= d - XP_COLLECT_DIST) {
        g.x = player.x;
        g.y = player.y;
        out.collected.push(g);
        continue;
      }
      g.x += (dx / d) * step;
      g.y += (dy / d) * step;
      out.moved++;
    }
    keep.push(g);
  }
  state.gems = keep;
  return out;
}

/** Sum of XP still on the floor. */
export function totalGemValue(state) {
  if (!validState(state)) return 0;
  return state.gems.reduce((a, g) => a + (finite(g.value) ? g.value : 0), 0);
}

/**
 * Keep at most `max` gems: fuse the oldest (count - max + 1) into one gem at their centre of mass.
 * @returns {{removed: number[], gem: object|null}} ids that disappeared and the new merged gem
 */
export function mergeIfOverflow(state, max = XP_GEMS_MAX) {
  const none = { removed: [], gem: null };
  if (!validState(state)) return none;
  const cap = finite(max) && max >= 2 ? Math.floor(max) : XP_GEMS_MAX;
  if (state.gems.length <= cap) return none;
  const n = state.gems.length - cap + 1;
  const old = state.gems.slice(0, n);
  let value = 0;
  let sx = 0;
  let sy = 0;
  for (const g of old) {
    value += g.value;
    sx += g.x;
    sy += g.y;
  }
  const gem = makeGem(state, sx / n, sy / n, value);
  state.gems = [...state.gems.slice(n), gem];
  return { removed: old.map((g) => g.id), gem };
}

export default { XP_PICKUP_RADIUS, XP_GEMS_MAX, XP_COLLECT_DIST, gemTier, createGemState, dropGem, tickGems, mergeIfOverflow, totalGemValue };
