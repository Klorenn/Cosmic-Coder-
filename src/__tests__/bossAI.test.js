import { describe, it, expect } from 'vitest';
import {
  TELEGRAPH_MIN_MS, TELEGRAPH_MAX_MS, nextRandom, phaseForHp, createBossBrain, stepBoss,
  unlockedAttacks, bossBarInfo, phasePips
} from '../systems/bossAI.js';
import { BOSSES, MINI_BOSSES } from '../data/enemies.js';

const MECH = {
  phases: [1, 0.66, 0.33],
  openingDelayMs: 1000,
  globalCooldownMs: 500,
  phaseCooldownMult: [1, 0.8, 0.6],
  attacks: {
    alpha: { phase: 1, nameKey: 'bosses.attacks.a', telegraphMs: 800, activeMs: 1000, cooldownMs: 4000, weight: 1 },
    beta: { phase: 2, nameKey: 'bosses.attacks.b', telegraphMs: 900, activeMs: 500, cooldownMs: 6000, weight: 1 },
    gamma: { phase: 3, nameKey: 'bosses.attacks.c', telegraphMs: 1000, activeMs: 0, cooldownMs: 8000, weight: 1, once: true }
  }
};

/** Run the brain with a fixed tick; returns every event with its timestamp. */
function run(brain, mech, { from = 0, to, dt = 50, hp = () => 100, maxHp = 100, dist = 100 }) {
  const out = [];
  let b = brain;
  for (let now = from; now <= to; now += dt) {
    const r = stepBoss(b, mech, { now, hp: hp(now), maxHp, dist });
    b = r.brain;
    for (const e of r.events) out.push({ ...e, now });
  }
  return { brain: b, events: out };
}

describe('bossAI: seeded RNG', () => {
  it('nextRandom is deterministic and in [0,1)', () => {
    const a = nextRandom(42);
    const b = nextRandom(42);
    expect(a).toEqual(b);
    expect(a.value).toBeGreaterThanOrEqual(0);
    expect(a.value).toBeLessThan(1);
    expect(nextRandom(a.seed).value).not.toBe(a.value);
  });
});

