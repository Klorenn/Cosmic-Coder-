/**
 * PostgreSQL connection pool for Cosmic Coder backend.
 * Set DATABASE_URL in production (e.g. Render). If unset, auth will use in-memory fallback.
 */

import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const isLocal = url.includes('localhost');
  pool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000
  });
  return pool;
}

export async function query(sql, params = []) {
  const p = getPool();
  if (!p) return { rows: [] };
  const client = await p.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}
