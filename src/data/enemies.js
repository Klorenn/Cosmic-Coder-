/**
 * Enemy, mini-boss and boss definitions (pure data + pure helpers, no Phaser).
 *
 * Regular enemies:
 *   waveMin: first wave the enemy enters the spawn pool (1 = always available)
 *   spawnWeight: base weight in the spawn pool (default 1); decays with (wave - waveMin), see spawnDirector.js
 *   tier: 'trash' | 'normal' | 'elite' — spawn mix bucket for the director (trash share falls, elite share grows)
 *   texture: Phaser texture key (defaults to the enemy id). `*-v2` keys are pixel-art sheets
 *            from public/assets/sprites/enemies (src/scenes/boot/enemyAssets.js).
 *   anim: looping animation key for that sheet; frameWidth/frameHeight: sheet frame size.
 *   Mini-bosses / bosses carry the same fields (ArenaScene falls back to the procedural key).
 */
export const ENEMIES = {
  bug: { health: 24, speed: 45, damage: 14, xpValue: 5, behavior: 'chase', waveMin: 1, tier: 'trash', spawnWeight: 6 },
  // Early pool (waves 1-5): one new type every wave so wave 1 is not just bugs (docs/WAVES.md).
  typo: { health: 14, speed: 82, damage: 11, xpValue: 4, behavior: 'zigzag', zigzagAmp: 0.9, zigzagFreq: 0.006, waveMin: 1, tier: 'trash', spawnWeight: 4, texture: 'enemy-typo-v2', anim: 'enemy-typo-v2-anim', frameWidth: 32, frameHeight: 32 },
  'null-byte': { health: 110, speed: 26, damage: 20, xpValue: 18, behavior: 'chase', waveMin: 2, tier: 'normal', spawnWeight: 2, texture: 'enemy-null-byte-v2', anim: 'enemy-null-byte-v2-anim', frameWidth: 32, frameHeight: 32 },
  'pop-up': { health: 48, speed: 50, damage: 14, xpValue: 12, behavior: 'teleport', teleportCooldown: 3000, waveMin: 3, tier: 'normal', spawnWeight: 2, texture: 'enemy-pop-up-v2', anim: 'enemy-pop-up-v2-anim', frameWidth: 32, frameHeight: 32 },
  'spam-bot': { health: 50, speed: 48, damage: 16, xpValue: 14, behavior: 'dash', dashSpeedMult: 3.4, dashMs: 420, windupMs: 550, dashCooldown: 1600, waveMin: 4, tier: 'normal', spawnWeight: 2, texture: 'enemy-spam-bot-v2', anim: 'enemy-spam-bot-v2-anim', frameWidth: 32, frameHeight: 32 },
  cookie: { health: 34, speed: 52, damage: 12, xpValue: 8, behavior: 'split', splitCount: 2, waveMin: 5, tier: 'trash', spawnWeight: 3, texture: 'enemy-cookie-v2', anim: 'enemy-cookie-v2-anim', frameWidth: 32, frameHeight: 32 },
  'lag-spike': { health: 52, speed: 44, damage: 15, xpValue: 12, behavior: 'burst', burstSlowMs: 1200, burstFastMs: 520, burstSpeedMult: 3, waveMin: 5, tier: 'normal', spawnWeight: 2, texture: 'enemy-lag-spike-v2', anim: 'enemy-lag-spike-v2-anim', frameWidth: 32, frameHeight: 32 },
  glitch: { health: 45, speed: 75, damage: 17, xpValue: 15, behavior: 'chase', waveMin: 1, tier: 'normal', spawnWeight: 2, texture: 'enemy-glitch-v2', anim: 'enemy-glitch-v2-anim', frameWidth: 32, frameHeight: 32 },
  'memory-leak': { health: 90, speed: 28, damage: 24, xpValue: 30, behavior: 'chase', waveMin: 1, tier: 'elite', spawnWeight: 2, texture: 'enemy-memory-leak-v2', anim: 'enemy-memory-leak-v2-anim', frameWidth: 32, frameHeight: 32 },
  'syntax-error': { health: 18, speed: 110, damage: 13, xpValue: 10, behavior: 'teleport', teleportCooldown: 2800, waveMin: 4, tier: 'normal', spawnWeight: 2, texture: 'enemy-syntax-error-v2', anim: 'enemy-syntax-error-v2-anim', frameWidth: 32, frameHeight: 32 },
  'infinite-loop': { health: 60, speed: 55, damage: 16, xpValue: 20, behavior: 'orbit', orbitRadius: 120, waveMin: 6, tier: 'normal', texture: 'enemy-infinite-loop-v2', anim: 'enemy-infinite-loop-v2-anim', frameWidth: 32, frameHeight: 32 },
  'race-condition': { health: 40, speed: 70, damage: 18, xpValue: 25, behavior: 'erratic', speedVariance: 90, waveMin: 8, tier: 'normal', texture: 'enemy-race-condition-v2', anim: 'enemy-race-condition-v2-anim', frameWidth: 32, frameHeight: 32 },

  // Coding-themed
  // balance: segfault damage typo fixed -> 24 (was ~56x the tier median of 17, one-shot on contact). 24 = top of tier (memory-leak).
  segfault: { health: 12, speed: 0, damage: 24, xpValue: 50, behavior: 'deathzone', lifespan: 8000, waveMin: 20, tier: 'normal', texture: 'enemy-segfault-v2', anim: 'enemy-segfault-v2-anim', frameWidth: 32, frameHeight: 32 },
  'dependency-hell': { health: 120, speed: 32, damage: 18, xpValue: 80, behavior: 'spawner', spawnInterval: 2700, maxMinions: 5, waveMin: 24, tier: 'elite', texture: 'enemy-dependency-hell-v2', anim: 'enemy-dependency-hell-v2-anim', frameWidth: 32, frameHeight: 32 },
  'stack-overflow': { health: 150, speed: 38, damage: 20, xpValue: 100, behavior: 'grow', growRate: 0.0012, waveMin: 16, tier: 'elite', texture: 'enemy-stack-overflow-v2', anim: 'enemy-stack-overflow-v2-anim', frameWidth: 32, frameHeight: 32 },

  // AI-themed
  hallucination: { health: 1, speed: 55, damage: 10, xpValue: 1, behavior: 'fake', waveMin: 12, tier: 'trash', spawnWeight: 2, texture: 'enemy-hallucination-v2', anim: 'enemy-hallucination-v2-anim', frameWidth: 32, frameHeight: 32 },
  'token-overflow': { health: 60, speed: 50, damage: 17, xpValue: 40, behavior: 'growDamage', growRate: 0.0007, waveMin: 17, tier: 'normal', texture: 'enemy-token-overflow-v2', anim: 'enemy-token-overflow-v2-anim', frameWidth: 32, frameHeight: 32 },
  'context-loss': { health: 70, speed: 65, damage: 19, xpValue: 60, behavior: 'contextLoss', teleportCooldown: 2400, wanderChance: 0.35, waveMin: 21, tier: 'normal', texture: 'enemy-context-loss-v2', anim: 'enemy-context-loss-v2-anim', frameWidth: 32, frameHeight: 32 },
  'prompt-injection': { health: 85, speed: 45, damage: 17, xpValue: 100, behavior: 'hijack', hijackDuration: 5500, hijackCooldown: 9000, waveMin: 28, tier: 'elite', texture: 'enemy-prompt-injection-v2', anim: 'enemy-prompt-injection-v2-anim', frameWidth: 32, frameHeight: 32 },

  // v2 (mixed AI + coding)
  '404-not-found': { health: 35, speed: 60, damage: 15, xpValue: 20, behavior: 'invisible', waveMin: 10, tier: 'normal', texture: 'enemy-404-not-found-v2', anim: 'enemy-404-not-found-v2-anim', frameWidth: 32, frameHeight: 32 },
  'cors-error': { health: 50, speed: 0, damage: 20, xpValue: 30, behavior: 'blocker', blockDuration: 6000, waveMin: 14, tier: 'normal', texture: 'enemy-cors-error-v2', anim: 'enemy-cors-error-v2-anim', frameWidth: 32, frameHeight: 32 },
  'type-error': { health: 45, speed: 55, damage: 17, xpValue: 25, behavior: 'morph', morphInterval: 2800, waveMin: 18, tier: 'normal', texture: 'enemy-type-error-v2', anim: 'enemy-type-error-v2-anim', frameWidth: 32, frameHeight: 32 },
  'git-conflict': { health: 65, speed: 45, damage: 16, xpValue: 35, behavior: 'split', waveMin: 22, tier: 'normal', texture: 'enemy-git-conflict-v2', anim: 'enemy-git-conflict-v2-anim', frameWidth: 32, frameHeight: 32 },
  overfitting: { health: 75, speed: 70, damage: 18, xpValue: 45, behavior: 'predict', waveMin: 26, tier: 'elite', texture: 'enemy-overfitting-v2', anim: 'enemy-overfitting-v2-anim', frameWidth: 32, frameHeight: 32 },
  'mode-collapse': { health: 95, speed: 38, damage: 19, xpValue: 60, behavior: 'clone', cloneCooldown: 7500, cloneRadius: 130, waveMin: 30, tier: 'elite', texture: 'enemy-mode-collapse-v2', anim: 'enemy-mode-collapse-v2-anim', frameWidth: 32, frameHeight: 32 }
};

