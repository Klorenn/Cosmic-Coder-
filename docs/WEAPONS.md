# Weapons — power & balance

Every weapon has an animation (`applyWeaponArt`, `proj-*` / `swing-*` / `orb-*` / `aura-*`, see `docs/ASSETS.md`)
**and a power of its own**. The power is data (`power` in `src/data/weapons.js`), the rules are pure
(`src/systems/weaponEffects.js`), and ArenaScene only wires them to Phaser objects (`autoAttack`,
`spawnWeaponProjectile`, `hitEnemy`, `dealWeaponHit`, `handleEnemyDeath`, `doAoeAttack`, `doBeam`, `doMeleeArc`,
`doThrust`, `explodeAt`, `chainFrom`, `splitProjectile`, `bounceToNext`, `steerReturning`, `updateOrbitals`,
`updateWeaponStatus`).

## Status effects (per enemy, `enemy.wfx`)

| Status | Source | Effect | Tint |
|---|---|---|---|
| slow | freeze, icelance, blizzard, frostbrand, deathaura | -40..60% speed (velocity scaled after AI movement) | pale blue |
| freeze | stacks of slow (3 for freeze, 2 for the evolutions) | speed 0 for 1-1.5 s | blue `0x60a5fa` |
| burn | ring of fire | 50% of hit damage per second, 4 s | orange `0xf97316` |
| bleed | kunai, shuriken storm | 40% of hit damage per second, 3 s | red `0xdc2626` |
| mark | rapid (20% per hit) | +20% damage taken, 3 s | white |
| execute | rm -rf | kills below 20% HP (bosses 8%) | — |

Bosses and mini-bosses are CC-immune (they drive their own speed: dashes, phases) and barely move on knockback.
Every damage source (projectiles, orbitals, AoE, beam, melee, DoT, abilities, hazards) goes through
`dealWeaponHit` → `handleEnemyDeath`, so XP/drops/boss cleanup are identical whatever kills the enemy
(orbitals/AoE used to `destroy()` directly and skipped boss cleanup). Piercing projectiles hit each enemy
once per pass (they used to hit every frame while overlapping) and orbitals have a per-enemy hit cooldown.

## Balance model (`src/systems/weaponBalance.js`)

`expectedDps(weapon, scenario)` with attackDamage = 1 and the player's base 480 ms attack delay. Scenarios:
`single` (one chaser), `pack5` (tight cluster), `horde20` (surrounded), `boss` (one big CC-immune target).
It accounts for cadence, projectiles, fan/spiral accuracy, pierce budget + ramp, bounces, chain falloff,
impact/pulse radius, return trips, fork generations, orbit uptime + hit cooldown, DoT uptime, mark uptime,
crit and execute. Multi-hit is worth `hits^0.8` (overkill, retarget misses).

Raw DPS is not comparable across scenarios (a horde has 20x the HP on screen), so a weapon is rated by its
**niche index** = DPS in its best scenario / median base-weapon DPS in that scenario. Tests
(`src/__tests__/weaponBalance.test.js`) enforce:

- inside each drop tier, every base weapon's niche index is >= 0.8x the tier best and <= 1.3x the tier median;
- every evolution is 1.6x-2.4x its best component;
- no weapon is below 0.6x the base median in every scenario (i.e. useless);
- no base weapon is beaten by >= 15% in all four scenarios by a same-tier weapon.

Tiers: common = basic + spread, pierce, rapid, homing, bounce + melee (sword, spear, boomerang, kunai);
uncommon = orbital, aoe, freeze; rare (boss drops) = rm -rf, sudo, fork bomb. `rm -rf` still nukes the screen
on pickup and then stays equipped as the executioner weapon; `sudo` is the 10 s sudo-mode weapon.

## Table (model DPS, attackDamage = 1)

| Weapon | Tier | Power | dmg x | rate x | single | pack5 | horde20 | boss | niche | index |
|---|---|---|---|---|---|---|---|---|---|---|
| basic | common | Reliable bolt, +10% crit | 1 | 0.6 | 1.35 | 1.35 | 1.35 | 1.35 | single target | 1.15 |
| spread | common | 5-pellet short-range fan | 0.36 | 0.68 | 1.07 | 1.70 | 2.03 | 1.44 | hordes | 1.15 |
| pierce | common | Passes through 4 enemies, +15% damage per enemy pierced | 0.36 | 0.75 | 0.56 | 1.53 | 2.03 | 0.56 | hordes | 1.13 |
| orbital | uncommon | 3 orbs circle you, continuous damage + light knockback | 0.4 | 0 | 0.32 | 1.10 | 2.28 | 0.50 | hordes | 1.28 |
| rapid | common | High fire rate; 20% chance to mark (+20% damage taken, 3 s) | 0.39 | 1.4 | 1.35 | 1.35 | 1.35 | 1.35 | single target | 1.15 |
| homing | common | Seeks targets, prioritises elites and bosses | 0.84 | 0.7 | 1.35 | 1.35 | 1.35 | 1.35 | single target | 1.15 |
| bounce | common | Ricochets between 4 enemies, +10% per bounce | 0.36 | 0.59 | 0.44 | 1.88 | 1.88 | 0.44 | packs | 1.16 |
| aoe | uncommon | Blast centred on the nearest enemy | 0.51 | 0.5 | 0.58 | 2.12 | 1.58 | 0.58 | packs | 1.31 |
| freeze | uncommon | Slows 50% for 2 s; 3 stacks freeze for 1 s | 0.92 | 0.8 | 1.52 | 1.52 | 1.52 | 1.52 | single target | 1.29 |
| rmrf | rare | Executes enemies under 20% HP (bosses under 8%) | 1.28 | 0.4 | 1.32 | 2.35 | 2.35 | 1.15 | packs | 1.45 |
| sudo | rare | Guaranteed crits x2.5 at half fire rate | 1.21 | 0.3 | 1.70 | 1.70 | 1.70 | 1.70 | single target | 1.45 |
| forkbomb | rare | Splits into 2 on hit, up to 2 generations | 0.36 | 0.63 | 1.27 | 1.87 | 2.55 | 1.50 | hordes | 1.43 |
| sword | common | Wide 160 degree slash with knockback | 0.36 | 1.04 | 0.64 | 1.87 | 1.59 | 0.60 | packs | 1.16 |
| spear | common | Long thrust that skewers a line of enemies | 0.36 | 0.74 | 0.46 | 1.29 | 2.03 | 0.43 | hordes | 1.14 |
| boomerang | common | Flies out and returns, hitting everything twice | 0.36 | 0.59 | 0.78 | 1.88 | 1.88 | 0.78 | packs | 1.16 |
| kunai | common | 3 fast kunai that bleed for 3 s | 0.36 | 0.66 | 1.35 | 1.44 | 1.44 | 1.35 | packs | 1.15 |

