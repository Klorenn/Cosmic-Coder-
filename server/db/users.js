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

/**
 * Store the JWT issued after the user signs the SEP-10 challenge (proof they control the wallet).
 * Used for audit / session record; the client also keeps the JWT in localStorage.
 */
export async function setUserToken(publicKey, token, expiresAt) {
  const key = String(publicKey).trim().slice(0, 56);
  if (!key || !token) return;

  const expiresAtIso = expiresAt instanceof Date ? expiresAt.toISOString() : (expiresAt ? new Date(expiresAt).toISOString() : null);
  const updatedAt = new Date().toISOString();

  const supabase = getSupabase();
  if (supabase) {
    // First try UPDATE by public_key
    const { data: updated, error: updateError } = await supabase
      .from(USERS_TABLE)
      .update({ current_jwt: token, jwt_expires_at: expiresAtIso, updated_at: updatedAt })
      .eq('public_key', key)
      .select('id');
    if (updateError) {
      console.error('[db] setUserToken update failed:', updateError.message);
      return;
    }
    // If no row matched (RLS or row missing), upsert so the JWT is stored
    if (!updated || updated.length === 0) {
      const { error: upsertError } = await supabase
        .from(USERS_TABLE)
        .upsert(
          { public_key: key, current_jwt: token, jwt_expires_at: expiresAtIso, updated_at: updatedAt },
          { onConflict: 'public_key' }
        );
      if (upsertError) {
        console.error('[db] setUserToken upsert fallback failed:', upsertError.message);
      }
    }
    return;
  }

  const p = getPool();
  if (p) {
    await query(
      'UPDATE users SET current_jwt = $1, jwt_expires_at = $2, updated_at = now() WHERE public_key = $3',
      [token, expiresAtIso, key]
    );
    return;
  }

  const u = memoryStore.get(key);
  if (u) {
    u.current_jwt = token;
    u.jwt_expires_at = expiresAtIso;
    u.updated_at = new Date().toISOString();
  }
}
