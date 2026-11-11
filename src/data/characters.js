/**
 * Character abilities (pure data). Ids match window.VIBE_CHARACTERS in src/main.js.
 * One active ability per character: SPACE key + auto-use by the autopilot.
 * Every number in `params` must be finite (see abilities.test.js).
 */
export const CHARACTERS = Object.freeze({
  vibecoder: Object.freeze({
    id: 'vibecoder',
    ability: Object.freeze({
      id: 'HOT_RELOAD',
      name_key: 'abilities.hot_reload.name',
      desc_key: 'abilities.hot_reload.desc',
      cooldownMs: 25000,
      key: 'SPACE',
      color: 0x00ffcc,
      params: Object.freeze({
        healPct: 0.3, // of maxHealth, instant
        iFrameMs: 2000, // contact invulnerability
        attackRateMult: 1.25, // +25% attack rate
        buffMs: 6000,
        autoHpPct: 0.45 // autopilot uses it at HP <= 45%
      })
    })
  }),
  destroyer: Object.freeze({
    id: 'destroyer',
    ability: Object.freeze({
      id: 'RM_RF',
      name_key: 'abilities.rm_rf.name',
      desc_key: 'abilities.rm_rf.desc',
      cooldownMs: 30000,
      key: 'SPACE',
      color: 0xb04dff,
      params: Object.freeze({
        radius: 260,
        damageMult: 4, // x attackDamage
        bossDamageMult: 2, // x attackDamage vs bosses / mini-bosses
        knockbackPx: 150,
        bossKnockbackPx: 40, // bosses are heavy: short shove only
        autoEnemyCount: 6,
        autoEnemyRadius: 200,
        autoBossDist: 150
      })
    })
  }),
  swordsman: Object.freeze({
    id: 'swordsman',
    ability: Object.freeze({
      id: 'SYNC_DASH',
      name_key: 'abilities.sync_dash.name',
      desc_key: 'abilities.sync_dash.desc',
      cooldownMs: 12000,
      key: 'SPACE',
      color: 0xffe600,
      params: Object.freeze({
        distance: 220,
        durationMs: 350, // invulnerable while dashing
        trailMs: 1500,
        trailTickMs: 250,
        trailDamageMult: 0.5, // x attackDamage per tick
        trailWidth: 28, // px from the trail line that counts as touching
        autoHpPct: 0.6,
        autoNearestDist: 90,
        autoEnemyCount: 4,
        autoEnemyRadius: 120
      })
    })
  })
});

export const CHARACTER_IDS = Object.freeze(Object.keys(CHARACTERS));
export const DEFAULT_CHARACTER_ID = 'vibecoder';

/** Resolve a character id (unknown -> vibecoder). */
export function resolveCharacterId(characterId) {
  return typeof characterId === 'string' && Object.prototype.hasOwnProperty.call(CHARACTERS, characterId)
    ? characterId
    : DEFAULT_CHARACTER_ID;
}

/** Ability definition for a character (unknown -> vibecoder's). */
export function getCharacterAbility(characterId) {
  return CHARACTERS[resolveCharacterId(characterId)].ability;
}

export default CHARACTERS;