/**
 * Mini-bosses: one per stage band, spawned on waves 10, 30, 50, ... (between bosses).
 * The highest `minWave` <= current wave is chosen. Each has a distinct ability executed by ArenaScene:
 *   freeze  - slows the player when close
 *   summon  - spawns minions around itself
 *   dash    - short burst of speed toward the player
 *   regen   - heals a % of max health
 *   blink   - teleports next to the player
 */
export const MINI_BOSSES = {
  'miniboss-deadlock': {
    name: 'DEADLOCK', nameKey: 'bosses.deadlock', minWave: 10,
    health: 500, speed: 35, damage: 22, xpValue: 150, color: 0xff6600,
    ability: 'freeze', abilityCooldown: 6000, abilityRange: 220, slowMult: 0.4, slowMs: 1500,
    texture: 'miniboss-deadlock-v2', anim: 'miniboss-deadlock-v2-anim', frameWidth: 48, frameHeight: 48,
    // Telegraphed ability + a 50% HP phase that shortens the cooldown and scales it by intensity[1].
    mechanics: { phases: [1, 0.5], openingDelayMs: 1500, globalCooldownMs: 600, phaseCooldownMult: [1, 0.6], intensity: [1, 1.5], attacks: { freeze: { phase: 1, nameKey: 'bosses.attacks.freeze', telegraphMs: 800, activeMs: 0, cooldownMs: 6000, range: 220 } } }
  },
  'miniboss-thrashing': {
    name: 'THRASHING', nameKey: 'bosses.thrashing', minWave: 30,
    health: 900, speed: 30, damage: 24, xpValue: 300, color: 0xaa00ff,
    ability: 'summon', abilityCooldown: 7000, abilityRange: 600, minionType: 'bug', minionCount: 3,
    texture: 'miniboss-thrashing-v2', anim: 'miniboss-thrashing-v2-anim', frameWidth: 48, frameHeight: 48,
    // Telegraphed ability + a 50% HP phase that shortens the cooldown and scales it by intensity[1].
    mechanics: { phases: [1, 0.5], openingDelayMs: 1500, globalCooldownMs: 600, phaseCooldownMult: [1, 0.6], intensity: [1, 1.67], attacks: { summon: { phase: 1, nameKey: 'bosses.attacks.summon', telegraphMs: 800, activeMs: 0, cooldownMs: 7000, range: 600 } } }
  },
  'miniboss-ddos': {
    name: 'DDoS', nameKey: 'bosses.ddos', minWave: 50,
    health: 1300, speed: 45, damage: 26, xpValue: 450, color: 0x00ff66,
    ability: 'dash', abilityCooldown: 4000, abilityRange: 450, dashMult: 4, dashMs: 600,
    texture: 'miniboss-ddos-v2', anim: 'miniboss-ddos-v2-anim', frameWidth: 48, frameHeight: 48,
    // Telegraphed ability + a 50% HP phase that shortens the cooldown and scales it by intensity[1].
    mechanics: { phases: [1, 0.5], openingDelayMs: 1500, globalCooldownMs: 600, phaseCooldownMult: [1, 0.6], intensity: [1, 1.3], attacks: { dash: { phase: 1, nameKey: 'bosses.attacks.dash', telegraphMs: 700, activeMs: 600, cooldownMs: 4000, range: 450 } } }
  },
  'miniboss-zeroday': {
    name: 'ZERO-DAY', nameKey: 'bosses.zeroday', minWave: 70,
    health: 1800, speed: 40, damage: 30, xpValue: 650, color: 0xff2200,
    ability: 'regen', abilityCooldown: 5000, abilityRange: 9999, regenPct: 0.08,
    texture: 'miniboss-zeroday-v2', anim: 'miniboss-zeroday-v2-anim', frameWidth: 48, frameHeight: 48,
    // Telegraphed ability + a 50% HP phase that shortens the cooldown and scales it by intensity[1].
    mechanics: { phases: [1, 0.5], openingDelayMs: 1500, globalCooldownMs: 600, phaseCooldownMult: [1, 0.6], intensity: [1, 1.5], attacks: { regen: { phase: 1, nameKey: 'bosses.attacks.regen', telegraphMs: 900, activeMs: 0, cooldownMs: 5000 } } }
  },
  'miniboss-botnet': {
    name: 'BOTNET', nameKey: 'bosses.botnet', minWave: 110,
    health: 2600, speed: 50, damage: 34, xpValue: 900, color: 0x4488ff,
    ability: 'blink', abilityCooldown: 5000, abilityRange: 9999, blinkDistance: 120,
    texture: 'miniboss-botnet-v2', anim: 'miniboss-botnet-v2-anim', frameWidth: 48, frameHeight: 48,
    // Telegraphed ability + a 50% HP phase that shortens the cooldown and scales it by intensity[1].
    mechanics: { phases: [1, 0.5], openingDelayMs: 1500, globalCooldownMs: 600, phaseCooldownMult: [1, 0.6], intensity: [1, 1.5], attacks: { blink: { phase: 1, nameKey: 'bosses.attacks.blink', telegraphMs: 700, activeMs: 0, cooldownMs: 5000 } } }
  }
};

