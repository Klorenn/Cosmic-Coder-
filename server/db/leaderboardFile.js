/**
 * File-based leaderboard fallback when Supabase is not configured.
 * Reads/writes server/data/leaderboard.json so rankings persist across server restarts (if disk is persistent).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'leaderboard.json');

function leaderboardSort(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.wave !== a.wave) return b.wave - a.wave;
  return (b.date || 0) - (a.date || 0);
}

/**
 * Load leaderboard entries from JSON file.
 * @returns {Array<{ address: string, name: string, wave: number, score: number, date: number }>}
 */
export function loadLeaderboardFromFile() {
  try {
    if (!fs.existsSync(FILE_PATH)) return [];
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return entries
      .filter((e) => e && (e.address || e.name) && typeof (e.score ?? e.wave) === 'number')
      .map((e) => ({
        address: String(e.address || '').slice(0, 56),
        name: (e.name != null ? String(e.name) : '').trim().slice(0, 64),
        wave: Math.max(0, Math.floor(Number(e.wave) || 0)),
        score: Math.max(0, Math.floor(Number(e.score) || 0)),
        date: typeof e.date === 'number' ? e.date : Date.now()
      }))
      .sort(leaderboardSort);
  } catch (e) {
    console.warn('[Leaderboard] File load failed:', e?.message || e);
    return [];
  }
}

/**
 * Save leaderboard entries to JSON file.
 * @param {Array<{ address: string, name: string, wave: number, score: number, date?: number }>} entries
 */
export function saveLeaderboardToFile(entries) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const data = { entries: entries || [], updatedAt: Date.now() };
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 0), 'utf8');
  } catch (e) {
    console.warn('[Leaderboard] File save failed:', e?.message || e);
  }
}
