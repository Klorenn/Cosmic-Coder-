#!/usr/bin/env node
/**
 * Generate stellar CLI command to invoke verify_proof on the groth16_verifier contract.
 * Usage: node invoke_verify.js [contract_proof.json] [verifier_contract_id]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const proofPath = process.argv[2] || path.join(ROOT, 'circuits/build/contract_proof.json');
const contractId = process.argv[3] || process.env.VERIFIER_CONTRACT_ID;
const network = process.argv[4] || 'testnet';
const source = process.argv[5] || 'testnet-user';

if (!contractId) {
  console.error('Usage: node invoke_verify.js [contract_proof.json] <verifier_contract_id> [network] [source]');
  console.error('Or set VERIFIER_CONTRACT_ID env var');
  process.exit(1);
}

const json = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
const { proof, vk, pub_signals } = json;

// Build the JSON arguments for stellar CLI (using hex format for bytes)
const vkArg = {
  alpha: vk.alpha,
  beta: vk.beta,
  gamma: vk.gamma,
  delta: vk.delta,
  ic: vk.ic
};

const proofArg = {
  a: proof.a,
  b: proof.b,
  c: proof.c
};

// pub_signals as array of hex strings
const pubSignalsArg = pub_signals;

console.log('=== Invoking verify_proof on groth16_verifier ===');
console.log(`Contract: ${contractId}`);
console.log(`Network: ${network}`);
console.log(`Source: ${source}`);
console.log(`Public signals: ${pub_signals.length} elements`);
console.log('');

// Build and execute the command
const cmd = `stellar contract invoke \
  --id ${contractId} \
  --source-account ${source} \
  --network ${network} \
  -- \
  verify_proof \
  --vk '${JSON.stringify(vkArg)}' \
  --proof '${JSON.stringify(proofArg)}' \
  --pub_signals '${JSON.stringify(pubSignalsArg)}'`;

console.log('Command:');
console.log(cmd);
console.log('');
console.log('Executing...');
try {
  const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  console.log('Result:', result.trim());
  if (result.includes('true')) {
    console.log('\n✅ ZK PROOF VERIFIED SUCCESSFULLY ON-CHAIN!');
  } else {
    console.log('\n❌ Proof verification returned false');
  }
} catch (err) {
  console.error('Error:', err.message);
  if (err.stderr) console.error(err.stderr);
  if (err.stdout) console.error(err.stdout);
  process.exit(1);
}