/**
 * Bosses every 20 waves, ordered by wave. `mechanics` drives systems/bossAI.js (3 phases at 100/66/33% HP,
 * each phase adds one attack) and the scene-side effects in systems/bossFx.js. Every attack is telegraphed
 * (telegraphMs 600-1200) before its damage window (activeMs). Extra fields are per-attack tuning read by
 * ArenaScene.runBossAttack(). See docs/BOSSES.md.
 */
const BOSS_PHASES = [1, 0.66, 0.33];
export const BOSSES = {
  'boss-stackoverflow': {
    name: 'STACK OVERFLOW', nameKey: 'bosses.stack_overflow', health: 2000, speed: 30, damage: 25, xpValue: 500, wave: 20, color: 0x00ff00, ability: 'spawnMinions',
    texture: 'boss-stackoverflow-v2', anim: 'boss-stackoverflow-v2-anim', frameWidth: 64, frameHeight: 64,
    mechanics: {
      phases: BOSS_PHASES, openingDelayMs: 2000, contactDamageMult: 0.6, globalCooldownMs: 1100, phaseCooldownMult: [1, 0.85, 0.7],
      attacks: {
        // Falling block columns (shadow telegraph); landed blocks become temporary walls.
        stackPush: { phase: 1, nameKey: 'bosses.attacks.stack_push', telegraphMs: 1000, activeMs: 4500, cooldownMs: 7000, columns: 2, blocks: 6, blockSize: 34, gap: 1, damageMult: 0.8 },
        // Splits off 2 clones with 25% max HP that explode (telegraphed) on death.
        recursion: { phase: 2, nameKey: 'bosses.attacks.recursion', telegraphMs: 900, activeMs: 0, cooldownMs: 16000, once: true, clones: 2, cloneHpPct: 0.25, explodeRadius: 90, explodeTelegraphMs: 700, damageMult: 0.9 },
        // Expanding shockwave ring with one safe gap; outrun it or stand in the gap.
        overflow: { phase: 3, nameKey: 'bosses.attacks.overflow', telegraphMs: 1100, activeMs: 1300, cooldownMs: 9000, maxRadius: 520, ringWidth: 34, gapRad: 0.9, damageMult: 1.1 }
      }
    }
  },
  'boss-nullpointer': {
    name: 'NULL POINTER', nameKey: 'bosses.null_pointer', health: 3500, speed: 60, damage: 30, xpValue: 1000, wave: 40, color: 0xff00ff, ability: 'teleport',
    texture: 'boss-nullpointer-v2', anim: 'boss-nullpointer-v2-anim', frameWidth: 64, frameHeight: 64,
    mechanics: {
      phases: BOSS_PHASES, openingDelayMs: 2000, contactDamageMult: 0.6, globalCooldownMs: 1000, phaseCooldownMult: [1, 0.85, 0.7],
      attacks: {
        // 3 circles: after the warning the boss takes 0 damage while the player stands inside one.
        nullZones: { phase: 1, nameKey: 'bosses.attacks.null_zones', telegraphMs: 1000, activeMs: 4000, cooldownMs: 8000, zones: 3, radius: 80, spread: 170 },
        // Locks a line towards the player, then dashes along it.
        dereference: { phase: 2, nameKey: 'bosses.attacks.dereference', telegraphMs: 900, activeMs: 380, cooldownMs: 6000, length: 520, width: 44, damageMult: 1.2 },
        // Summons 6 glitches around itself.
        glitchSwarm: { phase: 3, nameKey: 'bosses.attacks.glitch_swarm', telegraphMs: 800, activeMs: 0, cooldownMs: 11000, count: 6, minion: 'glitch', radius: 90 }
      }
    }
  },
  'boss-memoryleakprime': {
    name: 'MEMORY LEAK PRIME', nameKey: 'bosses.memory_leak_prime', health: 5000, speed: 20, damage: 35, xpValue: 1500, wave: 60, color: 0xaa00ff, ability: 'split',
    texture: 'boss-memoryleakprime-v2', anim: 'boss-memoryleakprime-v2-anim', frameWidth: 64, frameHeight: 64,
    mechanics: {
      phases: BOSS_PHASES, openingDelayMs: 2000, contactDamageMult: 0.6, globalCooldownMs: 1000, phaseCooldownMult: [1, 0.85, 0.7],
      attacks: {
        // Growing puddles that slow the player.
        leak: { phase: 1, nameKey: 'bosses.attacks.leak', telegraphMs: 800, activeMs: 7000, cooldownMs: 8000, puddles: 3, startRadius: 36, endRadius: 105, slowMult: 0.5 },
        // Tethers nearby enemies; the ones still alive when it ends are absorbed to heal it (kill them to interrupt).
        garbage: { phase: 2, nameKey: 'bosses.attacks.garbage', telegraphMs: 1000, activeMs: 2500, cooldownMs: 10000, radius: 360, maxTargets: 6, healPctEach: 0.04 },
        // Splits 4 orbiting fragments that fire telegraphed shots.
        fragmentation: { phase: 3, nameKey: 'bosses.attacks.fragmentation', telegraphMs: 1000, activeMs: 9000, cooldownMs: 14000, fragments: 4, orbitRadius: 110, fragmentHpPct: 0.05, shotEveryMs: 1700, shotTelegraphMs: 600, shotSpeed: 210, damageMult: 0.6 }
      }
    }
  },
  'boss-kernelpanic': {
    name: 'KERNEL PANIC', nameKey: 'bosses.kernel_panic', health: 8000, speed: 40, damage: 45, xpValue: 3000, wave: 80, color: 0xff0000, ability: 'rage',
    texture: 'boss-kernelpanic-v2', anim: 'boss-kernelpanic-v2-anim', frameWidth: 64, frameHeight: 64,
    mechanics: {
      phases: BOSS_PHASES, openingDelayMs: 2000, contactDamageMult: 0.6, globalCooldownMs: 900, phaseCooldownMult: [1, 0.85, 0.7],
      attacks: {
        // Screen flicker + 3 pulsing damage zones.
        panic: { phase: 1, nameKey: 'bosses.attacks.panic', telegraphMs: 1000, activeMs: 4000, cooldownMs: 8000, zones: 3, radius: 75, spread: 190, pulseMs: 800, damageMult: 0.5 },
        // Teleports the player next to the boss, then fires a ring with a gap.
        interrupt: { phase: 2, nameKey: 'bosses.attacks.interrupt', telegraphMs: 1100, activeMs: 2200, cooldownMs: 11000, landDistance: 230, ringDelayMs: 700, maxRadius: 480, ringWidth: 30, gapRad: 1.0, damageMult: 0.9 },
        // Freezes the player 1 s, then fires a beam along the locked line (dodge after the freeze or with the ability).
        halt: { phase: 3, nameKey: 'bosses.attacks.halt', telegraphMs: 1000, activeMs: 1900, cooldownMs: 10000, freezeMs: 1000, beamDelayMs: 1600, beamWidth: 40, beamLength: 900, damageMult: 1.3 }
      }
    }
  }
};

