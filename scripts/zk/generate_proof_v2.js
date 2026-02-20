#!/usr/bin/env node
/**
 * Generate a real Groth16 proof from GameRunV2 circuit + input.json, then export for contract.
 * Usage: node generate_proof_v2.js [path/to/input.json] [path/to/circuits/build]
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exportAll } from './export_for_contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CIRCUITS = path.join(ROOT, 'circuits');
const BUILD = path.join(CIRCUITS, 'build');
const CIRCUIT_NAME = 'GameRunV2';

const inputPath = process.argv[2] || path.join(CIRCUITS, 'input.json');
const buildDir = process.argv[3] || BUILD;
const wasmDir = path.join(buildDir, `${CIRCUIT_NAME}_js`, `${CIRCUIT_NAME}_js`);
const zkeyPath = path.join(buildDir, `${CIRCUIT_NAME}_js`, `${CIRCUIT_NAME}.zkey`);

if (!fs.existsSync(path.join(buildDir, `${CIRCUIT_NAME}_js`, `${CIRCUIT_NAME}.r1cs`))) {
  console.error('Run build_GameRunV2.sh first.');
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error('Create input.json (see circuits/input.json.example).');
  process.exit(1);
}

// Copy input to build dir for snarkjs
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
fs.writeFileSync(path.join(buildDir, 'input.json'), JSON.stringify(input, null, 2));

console.log('Running snarkjs fullprove for GameRunV2...');
execSync(
  `cd "${buildDir}" && snarkjs groth16 fullprove input.json ${CIRCUIT_NAME}_js/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm ${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.zkey proof.json public.json`,
  { stdio: 'inherit' }
);

console.log('Exporting for contract...');
const outPath = path.join(buildDir, 'contract_proof.json');
exportAll(buildDir, outPath);
console.log('Done. Contract-ready proof:', outPath);
