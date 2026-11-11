/**
 * qualityGovernor — pure, one-way graphics quality decision (no Phaser).
 *
 * The arena is fill-rate bound on weak GPUs / software GL: each full-screen layer (biome far +
 * near parallax backgrounds) costs a full 1920x1080 fill per frame. The scene samples
 * game.loop.actualFps every ~500 ms; when the median of a full window (after a warm-up) stays under
 * `lowFps`, the governor switches to 'low' and MapManager collapses the two parallax layers into
 * one. It never goes back up during a run, so the background never flip-flops.
 */

export const QUALITY_LEVELS = Object.freeze(['high', 'low']);

export const QUALITY_DEFAULTS = Object.freeze({
  warmupMs: 3000, // texture uploads + first wave spawn stutter
  windowMs: 4000, // sliding window of samples used for the decision
  lowFps: 48 // median under this -> 'low'
});

const isLevel = (v) => QUALITY_LEVELS.includes(v);

/**
 * @param {{forced?:'high'|'low', startAt?:number}} [opts] forced pins the level (settings / tests)
 */
export function createQualityState({ forced, startAt = 0 } = {}) {
  const pinned = isLevel(forced) ? forced : null;
  return {
    level: pinned || 'high',
    forced: pinned,
    startAt: Number.isFinite(startAt) ? startAt : 0,
    samples: [],
    reason: pinned ? 'forced' : null
  };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {object} state from createQualityState / a previous stepQuality
 * @param {{now:number, fps:number, hidden?:boolean}} sample
 * @param {Partial<typeof QUALITY_DEFAULTS>} [opts]
 * @returns {object} next state (the input is not mutated)
 */
export function stepQuality(state, sample, opts = {}) {
  const cfg = { ...QUALITY_DEFAULTS, ...opts };
  if (!state || state.forced || state.level === 'low') return state;
  const now = sample?.now;
  const fps = sample?.fps;
  if (sample?.hidden || !Number.isFinite(now) || !Number.isFinite(fps) || fps <= 0) return state;
  if (now - state.startAt < cfg.warmupMs) return state;

  const samples = [...state.samples, { now, fps }].filter((x) => x.now >= now - cfg.windowMs);
  const next = { ...state, samples };
  const span = samples.length ? now - samples[0].now : 0;
  if (span < cfg.windowMs) return next;

  const med = median(samples.map((x) => x.fps));
  if (med < cfg.lowFps) {
    return { ...next, level: 'low', reason: `median ${Math.round(med)} fps < ${cfg.lowFps}` };
  }
  return next;
}

export default { createQualityState, stepQuality, QUALITY_DEFAULTS, QUALITY_LEVELS };