export const BOSS_WAVE_INTERVAL = 20;

export function isBossWave(wave) {
  return wave > 0 && wave % BOSS_WAVE_INTERVAL === 0;
}

/** Mini-boss waves sit halfway between bosses: 10, 30, 50, ... */
export function isMiniBossWave(wave) {
  return wave >= 10 && wave % BOSS_WAVE_INTERVAL === 10;
}

function pickByThreshold(table, wave, field) {
  let chosen = Object.keys(table)[0];
  for (const [id, def] of Object.entries(table)) {
    if (wave >= def[field]) chosen = id;
  }
  return chosen;
}

/** Boss id for a boss wave (highest boss.wave <= wave). */
export function getBossForWave(wave) {
  return pickByThreshold(BOSSES, wave, 'wave');
}

/** Mini-boss id for a wave (highest minWave <= wave). */
export function getMiniBossForWave(wave) {
  return pickByThreshold(MINI_BOSSES, wave, 'minWave');
}

/**
 * Decide whether a mini-boss fires its ability this frame.
 * @param {object} def - MINI_BOSSES entry
 * @param {{now:number,lastAbilityTime:number,distToPlayer:number}} ctx
 * @returns {string|null} ability name or null
 */
export function nextMiniBossAction(def, ctx) {
  if (!def || !ctx) return null;
  if (ctx.now - (ctx.lastAbilityTime || 0) < def.abilityCooldown) return null;
  if (ctx.distToPlayer > def.abilityRange) return null;
  return def.ability;
}

/** Independent shallow copy of a table (scenes may mutate entries). */
export function cloneTable(table) {
  return Object.fromEntries(Object.entries(table).map(([k, v]) => [k, { ...v }]));
}
