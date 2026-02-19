#!/usr/bin/env node
/**
 * Calculate Poseidon hash for skill proof inputs
 * Usage: node calculate_poseidon.js <wallet> <score> <nonce>
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BUILD_DIR = path.join(ROOT, 'circuits', 'build');

const wallet = process.argv[2] || '0';
const score = process.argv[3] || '0';
const nonce = process.argv[4] || '0';

// Create a simple circuit input for calculating the hash
const input = {
  score: String(score),
  wallet: String(wallet),
  nonce: String(nonce),
  threshold: '0',
  publicHash: '0'
};

const inputPath = path.join(BUILD_DIR, 'poseidon_input.json');
fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));

// Generate witness
execSync(
  `cd "${BUILD_DIR}" && snarkjs wtns calculate SkillProof_js/SkillProof.wasm poseidon_input.json poseidon_witness.wtns`,
  { stdio: 'pipe' }
);

// Export public signals
execSync(
  `cd "${BUILD_DIR}" && snarkjs wtns export json poseidon_witness.wtns poseidon_public.json`,
  { stdio: 'pipe' }
);

const publicSignals = JSON.parse(fs.readFileSync(path.join(BUILD_DIR, 'poseidon_public.json'), 'utf8'));

// publicSignals[0] = threshold, publicSignals[1] = publicHash
console.log('Public Hash:', publicSignals[1]);