| Evolution | Recipe | Power | dmg x | rate x | single | pack5 | horde20 | boss | index | x best part |
|---|---|---|---|---|---|---|---|---|---|---|
| laserbeam | spread+pierce | Continuous beam through everything, ticks every 100 ms | 0.12 | 4.12 | 1.35 | 2.82 | 4.11 | 1.35 | 2.30 | 1.99 |
| plasmaorb | orbital+rapid | Orbs detonate in an AoE burst every 2 s | 0.5 | 0 | 1.02 | 3.61 | 4.56 | 1.33 | 2.55 | 2.00 |
| chainlightning | pierce+rapid | Arcs to 5 more enemies, -15% per jump | 0.3 | 2.06 | 1.27 | 3.71 | 4.07 | 1.27 | 2.30 | 1.99 |
| bullethell | spread+rapid | 8-shot rotating spiral | 0.3 | 1.23 | 1.23 | 2.36 | 4.10 | 1.70 | 2.29 | 1.99 |
| ringoffire | orbital+spread | Ring of 8 flames that burn for 4 s | 0.29 | 0 | 0.68 | 2.14 | 4.58 | 1.00 | 2.56 | 2.00 |
| seekingmissile | homing+pierce | Homing missile that explodes on impact | 0.97 | 0.5 | 1.70 | 3.70 | 2.35 | 1.70 | 2.29 | 1.99 |
| chaosbounce | bounce+spread | Bounces up to 10 times over 4 s | 0.3 | 0.33 | 0.50 | 1.96 | 4.09 | 0.50 | 2.29 | 1.97 |
| deathaura | aoe+orbital | Aura that damages and slows everything near you | 0.43 | 0 | 0.77 | 2.74 | 4.68 | 0.97 | 2.62 | 2.00 |
| icelance | freeze+pierce | Piercing lance; 2 stacks freeze | 1.08 | 0.6 | 1.34 | 3.55 | 4.63 | 1.34 | 2.59 | 2.00 |
| swarm | homing+rapid | 6 mini homing darts | 0.3 | 0.93 | 2.68 | 2.68 | 2.68 | 2.68 | 2.29 | 1.98 |
| blizzard | freeze+aoe | Icy nova that freezes on 2 stacks | 1.46 | 0.35 | 1.17 | 4.24 | 4.24 | 1.17 | 2.63 | 2.00 |
| excalibur | sword+spear | 360 degree slash plus a shockwave | 0.3 | 0.76 | 0.57 | 2.78 | 4.12 | 0.54 | 2.31 | 2.00 |
| gungnir | spear+pierce | Spear that pierces everything and returns | 0.49 | 0.7 | 1.26 | 3.15 | 4.04 | 1.26 | 2.26 | 1.99 |
| ricochetblade | boomerang+bounce | Returning blade that ricochets between enemies | 0.3 | 0.68 | 1.30 | 3.55 | 4.15 | 1.30 | 2.32 | 2.00 |
| shurikenstorm | kunai+homing | 6 homing shuriken that bleed | 0.3 | 0.9 | 2.71 | 3.03 | 3.03 | 2.71 | 2.31 | 2.01 |
| frostbrand | sword+freeze | Freezing 200 degree slash | 0.58 | 1.2 | 1.20 | 4.15 | 4.11 | 1.12 | 2.57 | 1.98 |

Base medians: single 1.17, pack5 1.62, horde20 1.79, boss 1.25.

## In-game check (`scripts/evil-player/weapon-power.mjs`)

Each weapon equipped 8 s against a horde kept at 20 bugs (40 HP, spawned 40-240 px around a **standing**
player, headless ~16 FPS). Kills per 8 s (single run, noisy ±50%):

basic 4 · spread 7 · pierce 5 · orbital 0-4 · rapid 3 · homing 1-2 · bounce 6 · aoe 7 · freeze 2 · rmrf 5 · sudo 6 ·
forkbomb 13 · sword 11 · spear 2 · boomerang 5 · kunai 4 · laserbeam 13 · plasmaorb 12 · chainlightning 13 ·
bullethell 17 · ringoffire 10 · seekingmissile 3 · chaosbounce 45 · deathaura 17 · icelance 56 · swarm 19 ·
blizzard 37 · excalibur 13 · gungnir 2-35 · ricochetblade 22 · shurikenstorm 11 · frostbrand 0-1

Caveats: this is a horde-only test, so single-target weapons (basic, homing, rapid, freeze, sudo, seeking
missile) are expected low; melee/orbitals suffer because the player never walks into the pack and frozen or
knocked-back enemies stay out of reach. Evolutions out-kill their parts in the horde except frostbrand and
seeking missile (single-target / reach niches).
