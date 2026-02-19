#!/usr/bin/env node
/**
 * Run server/db/schema.sql against DATABASE_URL.
 * Uso: DATABASE_URL="postgresql://..." node scripts/run_db_schema.js
 * En Render: usa la Internal Database URL en el backend; ejecuta este script una vez (local con DATABASE_URL o en un job).
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, '..', 'server', 'db', 'schema.sql');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Uso: DATABASE_URL="postgresql://..." node scripts/run_db_schema.js');
  process.exit(1);
}

const sql = readFileSync(schemaPath, 'utf8');

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: true }
});
try {
  await client.connect();
  await client.query(sql);
  console.log('Schema aplicado correctamente (users + trigger).');
} catch (err) {
  console.error('Error aplicando schema:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
