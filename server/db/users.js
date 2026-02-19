/**
 * User persistence: public_key + username.
 * Prefer Supabase (SUPABASE_URL + key); else PostgreSQL (DATABASE_URL); else in-memory.
 */

import { getPool, query } from './pool.js';
import { getSupabase, USERS_TABLE } from './supabase.js';

const memoryStore = new Map();

function toIso(ts) {
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === 'number') return new Date(ts).toISOString();
  return ts;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    public_key: row.public_key,
    username: row.username,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
}

export async function findUserByPublicKey(publicKey) {
  const key = String(publicKey).trim().slice(0, 56);
  if (!key) return null;

  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from(USERS_TABLE)
      .select('id, public_key, username, created_at, updated_at')
      .eq('public_key', key)
      .maybeSingle();
    if (error) return null;
    return rowToUser(data);
  }

  const p = getPool();
  if (p) {
    const res = await query('SELECT id, public_key, username, created_at, updated_at FROM users WHERE public_key = $1', [key]);
    return rowToUser(res?.rows?.[0]);
  }

  const u = memoryStore.get(key);
  return u ? { ...u } : null;
}

export async function upsertUser(publicKey) {
  const key = String(publicKey).trim().slice(0, 56);
  if (!key) return null;

  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase
      .from(USERS_TABLE)
      .upsert(
        { public_key: key, updated_at: new Date().toISOString() },
        { onConflict: 'public_key' }
      );
    if (error) return null;
    return findUserByPublicKey(key);
  }

  const p = getPool();
  if (p) {
    await query(
      `INSERT INTO users (public_key) VALUES ($1)
       ON CONFLICT (public_key) DO UPDATE SET updated_at = now()
       RETURNING id, public_key, username, created_at, updated_at`,
      [key]
    );
    return findUserByPublicKey(key);
  }

  let u = memoryStore.get(key);
  if (!u) {
    u = {
      id: `mem-${key.slice(0, 8)}`,
      public_key: key,
      username: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memoryStore.set(key, u);
  } else {
    u.updated_at = new Date().toISOString();
  }
  return { ...u };
}

export async function updateUsername(publicKey, username) {
  const key = String(publicKey).trim().slice(0, 56);
  const name = username == null ? null : String(username).trim().slice(0, 64);
  if (!key) return null;

  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase
      .from(USERS_TABLE)
      .update({ username: name || null, updated_at: new Date().toISOString() })
      .eq('public_key', key);
    if (error) return null;
    return findUserByPublicKey(key);
  }

  const p = getPool();
  if (p) {
    await query(
      'UPDATE users SET username = $1, updated_at = now() WHERE public_key = $2',
      [name || null, key]
    );
    return findUserByPublicKey(key);
  }

  const u = memoryStore.get(key);
  if (!u) return null;
  u.username = name || null;
  u.updated_at = new Date().toISOString();
  return { ...u };
}
