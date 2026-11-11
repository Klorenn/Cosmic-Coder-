# Waves & spawning (Vampire Survivors style)

Code: `src/systems/waveRules.js` (clock -> wave, stat scaling), `src/systems/spawnDirector.js` (pure director),
`ArenaScene.startWave / beginWave / updateSpawnDirector / advanceWave / spawnEnemy`. Tunables: `DIRECTOR_*`,
`WAVE_*` in `src/config/balance.js`. Enemy pool fields: `waveMin`, `spawnWeight`, `tier` in `src/data/enemies.js`.

## Rules

- **Time drives the wave.** `wave = 1 + floor(runClock / WAVE_DURATION_MS)` with `WAVE_DURATION_MS = 45 s`.
  Killing never ends a wave; surviving does. The clock only stops while the rebirth prompt is open and after death.
- **Continuous spawning.** Every `spawnIntervalMs(wave)` a group of `groupSize(wave)` enemies appears 1.1-1.3x
  beyond the camera rectangle (never on screen; mirrored across the camera centre at world edges).
- **Population target** `maxAlive(wave) = min(300, 20 + 12*(wave-1))`. Below 50 % of the target the interval is
  divided by 3 (burst refill); at or above the target the director pauses. Hard cap (events, minions): 360.
- **Pool.** An enemy enters at `waveMin`; its weight is `max(0.1, spawnWeight * 0.5^((wave-waveMin)/6))`, so old
  types fade into filler as new ones arrive. A tier is rolled first (trash 70 % -> 25 %, elite 5 % -> 20 % over
  waves 1-20), then a type inside that tier.
- **Elite modifier** (shield / speedBurst / criticalHit) chance: `3 % + 0.6 %/wave`, cap 20 %.
- **Stats:** `health x(1 + 8 %*(w-1))`, `damage x(1 + 4 %*(w-1))`, `speed x(1 + 1 %*(w-1))` cap 1.4. Player-level
  scaling was cut (HP +3 %/level cap x2, dmg +2 %/level cap x1.5, speed +1 %/level cap x1.3): difficulty comes from
  the count, not from sponge enemies.
- **Wave events** (seeded): first at wave 4, then every 3-5 waves, one of
  - `swarm`: 30-60 trash in an even ring just outside the screen, all closing in;
  - `horde`: 20-40 trash/normal in a column that marches straight across (`behavior: 'march'`, 14 s, then chase);
  - `elitePack`: 4-6 elite-tier enemies with elite modifiers, clustered.
  The old `EventManager` random events (XP rain, curse, SWARM, ...) still roll at each non-boss wave start.
- **Bosses** at waves 20/40/60/80 and **mini-bosses** at 10/30/50/... spawn at wave start *on top of* the normal
  flow (spawning never stops).
- **Wave change:** wave sound, survival XP bonus (`wave*25`, `*100` after a boss wave), autosave, leaderboard
  entry, rebirth milestone prompt, HUD banner via `showHudBanner`.

## Per-wave numbers

| wave | starts at | maxAlive | interval ms | group | tier mix trash/normal/elite | elite mod | HP / dmg | types | top of pool |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 min | 20 | 1200 | 1 | 70/25/5 | 3 % | x1.00 / x1.00 | 4 | bug 42 %, typo 28 %, glitch 25 %, memory-leak 5 % |
| 3 | 1.5 min | 44 | 972 | 1 | 65/28/7 | 4.2 % | x1.16 / x1.08 | 6 | bug 39 %, typo 26 %, pop-up 10 %, null-byte 9 %, glitch 8 %, memory-leak 7 % |
| 5 | 3 min | 68 | 787 | 2 | 61/31/8 | 5.4 % | x1.32 / x1.16 | 10 | bug 25 %, cookie 20 %, typo 16 %, memory-leak 8 %, lag-spike / spam-bot / syntax-error 6 %, pop-up / null-byte 5 %, glitch 4 % |
| 10 | 6.8 min | 128 | 465 | 3 | 49/39/12 | 8.4 % | x1.72 / x1.36 | 13 | bug 20 %, cookie 16 %, typo 13 %, memory-leak 12 %, lag-spike 6 %, spam-bot / syntax-error / 404 5 %, then 3-4 % each |
| 20 | 14.3 min | 248 | 162 | 5 | 25/55/20 | 14.4 % | x2.52 / x1.76 | 13 | stack-overflow 15 %, hallucination 14 %, segfault 13 %, bug 11 % |
| 40 | 29.3 min | 300 | 150 | 6 | 25/55/20 | 20 % | x4.12 / x2.56 | 19 | bug 13 %, hallucination 13 %, then an even mix |

