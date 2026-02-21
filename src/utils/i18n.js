/**
 * Simple i18n for Cosmic Coder - English & Spanish
 * Uses VIBE_SETTINGS.language ('en' | 'es'). Fallback: 'en'.
 */
import en from '../locales/en.js';
import es from '../locales/es.js';

const locales = { en, es };

function getLanguage() {
  const lang = (typeof window !== 'undefined' && window.VIBE_SETTINGS?.language) || 'en';
  return locales[lang] ? lang : 'en';
}

export function currentLang() {
  return getLanguage();
}

export function setLanguage(lang) {
  if (locales[lang] && typeof window !== 'undefined' && window.VIBE_SETTINGS) {
    window.VIBE_SETTINGS.language = lang;
    window.VIBE_SETTINGS.save();
    return true;
  }
  return false;
}

/**
 * Translate key. Supports dot notation: t('menu.START_GAME') -> 'START GAME'
 * @param {string} key - e.g. 'menu.START_GAME' or 'title'
 * @returns {string}
 */
export function t(key) {
  const lang = getLanguage();
  const locale = locales[lang] || en;
  const parts = key.split('.');
  let value = locale;
  for (const p of parts) {
    value = value?.[p];
  }
  return typeof value === 'string' ? value : key;
}

/**
 * Get array of dev/hacker bark phrases for a character (vibecoder, destroyer, swordsman).
 * @param {string} charId - character id
 * @returns {string[]}
 */
export function getBarks(charId) {
  const lang = getLanguage();
  const locale = locales[lang] || en;
  const arr = locale.barks && locale.barks[charId];
  return Array.isArray(arr) ? arr : [];
}

export default { t, currentLang, setLanguage, getBarks };
