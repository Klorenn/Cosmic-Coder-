/** Pure title-menu data: options (max 8; DOCUMENTATION lives in CREDITS) and corner number formatting. */

export const TITLE_MENU_OPTIONS = Object.freeze(['START_GAME', 'UPGRADES', 'WEAPONS', 'CHARACTER', 'LEADERBOARD', 'SETTINGS', 'CONTROLS', 'CREDITS']);

/** i18n key of the one-line hint shown under the selected item (null = no hint). */
export function menuHintKey(option) {
  return option === 'START_GAME' ? 'title.play_hint' : null;
}

/** 1234 -> "1.2K", 1250000 -> "1.3M"; garbage / negatives -> "0". */
export function compactNumber(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return '0';
  const fmt = (v, s) => `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${s}`;
  if (n >= 1e6) return fmt(n / 1e6, 'M');
  if (n >= 1e3) return fmt(n / 1e3, 'K');
  return String(n);
}
