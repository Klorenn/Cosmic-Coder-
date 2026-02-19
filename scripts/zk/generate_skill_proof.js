#!/usr/bin/env node
/**
 * Generate a Groth16 proof from SkillProof circuit + input.json, then export for contract.
 * Usage: node generate_skill_proof.js [path/to/input.json] [path/to/circuits/build]
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

// Export skill proof with custom file names
const proofJson = JSON.parse(fs.readFileSync(path.join(buildDir, 'skill_proof.json'), 'utf8'));
const publicJson = JSON.parse(fs.readFileSync(path.join(buildDir, 'skill_public.json'), 'utf8'));
const vkeyJson = JSON.parse(fs.readFileSync(path.join(buildDir, 'SkillProof_vkey.json'), 'utf8'));

const payload = {
  proof: {
    a: proofJson.pi_a.slice(0, 2),
    b: [
      [proofJson.pi_b[0][1], proofJson.pi_b[0][0]],
      [proofJson.pi_b[1][1], proofJson.pi_b[1][0]]
    ],
    c: proofJson.pi_c.slice(0, 2)
  },
  vk: {
    alpha: vkeyJson.vk_alpha_1.slice(0, 2),
    beta: [
      [vkeyJson.vk_beta_2[0][1], vkeyJson.vk_beta_2[0][0]],
      [vkeyJson.vk_beta_2[1][1], vkeyJson.vk_beta_2[1][0]]
    ],
    gamma: [
      [vkeyJson.vk_gamma_2[0][1], vkeyJson.vk_gamma_2[0][0]],
      [vkeyJson.vk_gamma_2[1][1], vkeyJson.vk_gamma_2[1][0]]
    ],
    delta: [
      [vkeyJson.vk_delta_2[0][1], vkeyJson.vk_delta_2[0][0]],
      [vkeyJson.vk_delta_2[1][1], vkeyJson.vk_delta_2[1][0]]
    ],
    ic: vkeyJson.IC.map((ic) => ic.slice(0, 2))
  },
  pub_signals: publicJson
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log('Done. Contract-ready skill proof:', outPath);
