#!/usr/bin/env node
/**
 * Generate + verify a Groth16 proof from SkillProof circuit + input.json, then export for contract
 * (circuits/build/contract_proof_skill.json).
 * Usage: node generate_skill_proof.js [path/to/input.json] [path/to/circuits/build]
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toContractFormat } from './export_for_contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CIRCUITS = path.join(ROOT, 'circuits');
const BUILD = path.join(CIRCUITS, 'build');
const CIRCUIT_NAME = 'SkillProof';

const inputPath = process.argv[2] || path.join(CIRCUITS, 'skill_input.json');
const buildDir = process.argv[3] || BUILD;
const wasmDir = path.join(buildDir, `${CIRCUIT_NAME}_js`);
const zkeyPath = path.join(buildDir, `${CIRCUIT_NAME}_final.zkey`);

if (!fs.existsSync(path.join(buildDir, `${CIRCUIT_NAME}.r1cs`))) {
  console.error('Run build_circuit.sh first.');
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error('Create skill_input.json first.');
  process.exit(1);
}

// Copy input to build dir for snarkjs
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
fs.writeFileSync(path.join(buildDir, 'skill_input.json'), JSON.stringify(input, null, 2));

console.log('Running snarkjs fullprove for SkillProof...');
execSync(
  `cd "${buildDir}" && snarkjs groth16 fullprove skill_input.json ${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm ${CIRCUIT_NAME}_final.zkey skill_proof.json skill_public.json`,
  { stdio: 'inherit' }
);

console.log('Verifying with snarkjs...');
execSync(
  `cd "${buildDir}" && snarkjs groth16 verify ${CIRCUIT_NAME}_vkey.json skill_public.json skill_proof.json`,
  { stdio: 'inherit' }
);

// Contract-ready hex via export_for_contract.js: G1 = x||y, G2 = x_c1||x_c0||y_c1||y_c0,
// pub_signals = [threshold, publicHash] as 32-byte big-endian (order checked by unlock_weapon).
const read = (f) => JSON.parse(fs.readFileSync(path.join(buildDir, f), 'utf8'));
const payload = toContractFormat(read('skill_proof.json'), read(`${CIRCUIT_NAME}_vkey.json`), read('skill_public.json'));
const outPath = path.join(buildDir, 'contract_proof_skill.json');
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log('Done. Contract-ready skill proof:', outPath);
