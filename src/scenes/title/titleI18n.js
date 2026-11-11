/**
 * Title-screen translation helper. Uses the global i18n first (once the orchestrator merges `title` and
 * `abilities` into src/locales/en.js|es.js) and falls back to the bundled title/abilities locale files.
 */
import { t, currentLang } from '../../utils/i18n.js';
import titleEn from '../../locales/title.en.js';
import titleEs from '../../locales/title.es.js';
import abilitiesEn from '../../locales/abilities.en.js';
import abilitiesEs from '../../locales/abilities.es.js';

const BUNDLED = {
  en: { ...titleEn, ...abilitiesEn },
  es: { ...titleEs, ...abilitiesEs }
};

function lookup(obj, key) {
  const v = key.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), obj);
  return typeof v === 'string' ? v : null;
}

/** Translate any full key (e.g. 'title.menu.START_GAME', 'abilities.rm_rf.name'). */
export function tr(key) {
  const g = t(key);
  if (typeof g === 'string' && g !== key) return g;
  const lang = currentLang() === 'es' ? 'es' : 'en';
  return lookup(BUNDLED[lang], key) ?? lookup(BUNDLED.en, key) ?? key;
}

/** Shorthand for title.* keys. */
export const tt = (key) => tr(`title.${key}`);
