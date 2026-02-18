/**
 * Cosmic Coder — Balance & difficulty tuning
 * Escalado de enemigos, nerfeo de armas, AFK y feedback de dificultad.
 *
 * Enemy scaling: damage/speed/spawn by wave.
 * Weapon nerf: global reduction so player doesn't instakill.
 * AFK: no regen when idle; optional penalty (spawn/damage increase).
 * Critical feedback: threshold and intensity for screen shake / HUD.
 */

// —— Escalado por oleada / Wave scaling ———
/** Daño enemigo: baseDamage * (1 + wave * WAVE_DAMAGE_FACTOR). Ej: wave 10 → 2x, wave 20 → 3x */
export const WAVE_DAMAGE_FACTOR = 0.1;
/** Multiplicador global de daño enemigo. >1 = enemigos pegan más. */
export const ENEMY_DAMAGE_MULT = 1.6;

/** Velocidad enemiga: baseSpeed * (1 + (wave-1) * WAVE_SPEED_FACTOR). Cap opcional. */
export const WAVE_SPEED_FACTOR = 0.02;
export const WAVE_SPEED_CAP = 2.0;
/** Multiplicador global velocidad mobs (+5% más rápidos). */
export const MOB_SPEED_MULT = 1.05;

// —— Escalado por nivel del jugador / Player level scaling ———
/** Enemigos más duros al subir nivel: vida = base * (1 + level * factor), cap. */
export const LEVEL_HEALTH_FACTOR = 0.1;
export const LEVEL_HEALTH_CAP = 6;
/** Velocidad enemiga extra por nivel. */
export const LEVEL_SPEED_FACTOR = 0.03;
export const LEVEL_SPEED_CAP = 2.2;
/** Daño enemigo extra por nivel. */
export const LEVEL_DAMAGE_FACTOR = 0.06;
export const LEVEL_DAMAGE_CAP = 4;

/** Spawn: delay mínimo (ms) entre apariciones. Menor = más enemigos por segundo. */
export const SPAWN_DELAY_MIN = 180;
/** Reducción de delay por oleada: delay = max(SPAWN_DELAY_MIN, baseDelay - wave * SPAWN_DELAY_PER_WAVE). */
export const SPAWN_DELAY_PER_WAVE = 25;
export const SPAWN_DELAY_BASE = 900;

/** Cantidad de enemigos por oleada: base + floor(waveScale). waveScale crece con wave. */
export const WAVE_SCALE_EARLY = 2.5;   // wave < 10
export const WAVE_SCALE_MID = 4;       // wave 10–24
export const WAVE_SCALE_LATE = 6;      // wave >= 25
export const SPAWN_CAP = 150;

// —— Bosses y minibosses ———
/** Boss/mini damage scale: baseDamage * (1 + wave * BOSS_DAMAGE_FACTOR). */
export const BOSS_DAMAGE_FACTOR = 0.08;

// —— Nerfeo armas / Weapon nerf ———
/** Multiplicador global de daño de armas (y stats.attackDamage). 0.8 = -20%. */
export const WEAPON_DAMAGE_NERF = 0.8;

// —— AFK ———
/** Tiempo sin input (ms) para considerar AFK. / Time without input to be considered AFK. */
export const AFK_THRESHOLD_MS = 5000;
/** Si AFK: multiplicador de daño enemigo. >1 = más peligro. */
export const AFK_DAMAGE_MULT = 1.75;
/** Si AFK: multiplicador de spawn rate (inverso del delay). >1 = spawn más rápido. */
export const AFK_SPAWN_MULT = 1.5;
/** Si AFK: multiplicador de daño de armas del jugador. <1 = menos daño al estar idle. */
export const AFK_WEAPON_NERF = 0.5;
/** Regeneración de vida: solo cuando NO AFK. HP por tick. */
export const REGEN_HP_PER_TICK = 1;
/** Intervalo (ms) entre ticks de regen. */
export const REGEN_TICK_MS = 2500;
/** Regen solo si vida < este % de la máxima (evitar regenar al 100%). */
export const REGEN_MAX_HEALTH_PERCENT = 0.98;

// —— Enemigos élite / Elite modifiers ———
/** Probabilidad (0–1) de que un enemigo normal sea élite (modificador aleatorio). */
export const ELITE_CHANCE = 0.12;
/** Modificadores posibles: shield (más vida), speedBurst (más velocidad), criticalHit (puede pegar crítico al jugador). */
export const ELITE_MODIFIERS = ['shield', 'speedBurst', 'criticalHit'];

// —— Feedback daño crítico / Critical hit feedback ———
/** Daño >= CRITICAL_THRESHOLD_PERCENT * maxHealth → se considera golpe crítico (más shake, alerta). */
export const CRITICAL_THRESHOLD_PERCENT = 0.2;
/** Multiplicador de daño de enemigo élite con criticalHit (ej. 1.5x al jugador). */
export const ELITE_CRIT_DAMAGE_MULT = 1.5;
/** Intensidad extra de screen shake en golpe crítico (radios). */
export const CRITICAL_SHAKE_INTENSITY = 0.025;

// —— BITS (más difícil conseguir) ———
/** BITS por oleada superada. */
export const BITS_PER_WAVE = 3;
/** BITS por kill (antes 0.5). */
export const BITS_PER_KILL = 0.3;
/** BITS por cada 100 XP (antes 1 bit por 100 XP). */
export const BITS_PER_100_XP = 0.5;

// —— ZK Bet / Apuesta ZK ———
/** Multiplicador de BITS al enviar a ZK ranked (1.25 = +25% bonus). Incentiva jugar activo y ZK. */
export const ZK_BITS_MULTIPLIER = 1.25;
export const CRITICAL_SHAKE_DURATION = 200;