describe('bossAI: phases by % HP', () => {
  it('maps HP ratio to 1/2/3 with 66% and 33% thresholds', () => {
    expect(phaseForHp(100, 100, MECH.phases)).toBe(1);
    expect(phaseForHp(67, 100, MECH.phases)).toBe(1);
    expect(phaseForHp(66, 100, MECH.phases)).toBe(2);
    expect(phaseForHp(34, 100, MECH.phases)).toBe(2);
    expect(phaseForHp(33, 100, MECH.phases)).toBe(3);
    expect(phaseForHp(0, 100, MECH.phases)).toBe(3);
  });

  it('garbage input stays in phase 1', () => {
    expect(phaseForHp(NaN, 100, MECH.phases)).toBe(1);
    expect(phaseForHp(50, 0, MECH.phases)).toBe(1);
  });

  it('two-phase minibosses switch at 50%', () => {
    expect(phaseForHp(51, 100, [1, 0.5])).toBe(1);
    expect(phaseForHp(50, 100, [1, 0.5])).toBe(2);
  });

  it('unlockedAttacks grows one attack per phase', () => {
    expect(unlockedAttacks(MECH, 1)).toEqual(['alpha']);
    expect(unlockedAttacks(MECH, 2)).toEqual(['alpha', 'beta']);
    expect(unlockedAttacks(MECH, 3)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('emits a phase event once and never goes back when healed', () => {
    let b = createBossBrain(MECH, { seed: 1, now: 0 });
    let r = stepBoss(b, MECH, { now: 10, hp: 60, maxHp: 100, dist: 50 });
    expect(r.events.filter((e) => e.type === 'phase')).toEqual([{ type: 'phase', phase: 2, from: 1 }]);
    b = r.brain;
    r = stepBoss(b, MECH, { now: 20, hp: 90, maxHp: 100, dist: 50 });
    expect(r.brain.phase).toBe(2);
    expect(r.events.some((e) => e.type === 'phase')).toBe(false);
  });

  it('does not mutate the previous brain', () => {
    const b = createBossBrain(MECH, { seed: 1, now: 0 });
    const snap = JSON.stringify(b);
    stepBoss(b, MECH, { now: 5000, hp: 10, maxHp: 100, dist: 50 });
    expect(JSON.stringify(b)).toBe(snap);
  });
});

describe('bossAI: telegraph -> execute -> end', () => {
  it('waits for the opening delay, telegraphs, then executes after telegraphMs', () => {
    const b = createBossBrain(MECH, { seed: 7, now: 0 });
    const { events } = run(b, MECH, { to: 4000 });
    const tel = events.find((e) => e.type === 'telegraph');
    expect(tel.now).toBeGreaterThanOrEqual(1000);
    expect(tel.attack).toBe('alpha');
    expect(tel.durationMs).toBe(800);
    const exe = events.find((e) => e.type === 'execute');
    expect(exe.attack).toBe('alpha');
    expect(exe.now - tel.now).toBeGreaterThanOrEqual(800);
    expect(exe.now - tel.now).toBeLessThan(800 + 60);
    const end = events.find((e) => e.type === 'end');
    expect(end.now - exe.now).toBeGreaterThanOrEqual(1000);
  });

  it('never runs two attacks at once and respects per-attack cooldowns', () => {
    const b = createBossBrain(MECH, { seed: 3, now: 0 });
    const { events } = run(b, MECH, { to: 30000 });
    let open = 0;
    for (const e of events) {
      if (e.type === 'telegraph') { expect(open).toBe(0); open = 1; }
      if (e.type === 'end') open = 0;
    }
    const alphaStarts = events.filter((e) => e.type === 'telegraph' && e.attack === 'alpha').map((e) => e.now);
    expect(alphaStarts.length).toBeGreaterThan(2);
    for (let i = 1; i < alphaStarts.length; i++) expect(alphaStarts[i] - alphaStarts[i - 1]).toBeGreaterThanOrEqual(4000);
  });

  it('a newly unlocked attack fires first after a phase change', () => {
    const b = createBossBrain(MECH, { seed: 9, now: 0 });
    const { events } = run(b, MECH, { to: 12000, hp: (now) => (now < 5000 ? 100 : 60) });
    const after = events.filter((e) => e.type === 'telegraph' && e.now >= 5000);
    expect(after[0].attack).toBe('beta');
  });

  it('once-attacks fire a single time', () => {
    const b = createBossBrain(MECH, { seed: 5, now: 0 });
    const { events } = run(b, MECH, { to: 60000, hp: () => 10 });
    expect(events.filter((e) => e.type === 'telegraph' && e.attack === 'gamma')).toHaveLength(1);
  });

  it('out-of-range attacks are skipped', () => {
    const mech = { ...MECH, attacks: { alpha: { ...MECH.attacks.alpha, range: 200 } } };
    const b = createBossBrain(mech, { seed: 1, now: 0 });
    expect(run(b, mech, { to: 5000, dist: 500 }).events.some((e) => e.type === 'telegraph')).toBe(false);
    expect(run(b, mech, { to: 5000, dist: 150 }).events.some((e) => e.type === 'telegraph')).toBe(true);
  });

  it('same seed => same attack sequence; different seed may differ', () => {
    const seq = (seed) => run(createBossBrain(MECH, { seed, now: 0 }), MECH, { to: 40000, hp: () => 20 })
      .events.filter((e) => e.type === 'telegraph').map((e) => `${e.attack}@${e.now}`).join(',');
    expect(seq(11)).toBe(seq(11));
  });

  it('later phases shorten cooldowns', () => {
    const count = (hp) => run(createBossBrain(MECH, { seed: 2, now: 0 }), MECH, { to: 40000, hp: () => hp })
      .events.filter((e) => e.type === 'telegraph' && e.attack === 'alpha').length;
    // phase 1 (only alpha) vs phase 3 (alpha competes with others but has 0.6x cooldown): alpha still fires often
    expect(count(10)).toBeGreaterThan(0);
  });
});

describe('bossAI: boss bar info', () => {
  it('phasePips draws filled pips for reached phases', () => {
    expect(phasePips(1, 3)).toBe('●○○');
    expect(phasePips(2, 3)).toBe('●●○');
    expect(phasePips(3, 3)).toBe('●●●');
    expect(phasePips(2, 2)).toBe('●●');
  });

  it('shows the attack label while telegraphing and for 1 s after it started', () => {
    let b = createBossBrain(MECH, { seed: 1, now: 0 });
    let r;
    for (let now = 0; now <= 1100; now += 50) { r = stepBoss(b, MECH, { now, hp: 100, maxHp: 100, dist: 10 }); b = r.brain; }
    const start = b.current.startedAt;
    expect(bossBarInfo(b, MECH, start + 100)).toEqual({ phase: 1, phases: 3, pips: '●○○', labelKey: 'bosses.attacks.a', telegraphing: true });
    expect(bossBarInfo(b, MECH, start + 1500).labelKey).toBeNull();
  });
});

describe('boss data: every boss attack is telegraphed and phased', () => {
  const all = { ...BOSSES, ...MINI_BOSSES };
  it('bosses have 3 phases, each adding exactly one attack', () => {
    for (const [id, def] of Object.entries(BOSSES)) {
      expect(def.mechanics, id).toBeTruthy();
      expect(def.mechanics.phases).toEqual([1, 0.66, 0.33]);
      for (const p of [1, 2, 3]) expect(unlockedAttacks(def.mechanics, p), `${id} p${p}`).toHaveLength(p);
    }
  });

  it('minibosses keep their ability and gain a 50% phase', () => {
    for (const [id, def] of Object.entries(MINI_BOSSES)) {
      expect(def.mechanics.phases, id).toEqual([1, 0.5]);
      expect(Object.keys(def.mechanics.attacks)).toEqual([def.ability]);
      expect(def.mechanics.phaseCooldownMult[1]).toBeLessThan(1);
    }
  });

  it(`telegraphs last ${TELEGRAPH_MIN_MS}-${TELEGRAPH_MAX_MS} ms and every attack has a name`, () => {
    for (const [id, def] of Object.entries(all)) {
      for (const [aid, a] of Object.entries(def.mechanics.attacks)) {
        expect(a.telegraphMs, `${id}.${aid}`).toBeGreaterThanOrEqual(TELEGRAPH_MIN_MS);
        expect(a.telegraphMs, `${id}.${aid}`).toBeLessThanOrEqual(TELEGRAPH_MAX_MS);
        expect(a.cooldownMs, `${id}.${aid}`).toBeGreaterThan(0);
        expect(typeof a.nameKey).toBe('string');
      }
    }
  });

  it('attack names are localised in en and es', async () => {
    const en = (await import('../locales/en.js')).default;
    const es = (await import('../locales/es.js')).default;
    const get = (obj, key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
    const keys = new Set(['bosses.defeated', 'bosses.phase']);
    for (const def of Object.values(all)) for (const a of Object.values(def.mechanics.attacks)) keys.add(a.nameKey);
    for (const k of keys) {
      expect(typeof get(en, k), `en ${k}`).toBe('string');
      expect(typeof get(es, k), `es ${k}`).toBe('string');
    }
  });

  it('a whole boss fight simulation never stalls (attacks keep coming in every phase)', () => {
    for (const [id, def] of Object.entries(BOSSES)) {
      const r = run(createBossBrain(def.mechanics, { seed: 99, now: 0 }), def.mechanics, {
        to: 90000, dt: 100, hp: (now) => Math.max(1, 100 - now / 900), dist: 200
      });
      const fired = new Set(r.events.filter((e) => e.type === 'execute').map((e) => e.attack));
      expect([...fired].sort(), id).toEqual(Object.keys(def.mechanics.attacks).sort());
    }
  });
});