Events: first at wave 4, then +3..5 waves (e.g. 4, 8, 11, 15, 19, ...; exact waves depend on the run seed).
Bosses: 20 STACK OVERFLOW, 40 NULL POINTER, 60 MEMORY LEAK PRIME, 80 KERNEL PANIC. Mini-bosses: 10, 30, 50, 70, ...

Enemy unlocks (`waveMin`): bug/typo/glitch/memory-leak 1, null-byte 2, pop-up 3, syntax-error/spam-bot 4,
cookie/lag-spike 5, infinite-loop 6, race-condition 8,
404 10, hallucination 12, cors-error 14, stack-overflow 16, token-overflow 17, type-error 18, segfault 20,
context-loss 21, git-conflict 22, dependency-hell 24, overfitting 26, prompt-injection 28, mode-collapse 30.

Regenerate the table: evaluate `maxAlive / spawnIntervalMs / groupSize / tierShares / eliteModChance /
effectiveWeight` from `spawnDirector.js` for each wave.

## Early pool (waves 1-5)

Wave 1 used to be ~70 % `bug` (the werewolf sheet): the only trash-tier type, and the trash tier is 70 % of every
spawn at wave 1. Six early types were added so every early wave introduces something new:

| id | waveMin | tier | weight | HP / spd / dmg / XP | behavior |
|---|---|---|---|---|---|
| typo | 1 | trash | 4 | 14 / 82 / 11 / 4 | `zigzag`: fast, weaves side to side while chasing |
| null-byte | 2 | normal | 2 | 110 / 26 / 20 / 18 | `chase`: slow tank |
| pop-up | 3 | normal | 2 | 48 / 50 / 14 / 12 | `teleport` every 3 s (short blink toward the player) |
| spam-bot | 4 | normal | 2 | 50 / 48 / 16 / 14 | `dash`: brakes 0.55 s to aim, dashes 0.42 s at x3.4 in a straight line, 1.6 s cooldown |
| cookie | 5 | trash | 3 | 34 / 52 / 12 / 8 | `split`: breaks into 2 small cookies on death (like git-conflict) |
| lag-spike | 5 | normal | 2 | 52 / 44 / 15 / 12 | `burst`: crawls at x0.35 for 1.2 s, sprints at x3 for 0.52 s |

Measured in game (scripts/evil-player/screenshot-xpgems.mjs, 30 s each): wave 1 = 4 types, wave 3 = 6 types.

## XP gems

Kills no longer grant XP directly: every kill (and bosses / mini-bosses, rm -rf, legendary weapons) drops an XP gem
worth `xpValue x event/modifier multipliers` (`src/systems/xpGems.js`). Blue 1-9 XP, green 10-49, magenta 50+.
A gem within `XP_PICKUP_RADIUS` (56 px) flies to the player with growing speed and grants its XP on contact
(`VIBE_CODER.addXP`, which also feeds the score). Uncollected gems never level you up. The magnet item and the
XP-magnet event vacuum every gem on the floor. At most `XP_GEMS_MAX` (250) gems live at once: the oldest are fused
into one gem at their centre of mass (total XP preserved). The wave-survival bonus is still instant.

