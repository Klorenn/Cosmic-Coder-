/**
 * Player progress persistence in Supabase.
 * Table: cosmic_coder_progress (address PK, high_score, high_wave, upgrades, legendaries, save_state, selected_character, updated_at)
 */

import { getSupabase } from './supabase.js';

export const PROGRESS_TABLE = 'cosmic_coder_progress';
const VALID_CHARS = ['vibecoder', 'destroyer', 'swordsman'];

/**
 * @param {string} address
 * @returns {Promise<{ upgrades: object, legendaries: object, highWave: number, highScore: number, saveState: object, selectedCharacter: string } | null>}
 */
export async function fetchProgress(address) {
  const supabase = getSupabase();
  if (!supabase) return null;
  const addr = String(address || '').trim().slice(0, 56);
  if (!addr) return null;
  try {
    const { data, error } = await supabase
      .from(PROGRESS_TABLE)
      .select('high_score, high_wave, upgrades, legendaries, save_state, selected_character')
      .eq('address', addr)
      .maybeSingle();
    if (error) {
      console.warn('[Progress] Supabase fetch error:', error.message);
      return null;
    }
    if (!data) return null;
    const char = VALID_CHARS.includes(data.selected_character) ? data.selected_character : 'vibecoder';
    return {
      upgrades: data.upgrades && typeof data.upgrades === 'object' ? data.upgrades : null,
      legendaries: data.legendaries && typeof data.legendaries === 'object' ? data.legendaries : null,
      highWave: typeof data.high_wave === 'number' ? data.high_wave : 0,
      highScore: typeof data.high_score === 'number' ? data.high_score : 0,
      saveState: data.save_state && typeof data.save_state === 'object' ? data.save_state : null,
      selectedCharacter: char
    };
  } catch (e) {
    console.warn('[Progress] Supabase fetch exception:', e?.message || e);
    return null;
  }
}

/**
 * @param {string} address
 * @param {{ upgrades?: object, legendaries?: object, highWave?: number, highScore?: number, saveState?: object, selectedCharacter?: string }} data
 * @returns {Promise<boolean>}
 */
export async function saveProgress(address, data) {
  const supabase = getSupabase();
  if (!supabase) return false;
  const addr = String(address || '').trim().slice(0, 56);
  if (!addr) return false;
  const char = VALID_CHARS.includes(data.selectedCharacter) ? data.selectedCharacter : 'vibecoder';
  const payload = {
    address: addr,
    high_score: typeof data.highScore === 'number' ? Math.max(0, Math.floor(data.highScore)) : 0,
    high_wave: typeof data.highWave === 'number' ? Math.max(0, Math.floor(data.highWave)) : 0,
    upgrades: data.upgrades && typeof data.upgrades === 'object' ? data.upgrades : null,
    legendaries: data.legendaries && typeof data.legendaries === 'object' ? data.legendaries : null,
    save_state: data.saveState && typeof data.saveState === 'object' ? data.saveState : null,
    selected_character: char,
    updated_at: new Date().toISOString()
  };
  try {
    const { error } = await supabase
      .from(PROGRESS_TABLE)
      .upsert(payload, { onConflict: 'address' });
    if (error) {
      console.warn('[Progress] Supabase upsert error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[Progress] Supabase upsert exception:', e?.message || e);
    return false;
  }
}
