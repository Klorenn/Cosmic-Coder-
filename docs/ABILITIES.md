# Character abilities

One active ability per character. Trigger with **SPACE** (or `abilities.tryActivate()` from a touch
button); the autopilot also fires it automatically when its rule matches.

| Character (id) | Ability | Effect | Cooldown | Autopilot uses it when |
|---|---|---|---|---|
| VibeCoder (`vibecoder`) | `HOT_RELOAD` | Heals 30% max HP instantly, 2 s contact i-frames, +25% attack rate for 6 s | 25 s | HP <= 45% |
| VoidNull (`destroyer`) | `RM_RF` | Shockwave, radius 260 px: 4x attackDamage to every enemy (2x to bosses / mini-bosses), knockback 150 px (40 px for bosses) | 30 s | >= 6 enemies within 200 px, or a boss closer than 150 px |
| SyncStorm (`swordsman`) | `SYNC_DASH` | 220 px dash in the movement direction (away from the nearest enemy when standing still), invulnerable for 0.35 s; leaves an electric trail for 1.5 s that deals 0.5x attackDamage every 0.25 s to enemies within 28 px | 12 s | HP <= 60% with an enemy closer than 90 px, or >= 4 enemies within 120 px |

All numbers live in `src/data/characters.js` (`CHARACTERS[id].ability.params`).

## Modules

| File | Role |
|---|---|
| `src/data/characters.js` | Data: ability per character, cooldowns, params, colors |
| `src/systems/abilities/abilityRules.js` | Pure rules: cooldown state, auto-use, geometry, damage (Vitest) |
| `src/systems/abilities/AbilityController.js` | Phaser integration + `createArenaAbilityHooks(scene)` adapter |
| `src/systems/abilities/abilityFx.js` | Graphics/tween effects, no assets |
| `src/locales/abilities.en.js` / `abilities.es.js` | `abilities.<id>.name/desc`, `abilities.ready`, `abilities.key_hint` |
| `src/__tests__/abilities.test.js` | Data integrity + rules |

## Rules worth knowing

- **Own clock.** The controller advances its clock with `delta` only while not blocked
  (`isPaused`, `playerDead`, no active player), so cooldowns freeze during pause / level-up and a
  scene restart never makes time go backwards. `tick()` also tolerates a backwards `now`.
- **i-frames** reuse the existing contact window: while invulnerable, the controller writes
  `scene.lastContactHitAt = contactLockTimestamp(now, until, CONTACT_IFRAMES_MS)` every frame, so
  `playerHit` rejects contact damage without any change to it. Biome hazard damage is not covered.
- **Attack-rate buff** is an ItemManager timed effect (`id: 'ability_hot_reload'`, type `attackRate`),
  so `getStats()` picks it up via `getItemModifiers()`. Unknown ids are ignored by the HUD buff list.
- **Damage** goes through `scene.hitEnemy({ damage, pierce: true }, enemy)` (crits, kill handling and
  drops behave like any hit).
- **SPACE** is read from the generic `keydown` event because `destroyPauseMenu()` calls
  `keyboard.off('keydown-SPACE')` with no handler, which would also wipe a `keydown-SPACE` listener.
  `keydown` fires before `keydown-SPACE`, so the SPACE that closes the pause menu is still blocked.
- **Autopilot** = `scene.hudMode !== 'manual'`. In manual play the player presses SPACE.
- The controller updates itself on the scene `postupdate` event (after Arcade physics), so the dash
  position is final for the frame. Do NOT also call `update()` from `ArenaScene.update()`.

## Wiring (ArenaScene)

1. Import, next to the other `../systems/...` imports:

```js
import { attachAbilityController, createArenaAbilityHooks } from '../systems/abilities/AbilityController.js';
```

2. In `create()`, right after `this.createHUD();` (the player already exists there and
   `this.playingCharacterId` is set by the player creation):

```js
    // Create HUD
    this.createHUD();
    this.abilities?.destroy();
    this.abilities = attachAbilityController(this, createArenaAbilityHooks(this, this.playingCharacterId));
```

3. In `restartGame()`, next to `this.itemState = createItemState();` (in-place restart without a
   scene shutdown):

```js
    this.abilities?.reset();
```

Shutdown/destroy cleanup is automatic (the controller listens to the scene `shutdown` and `destroy`
events). Optional explicit cleanup inside the existing `this.events.once('shutdown', ...)` in `create()`:
`this.abilities?.destroy(); this.abilities = null;`

## HUD

```js
const ab = this.abilities?.getHudModel();
// { id, characterId, name, desc, nameKey, descKey, color, cooldownPct, remainingMs, ready, active, key: 'SPACE' }
// cooldownPct: 0 = just used -> 1 = ready. Example label:
// ab.ready ? `${ab.name} ${t('abilities.key_hint')}` : `${ab.name} ${Math.ceil(ab.remainingMs / 1000)}s`
```

Touch: a HUD button only needs `this.abilities?.tryActivate()` (returns `true` if it fired).

## Locales

```js
// src/locales/en.js
import abilitiesEn from './abilities.en.js';
export default {
  ...abilitiesEn,
  // existing keys
};

// src/locales/es.js
import abilitiesEs from './abilities.es.js';
export default {
  ...abilitiesEs,
  // existing keys
};
```
