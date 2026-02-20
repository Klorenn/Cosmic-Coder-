#!/usr/bin/env node
/**
 * One-time setup: call set_vk on the UltraHonk verifier contract with GameRun_vk.json.
 * Required after deploying the verifier so submit_zk_noir (which uses verify_proof_with_stored_vk) works.
 *
 * Usage:
 *   ZK_VERIFIER_CONTRACT_ID=<verifier_id> node scripts/zk/set_verifier_vk.js
 *   node scripts/zk/set_verifier_vk.js <verifier_id>
 *
 * Verifier ID is the contract you passed to Cosmic Coder init as --zk_verifier
 * (e.g. CASQNBAV6ZX2DXVUIF2FHBAX3LFKTRNQ7PZ4IRPZOBXK2276KKZ3LV2Y).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const verifierId = process.argv[2] || process.env.ZK_VERIFIER_CONTRACT_ID;
const vkPath = path.join(ROOT, 'public/circuits/GameRun_vk.json');

if (!verifierId) {
  console.error('Usage: node set_verifier_vk.js <verifier_contract_id>');
  console.error('Or set ZK_VERIFIER_CONTRACT_ID');
  process.exit(1);
}

if (!fs.existsSync(vkPath)) {
  console.error('VK file not found:', vkPath);
  process.exit(1);
}

const vkJson = fs.readFileSync(vkPath, 'utf8');
const vkBytes = new TextEncoder().encode(vkJson);
const vkBase64 = Buffer.from(vkBytes).toString('base64');

console.log('=== Set VK on UltraHonk verifier (one-time) ===');
console.log('Verifier:', verifierId);
console.log('VK size:', vkBytes.length, 'bytes');
console.log('');
console.log('Run this (Stellar CLI):');
console.log('');
console.log(`stellar contract invoke --id ${verifierId} --source testnet-user --network testnet -- set_vk --vk_json ${vkBase64}`);
console.log('');
console.log('Or with VK from file (if your CLI supports it):');
console.log(`stellar contract invoke --id ${verifierId} --source testnet-user --network testnet -- set_vk --vk_json "$(cat ${vkPath} | base64)"`);
console.log('');
console.log('After this, submit_zk_noir will use verify_proof_with_stored_vk(proof_blob) only.');
