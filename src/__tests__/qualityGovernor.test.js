import { describe, it, expect } from 'vitest';
import { createQualityState, stepQuality, QUALITY_DEFAULTS } from '../systems/hud/qualityGovernor.js';

const feed = (state, samples, opts) => samples.reduce((s, [now, fps, hidden]) => stepQuality(s, { now, fps, hidden }, opts), state);
const series = (fromMs, toMs, everyMs, fps) => {
  const out = [];
  for (let t = fromMs; t <= toMs; t += everyMs) out.push([t, fps]);
  return out;
};

describe('qualityGovernor', () => {
  it('starts high with no samples', () => {
    const s = createQualityState();
    expect(s.level).toBe('high');
    expect(s.samples).toEqual([]);
  });

  it('accepts a forced level and never changes it', () => {
    const s = createQualityState({ forced: 'low' });
    expect(s.level).toBe('low');
    const s2 = feed(createQualityState({ forced: 'high' }), series(0, 20000, 500, 10));
    expect(s2.level).toBe('high');
  });

  it('ignores an unknown forced value', () => {
    expect(createQualityState({ forced: 'ultra' }).level).toBe('high');
  });

  it('stays high on a fast machine', () => {
    const s = feed(createQualityState(), series(0, 20000, 500, 58));
    expect(s.level).toBe('high');
  });

  it('ignores samples during warm-up (asset upload / first spawns stutter)', () => {
    const s = feed(createQualityState(), series(0, QUALITY_DEFAULTS.warmupMs - 500, 500, 5));
    expect(s.level).toBe('high');
    expect(s.samples).toEqual([]);
  });

  it('drops to low when the median fps of a full window stays under the threshold', () => {
    const { warmupMs, windowMs } = QUALITY_DEFAULTS;
    const s = feed(createQualityState(), series(warmupMs, warmupMs + windowMs, 500, 30));
    expect(s.level).toBe('low');
    expect(s.reason).toMatch(/median/);
  });

  it('does not decide before a full window of samples', () => {
    const { warmupMs, windowMs } = QUALITY_DEFAULTS;
    const s = feed(createQualityState(), series(warmupMs, warmupMs + windowMs - 1000, 500, 30));
    expect(s.level).toBe('high');
  });

  it('a short spike does not trigger the drop (median, not min)', () => {
    const { warmupMs } = QUALITY_DEFAULTS;
    const samples = series(warmupMs, warmupMs + 6000, 500, 57).map(([t, f], i) => [t, i % 4 === 0 ? 12 : f]);
    expect(feed(createQualityState(), samples).level).toBe('high');
  });

  it('skips hidden-tab and non-finite samples', () => {
    const { warmupMs, windowMs } = QUALITY_DEFAULTS;
    const samples = series(warmupMs, warmupMs + windowMs, 500, 5).map(([t, f]) => [t, f, true]);
    samples.push([warmupMs + windowMs + 500, NaN]);
    const s = feed(createQualityState(), samples);
    expect(s.level).toBe('high');
    expect(s.samples).toEqual([]);
  });

  it('is one-way: once low it stays low even if fps recovers (no visual flip-flop)', () => {
    const { warmupMs, windowMs } = QUALITY_DEFAULTS;
    let s = feed(createQualityState(), series(warmupMs, warmupMs + windowMs, 500, 30));
    s = feed(s, series(warmupMs + windowMs + 500, warmupMs + windowMs * 4, 500, 60));
    expect(s.level).toBe('low');
  });

  it('keeps only the samples of the sliding window', () => {
    const { warmupMs, windowMs } = QUALITY_DEFAULTS;
    const s = feed(createQualityState(), series(warmupMs, warmupMs + windowMs * 3, 500, 58));
    expect(s.samples.every((x) => x.now >= warmupMs + windowMs * 2)).toBe(true);
  });

  it('does not mutate the previous state', () => {
    const s0 = createQualityState();
    const s1 = stepQuality(s0, { now: QUALITY_DEFAULTS.warmupMs + 10, fps: 40 });
    expect(s0.samples).toEqual([]);
    expect(s1).not.toBe(s0);
  });
});
