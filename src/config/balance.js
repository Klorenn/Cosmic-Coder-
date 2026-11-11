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
/** Daño enemigo de minions: baseDamage * (1 + wave * WAVE_DAMAGE_FACTOR). Los mobs normales usan waveStatScale (waveRules.js). */
export const WAVE_DAMAGE_FACTOR = 0.04; // = WAVE_DAMAGE_GROWTH (minions de minibosses)
/** Multiplicador global de daño enemigo. >1 = enemigos pegan más. */
export const ENEMY_DAMAGE_MULT = 0.75; // was 1.6: wave-1 bug hit 26 on 120 HP with no i-frames

// —— Daño de contacto / Contact damage ———
/** Invulnerabilidad tras un golpe de contacto (ms). Overlap dispara cada frame. */
export const CONTACT_IFRAMES_MS = 600;
/** Bonus de velocidad cuando hay actividad de código (XP server). El auto-play funciona siempre. */
export const CODING_ACTIVE_SPEED_MULT = 1.1;

/** Velocidad enemiga: baseSpeed * (1 + (wave-1) * WAVE_SPEED_FACTOR). Cap opcional. */
export const WAVE_SPEED_FACTOR = 0.01;
export const WAVE_SPEED_CAP = 1.4;
/** Multiplicador global velocidad mobs (+5% más rápidos). */
export const MOB_SPEED_MULT = 1.05;

// —— Escalado por nivel del jugador / Player level scaling ———
/** Enemigos más duros al subir nivel: vida = base * (1 + level * factor), cap. */
export const LEVEL_HEALTH_FACTOR = 0.03; // was 0.1 cap 6: sponge enemies; difficulty now comes from count
export const LEVEL_HEALTH_CAP = 2;
/** Velocidad enemiga extra por nivel. */
export const LEVEL_SPEED_FACTOR = 0.01;
export const LEVEL_SPEED_CAP = 1.3;
/** Daño enemigo extra por nivel. */
export const LEVEL_DAMAGE_FACTOR = 0.02;
export const LEVEL_DAMAGE_CAP = 1.5;

// —— Oleadas por tiempo + director de spawn (estilo Vampire Survivors) / Time waves + spawn director ———
// Ver docs/WAVES.md y src/systems/spawnDirector.js. La oleada avanza por reloj; matar no la termina.
/** Duración de una oleada (ms). La oleada N empieza en (N-1) * WAVE_DURATION_MS de reloj de partida. */
export const WAVE_DURATION_MS = 45000;
/** Población objetivo: min(CAP, START + PER_WAVE * (wave-1)). Si hay menos vivos, el director acelera. */
export const DIRECTOR_MAX_ALIVE_START = 20;
export const DIRECTOR_MAX_ALIVE_PER_WAVE = 12;
export const DIRECTOR_MAX_ALIVE_CAP = 300;
/** Tope absoluto (incluye eventos Swarm/Horde y minions). */
export const DIRECTOR_HARD_CAP = 360;
/** Intervalo entre grupos: max(MIN, START * DECAY^(wave-1)). 1200 ms (w1) -> ~160 ms (w20) -> 150 ms. */
export const DIRECTOR_INTERVAL_START_MS = 1200;
export const DIRECTOR_INTERVAL_DECAY = 0.9;
export const DIRECTOR_INTERVAL_MIN_MS = 150;
/** Tamaño de grupo: min(MAX, 1 + floor((wave-1) / WAVES_PER_STEP)). */
export const DIRECTOR_GROUP_MAX = 6;
export const DIRECTOR_GROUP_WAVES_PER_STEP = 4;
/** Relleno: con vivos < FILL_RATIO * objetivo, el intervalo se divide por BURST_DIV. */
export const DIRECTOR_FILL_RATIO = 0.5;
export const DIRECTOR_BURST_DIV = 3;
/** Anillo de spawn: entre MIN y MAX veces el radio visible (siempre fuera de cámara). */
export const DIRECTOR_RING_MIN = 1.1;
export const DIRECTOR_RING_MAX = 1.3;
/** Decaimiento de pesos: max(FLOOR, spawnWeight * 0.5^((wave-waveMin)/HALF_LIFE)). FLOOR absoluto = relleno. */
export const DIRECTOR_WEIGHT_HALF_LIFE = 6;
export const DIRECTOR_WEIGHT_FLOOR = 0.1;
/** Mezcla de tiers: trash 70% -> 25%, elite 5% -> 20% entre la oleada 1 y TIER_RAMP_WAVES+1. */
export const DIRECTOR_TRASH_SHARE_START = 0.7;
export const DIRECTOR_TRASH_SHARE_END = 0.25;
export const DIRECTOR_ELITE_SHARE_START = 0.05;
export const DIRECTOR_ELITE_SHARE_END = 0.2;
export const DIRECTOR_TIER_RAMP_WAVES = 19;
/** Probabilidad de modificador élite (shield/speedBurst/criticalHit) por spawn: START + PER_WAVE*(w-1), cap. */
export const DIRECTOR_ELITE_MOD_START = 0.03;
export const DIRECTOR_ELITE_MOD_PER_WAVE = 0.006;
export const DIRECTOR_ELITE_MOD_CAP = 0.2;
/** Eventos de oleada (Swarm / Horde / Elite pack): el primero en FIRST_WAVE, luego cada 3-5 oleadas (seed). */
export const DIRECTOR_EVENT_FIRST_WAVE = 4;
export const DIRECTOR_EVENT_GAP_MIN = 3;
export const DIRECTOR_EVENT_GAP_MAX = 5;
/** Escalado suave por oleada (la dificultad viene de la cantidad): +8% HP, +4% daño por oleada. */
export const WAVE_HP_GROWTH = 0.08;
export const WAVE_DAMAGE_GROWTH = 0.04;

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
