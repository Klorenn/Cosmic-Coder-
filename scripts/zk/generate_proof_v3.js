#!/usr/bin/env node
/**
 * Prove a GameRunV3 input with the committed artifacts, verify it, export it for the contract.
 * Usage: node scripts/zk/generate_proof_v3.js [input.json] [out.json]
 *   input  default circuits/fixtures/gamerun_v3.input.json
 *   out    default circuits/build/contract_proof_v3.json (the VK the deploy script pins with set_run_vk)
 * Also writes <out>.snarkjs.json with the raw { proof, publicSignals }.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as snarkjs from 'snarkjs';
import { toContractFormat } from './export_for_contract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const B = path.join(ROOT, 'circuits', 'build');
const inputPath = process.argv[2] || path.join(ROOT, 'circuits', 'fixtures', 'gamerun_v3.input.json');
const outPath = process.argv[3] || path.join(B, 'contract_proof_v3.json');
const wasm = path.join(B, 'GameRunV3_js', 'GameRunV3.wasm');
const zkey = path.join(B, 'GameRunV3_final.zkey');
const vkeyPath = path.join(B, 'GameRunV3_vkey.json');

for (const f of [wasm, zkey, vkeyPath, inputPath]) {
  if (!fs.existsSync(f)) {
    console.error(`Missing ${path.relative(ROOT, f)}. Run bash scripts/zk/build_GameRunV3.sh first.`);
    process.exit(1);
  }
}

const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
const vk = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
if (!(await snarkjs.groth16.verify(vk, publicSignals, proof))) {
  console.error('GameRunV3 proof failed verification');
  process.exit(1);
}
fs.writeFileSync(outPath, JSON.stringify(toContractFormat(proof, vk, publicSignals), null, 2));
fs.writeFileSync(outPath.replace(/\.json$/, '.snarkjs.json'), JSON.stringify({ proof, publicSignals }, null, 2));
console.log('GameRunV3 proof verified. publicSignals:', publicSignals.join(', '));
console.log('Written', outPath);
process.exit(0);
