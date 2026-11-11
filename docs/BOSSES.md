# Bosses and mini-bosses

Bosses spawn every 20 waves (20/40/60/80, then the last one repeats); mini-bosses on waves 10, 30, 50, ...
Every boss has **3 phases** (100 / 66 / 33 % HP) and each phase **adds one attack**. Mini-bosses keep their
original ability and gain a **second phase at 50 % HP** that shortens its cooldown and scales its strength.

**Rule: every attack is telegraphed** (0.6-1.2 s of visual warning) before it can hurt, and every hit goes
through `playerHit()`, so contact i-frames, Firewall shields and Hotfix revives all apply.

## Files

| File | Role |
|------|------|
| `src/data/enemies.js` | `mechanics` block per boss / mini-boss: phases, cooldowns, telegraph/active times, per-attack tuning |
| `src/systems/bossAI.js` | Pure brain (tested in `src/__tests__/bossAI.test.js`): phase from HP, attack choice with cooldowns + seeded RNG, telegraph -> execute -> end events, boss-bar info |
| `src/systems/bossFx.js` | Telegraphs and effects (hard-edged graphics, tweens, square debris). Draws only |
| `src/scenes/ArenaScene.js` | `spawnBoss(id?)`, `spawnMiniBoss(id?)`, `updateBossAI()` (runs after the enemy loop), `runBossAttack()`, `runMiniBossAbility()`, `onBossDefeated()`, `bossBarLabel()` |
| `scripts/evil-player/screenshot-bosses.mjs` | Forces each boss/phase and screenshots the telegraph; autopilot survival check vs boss 1 |

## Bosses

| Boss (wave) | Phase 1 (100 %) | Phase 2 (66 %) | Phase 3 (33 %) |
|---|---|---|---|
| STACK OVERFLOW (20) | **Stack Push**: 2 columns of block shadows near the player (1.0 s), blocks fall (hit if under one) and stay as walls for 4.5 s; each column has one gap | **Recursion** (once): 2 clone markers (0.9 s), clones with 25 % max HP spawn; when a clone dies it shows a 90 px circle and explodes 0.7 s later | **Overflow**: ring preview with a green safe wedge (1.1 s), then a shockwave expands to 520 px; be outside it or in the gap |
| NULL POINTER (40) | **Null Zones**: 3 circles (1.0 s) become zones for 4 s; while the player stands inside one the boss takes 0 damage (it turns translucent, "NULL" pops) | **Dereference**: locked lane from the boss (0.9 s), then it dashes 520 px along it | **Glitch Swarm**: 6 markers around the boss (0.8 s), 6 glitches spawn |
| MEMORY LEAK PRIME (60) | **Leak**: 3 puddle markers (0.8 s), puddles grow for 7 s and slow the player to 50 % | **Garbage**: tethers up to 6 nearby enemies (1.0 s), pulls them for 2.5 s; survivors are absorbed and heal 4 % each. Kill them to interrupt | **Fragmentation**: 4 orbit markers (1.0 s), 4 fragments (5 % HP each) orbit for 9 s; each blinks 0.6 s before firing a slow shot at the player |
| KERNEL PANIC (80) | **Panic**: red screen flicker + 3 zone markers (1.0 s), zones pulse damage every 0.8 s for 4 s | **Interrupt**: marker on the player + destination (1.1 s), player is teleported 230 px from the boss, ring preview with gap (0.7 s), ring fires | **Halt**: closing brackets on the player (1.0 s), player frozen 1 s while the beam lane is drawn; the beam fires 1.6 s after the freeze starts (0.6 s to step out or use the ability) |

Contact damage of bosses is 60 % of their attack damage (`mechanics.contactDamageMult`), since the
telegraphed attacks are now the main threat. Clones/fragments hit for 40 %.

## Mini-bosses (phase 2 at 50 % HP: cooldown x0.6, effect x`intensity[1]`)

| Mini-boss | Telegraph | Effect (phase 2) |
|---|---|---|
| DEADLOCK | range circle 0.8 s, it stops | slow if still inside the circle (longer, stronger) |
| THRASHING | spawn markers 0.8 s | 3 bugs (5) |
| DDoS | lane 0.7 s, it stops | straight dash along the lane (faster/longer) |
| ZERO-DAY | green blink + "PATCHING…" 0.9 s | heals 8 % (12 %) |
| BOTNET | destination marker 0.7 s | blinks next to the player (closer) |

## Reward

When a boss dies: the existing guaranteed weapon drop (hitEnemy) **plus** a guaranteed epic/legendary item
(`ITEMS`, picked with the boss brain's seed) and the **BOSS DEFEATED** banner (`showHudBanner`).

## Boss bar

`NAME ●●○` (phase pips) and, for 1 s after a telegraph starts, `› ATTACK NAME`. Strings: `bosses.*` in
`src/locales/en.js` / `es.js`.

## Adding a boss

1. Add the entry to `BOSSES` with `mechanics.attacks` (`phase`, `nameKey`, `telegraphMs` 600-1200,
   `activeMs`, `cooldownMs`, optional `once` / `range` / `weight`).
2. Add a `case '<attackId>'` to `ArenaScene.runBossAttack()` with a `telegraph` branch (bossFx warning, no
   damage) and an `execute` branch (damage via `bossDamagePlayer()` / hazards via `addBossHazard()`).
3. Add `bosses.attacks.*` strings in en/es. `bossAI.test.js` checks telegraph bounds, one attack per phase and
   that a simulated fight fires every attack.
4. `node scripts/evil-player/screenshot-bosses.mjs` (dev server on :3001) to eyeball each phase.
