/**
 * Auto-pilot decision logic (pure, no Phaser).
 * The arena calls decideMove() every frame when the player gives no manual input.
 * Auto-play always works; live coding activity only grants a bonus (see ArenaScene).
 */

export const AUTOPILOT = Object.freeze({
  /** Evade when health ratio is at or below this. */
  EVADE_HP_RATIO: 0.5,
  /** Radius used to count "nearby" enemies. */
  NEARBY_RADIUS: 120,
  /** Evade when more than this many enemies are within NEARBY_RADIUS. */
  EVADE_NEARBY_COUNT: 3,
  /** Radius in which enemies push the evade vector. */
  EVADE_DETECTION_RADIUS: 200,
  /** Hunt holds position when the target is closer than this (weapon range). */
  HUNT_RANGE: 120,
  /** Enemy types the auto-pilot never walks into. */
  DEADLY_TYPES: Object.freeze(['segfault']),
  /** Collect XP gems only while no enemy is closer than this. */
  COLLECT_SAFE_RADIUS: 160,
  /** Closer than this to the gem: stand still (the pickup radius does the rest). */
  COLLECT_ARRIVE_DIST: 4,
  /** pickGem: gems within best * SIMILAR_DIST_RATIO + SIMILAR_DIST_SLACK count as "similar distance". */
  GEM_SIMILAR_DIST_RATIO: 1.25,
  GEM_SIMILAR_DIST_SLACK: 24
});

const ZERO = { dx: 0, dy: 0 };

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function normalize(x, y) {
  const m = Math.hypot(x, y);
  if (!finite(m) || m === 0) return { ...ZERO };
  return { dx: x / m, dy: y / m };
}

/**
 * Gem the auto-pilot should walk to: the nearest one, unless a more valuable gem sits at a similar distance.
 * @param {Array<{x:number,y:number,value?:number}>} gems
 * @param {{x:number,y:number}} player
 * @returns {{x:number,y:number,dist:number,value:number}|null}
 */
export function pickGem(gems, player, opts = {}) {
  const cfg = { ...AUTOPILOT, ...opts };
  if (!Array.isArray(gems) || !player || !finite(player.x) || !finite(player.y)) return null;
  const list = [];
  let best = Infinity;
  for (const g of gems) {
    if (!g || !finite(g.x) || !finite(g.y)) continue;
    const dist = Math.hypot(g.x - player.x, g.y - player.y);
    list.push({ x: g.x, y: g.y, dist, value: finite(g.value) ? g.value : 0 });
    if (dist < best) best = dist;
  }
  if (list.length === 0) return null;
  const limit = best * cfg.GEM_SIMILAR_DIST_RATIO + cfg.GEM_SIMILAR_DIST_SLACK;
  let pick = null;
  for (const g of list) {
    if (g.dist > limit) continue;
    if (!pick || g.value > pick.value || (g.value === pick.value && g.dist < pick.dist)) pick = g;
  }
  return pick;
}

/**
 * @param {{player:{x:number,y:number}, hp:number, maxHp:number, nearestGem?:{x:number,y:number,dist?:number}|null, enemies:Array<{x:number,y:number,type?:string,active?:boolean}>}} state
 * @param {Partial<typeof AUTOPILOT>} [opts]
 * @returns {{mode:'hunt'|'evade'|'collect'|'idle', dx:number, dy:number, target?:object}}
 */
export function decideMove(state, opts = {}) {
  const cfg = { ...AUTOPILOT, ...opts };
  const px = state?.player?.x;
  const py = state?.player?.y;
  if (!finite(px) || !finite(py) || !Array.isArray(state?.enemies)) return { mode: 'idle', ...ZERO };

  const enemies = state.enemies.filter((e) => e && e.active !== false && finite(e.x) && finite(e.y));
  const hpRatio = finite(state.hp) && finite(state.maxHp) && state.maxHp > 0 ? state.hp / state.maxHp : 1;
  let nearby = 0;
  let closest = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - px, e.y - py);
    if (d < cfg.NEARBY_RADIUS) nearby++;
    if (d < closest) closest = d;
  }

  // Collect: no enemy inside the safe radius and HP above the evade threshold -> walk to the gem.
  const gem = state.nearestGem;
  if (gem && finite(gem.x) && finite(gem.y) && hpRatio > cfg.EVADE_HP_RATIO && closest >= cfg.COLLECT_SAFE_RADIUS) {
    const gd = Math.hypot(gem.x - px, gem.y - py);
    if (gd < cfg.COLLECT_ARRIVE_DIST) return { mode: 'collect', target: gem, ...ZERO };
    return { mode: 'collect', target: gem, ...normalize(gem.x - px, gem.y - py) };
  }

  if (enemies.length === 0) return { mode: 'idle', ...ZERO };

  if (hpRatio <= cfg.EVADE_HP_RATIO || nearby > cfg.EVADE_NEARBY_COUNT) {
    let tx = 0;
    let ty = 0;
    for (const e of enemies) {
      const d = Math.hypot(e.x - px, e.y - py);
      if (d <= 0 || d >= cfg.EVADE_DETECTION_RADIUS) continue;
      const w = (1 - d / cfg.EVADE_DETECTION_RADIUS) * (cfg.DEADLY_TYPES.includes(e.type) ? 3 : 1);
      tx += (e.x - px) * w;
      ty += (e.y - py) * w;
    }
    // Move away from the threat centroid with a slight perpendicular (circle-strafe).
    const mx = -tx;
    const my = -ty;
    return { mode: 'evade', ...normalize(mx - my * 0.3, my + mx * 0.3) };
  }

  let target = null;
  let best = Infinity;
  for (const e of enemies) {
    if (cfg.DEADLY_TYPES.includes(e.type)) continue;
    const d = Math.hypot(e.x - px, e.y - py);
    if (d < best) { best = d; target = e; }
  }
  if (!target) return { mode: 'idle', ...ZERO };
  if (best < cfg.HUNT_RANGE) return { mode: 'hunt', target, ...ZERO };
  return { mode: 'hunt', target, ...normalize(target.x - px, target.y - py) };
}

export default { decideMove, pickGem, AUTOPILOT };
