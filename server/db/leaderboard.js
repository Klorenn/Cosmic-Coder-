/**
 * Leaderboard persistence in Supabase.
 * Table: cosmic_coder_leaderboard (address, name, score, wave, games_played, updated_at)
 * Fallback to in-memory is handled in server/index.js.
 */

import { getSupabase } from './supabase.js';

export const LEADERBOARD_TABLE = 'cosmic_coder_leaderboard';
const MAX_ENTRIES = 50;

function leaderboardSort(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.wave !== a.wave) return b.wave - a.wave;
  return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
}

/**
 * Fetch top leaderboard entries from Supabase, ordered by score DESC, wave DESC.
 * @param {number} limit
 * @returns {Promise<Array<{ address: string, name: string, score: number, wave: number, games_played: number, updated_at: string }>>}
 */
export async function fetchLeaderboard(limit = 15) {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from(LEADERBOARD_TABLE)
      .select('address, name, score, wave, games_played, updated_at')
      .order('score', { ascending: false })
      .order('wave', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[Leaderboard] Supabase fetch error:', error.message);
      return null;
    }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[Leaderboard] Supabase fetch exception:', e?.message || e);
    return null;
  }
}

/**
 * Upsert one leaderboard entry by address. Only update score/wave if new run is better; always allow name update.
 * @param {{ address: string, name: string, wave: number, score: number, games_played?: number }} entry
 * @returns {Promise<boolean>}
 */
export async function upsertLeaderboardEntry(entry) {
  const supabase = getSupabase();
  if (!supabase) return false;
  const address = String(entry.address || '').trim().slice(0, 56);
  if (!address) return false;
  const name = (entry.name != null ? String(entry.name) : '').trim().slice(0, 64);
  const score = Math.max(0, Math.floor(Number(entry.score) || 0));
  const wave = Math.max(0, Math.floor(Number(entry.wave) || 0));
  const games_played = Math.max(0, Math.floor(Number(entry.games_played) || 0));

  try {
    const { data: existing } = await supabase
      .from(LEADERBOARD_TABLE)
      .select('id, score, wave, name, games_played')
      .eq('address', address)
      .maybeSingle();

    const isBetter = !existing || score > (existing.score ?? 0) || (score === (existing.score ?? 0) && wave > (existing.wave ?? 0));
    const newScore = isBetter ? score : (existing?.score ?? 0);
    const newWave = isBetter ? wave : (existing?.wave ?? 0);
    const finalName = (name || existing?.name || '').trim().slice(0, 64);
    const newGamesPlayed = isBetter ? games_played : (existing?.games_played ?? 0);

    if (existing && existing.id) {
      const { error } = await supabase
        .from(LEADERBOARD_TABLE)
        .update({
          name: finalName,
          score: newScore,
          wave: newWave,
          games_played: newGamesPlayed,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      if (error) {
        console.warn('[Leaderboard] Supabase update error:', error.message);
        return false;
      }
    } else {
      const { error } = await supabase
        .from(LEADERBOARD_TABLE)
        .insert({
          address,
          name: finalName,
          score: newScore,
          wave: newWave,
          games_played: newGamesPlayed,
          updated_at: new Date().toISOString()
        });
      if (error) {
        console.warn('[Leaderboard] Supabase insert error:', error.message);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn('[Leaderboard] Supabase upsert exception:', e?.message || e);
    return false;
  }
}
