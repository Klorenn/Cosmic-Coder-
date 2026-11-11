/**
 * Pure parsing/sanitizing of the persisted `vibeCoderSettings` blob.
 * localStorage is user-controlled: anything can be in there (corrupt JSON, wrong types, absurd numbers).
 * The game must sanitize, never crash.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  autoMove: true,
  sfxEnabled: true,
  musicEnabled: true,
  masterVolume: 0.7,
  sfxVolume: 0.8,
  menuMusicVolume: 0.5,
  gameplayMusicVolume: 0.5,
  playerName: '',
  immortalMode: false,
  xpPenaltyOnDeath: 0.5,
  language: 'en'
});

const MAX_NAME_LENGTH = 20;

function bool(v, fallback) {
  return typeof v === 'boolean' ? v : fallback;
}

/** Number clamped to [0, 1]; non-numbers / NaN fall back. */
function unit(v, fallback) {
  if (typeof v !== 'number' || Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

/**
 * Sanitize an already-parsed settings object into a complete, well-typed settings record.
 * @param {unknown} data
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function sanitizeSettings(data) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const legacyMusic = unit(d.musicVolume, DEFAULT_SETTINGS.menuMusicVolume);
  return {
    autoMove: bool(d.autoMove, DEFAULT_SETTINGS.autoMove),
    sfxEnabled: bool(d.sfxEnabled, DEFAULT_SETTINGS.sfxEnabled),
    musicEnabled: bool(d.musicEnabled, DEFAULT_SETTINGS.musicEnabled),
    masterVolume: unit(d.masterVolume, DEFAULT_SETTINGS.masterVolume),
    sfxVolume: unit(d.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    menuMusicVolume: unit(d.menuMusicVolume, legacyMusic),
    gameplayMusicVolume: unit(d.gameplayMusicVolume, legacyMusic),
    playerName: typeof d.playerName === 'string' ? d.playerName.slice(0, MAX_NAME_LENGTH) : '',
    immortalMode: bool(d.immortalMode, DEFAULT_SETTINGS.immortalMode),
    xpPenaltyOnDeath: unit(d.xpPenaltyOnDeath, DEFAULT_SETTINGS.xpPenaltyOnDeath),
    language: d.language === 'es' ? 'es' : 'en'
  };
}

/**
 * Parse the raw localStorage string. Corrupt JSON yields defaults instead of throwing.
 * @param {string|null} raw
 */
export function parseStoredSettings(raw) {
  if (typeof raw !== 'string' || raw === '') return sanitizeSettings(null);
  try {
    return sanitizeSettings(JSON.parse(raw));
  } catch (_) {
    return sanitizeSettings(null);
  }
}
