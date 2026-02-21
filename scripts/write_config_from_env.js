#!/usr/bin/env node
/**
 * Write public/config.json from current env + existing config.
 * Used in CI/deploy: set env from secrets, run this, then build.
 * All paths are relative to project root (run from repo root).
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public');
const configPath = join(publicDir, 'config.json');
const examplePath = join(publicDir, 'config.json.example');

const CONFIG_KEYS = [
  'VITE_COSMIC_CODER_CONTRACT_ID',
  'VITE_GAME_HUB_CONTRACT_ID',
  'VITE_ZK_PROVER_URL',
  'VITE_PROGRESS_API_URL',
  'VITE_LEADERBOARD_URL',
  'VITE_API_URL'
];

let base = {};
try {
  base = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {
  try {
    base = JSON.parse(readFileSync(examplePath, 'utf8'));
  } catch {
    // no existing config
  }
}

const out = { ...base };
for (const key of CONFIG_KEYS) {
  const v = process.env[key];
  if (v !== undefined && v !== '') out[key] = String(v).trim();
}

writeFileSync(configPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('[write_config_from_env] wrote', configPath);
