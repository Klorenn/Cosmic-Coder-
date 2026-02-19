/**
 * Supabase client para Cosmic Coder (tabla cosmic_coder_users).
 * Usa SUPABASE_URL + SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client = null;

export function getSupabase() {
  if (client) return client;
  const key = serviceKey || anonKey;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
}

export const USERS_TABLE = 'cosmic_coder_users';
