#!/usr/bin/env node
/**
 * Generate a Groth16 proof from SkillProof circuit + input.json, then export for contract.
 * Usage: node generate_skill_proof.js [path/to/input.json] [path/to/circuits/build]
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exportProof, exportVk, exportPubSignals } from './export_for_contract.js';

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

console.log('Exporting for contract...');
const outPath = path.join(buildDir, 'skill_contract_proof.json');

// Contract-ready hex (same encoding as export_for_contract.js / contract_proof.json):
// G1 = x||y, G2 = x_c1||x_c0||y_c1||y_c0, public signals = 32-byte big-endian. The client
// (buildUnlockWeaponArgs) also accepts the old decimal layout for older provers.
const proof = exportProof(path.join(buildDir, 'skill_proof.json'));
const vk = exportVk(path.join(buildDir, 'SkillProof_vkey.json'));
const pub = exportPubSignals(path.join(buildDir, 'skill_public.json'));
const payload = {
  proof: { a: proof.a.toString('hex'), b: proof.b.toString('hex'), c: proof.c.toString('hex') },
  vk: {
    alpha: vk.alpha.toString('hex'),
    beta: vk.beta.toString('hex'),
    gamma: vk.gamma.toString('hex'),
    delta: vk.delta.toString('hex'),
    ic: vk.ic.map((b) => b.toString('hex'))
  },
  pub_signals: pub.map((b) => b.toString('hex'))
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log('Done. Contract-ready skill proof:', outPath);
