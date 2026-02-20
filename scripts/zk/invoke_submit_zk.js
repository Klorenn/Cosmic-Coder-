#!/usr/bin/env node
/**
 * Invoke submit_zk on the shadow_ascension contract with the generated proof.
 * Usage: node invoke_submit_zk.js [contract_proof.json] [policy_contract_id]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const proofPath = process.argv[2] || path.join(ROOT, 'circuits/build/contract_proof.json');
const contractId = process.argv[3] || process.env.POLICY_CONTRACT_ID;
const network = process.argv[4] || 'testnet';
const source = process.argv[5] || 'testnet-user';

if (!contractId) {
  console.error('Usage: node invoke_submit_zk.js [contract_proof.json] <policy_contract_id> [network] [source]');
  console.error('Or set POLICY_CONTRACT_ID env var');
  process.exit(1);
}

const json = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
const { proof, vk, pub_signals } = json;

// Get player address from source account
let playerAddress;
try {
  playerAddress = execSync(`stellar keys address ${source}`, { encoding: 'utf8' }).trim();
} catch (e) {
  console.error('Could not get player address for source:', source);
  process.exit(1);
}

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

// Extract values from public signals (they're 32-byte BE hex encoded)
// pub_signals order: [run_hash_hi, run_hash_lo, score, wave, nonce, season_id]
const runHashHi = pub_signals[0];
const runHashLo = pub_signals[1];
const score = parseInt(pub_signals[2], 16);  // 0x64 = 100
const wave = parseInt(pub_signals[3], 16);   // 0x05 = 5
const nonce = parseInt(pub_signals[4], 16);  // 0x01 = 1
const seasonId = parseInt(pub_signals[5], 16); // 0x01 = 1

// run_hash is the combination of hi and lo (use lo as the hash for simplicity)
const runHash = runHashLo;

console.log('=== Invoking submit_zk on shadow_ascension ===');
console.log(`Contract: ${contractId}`);
console.log(`Network: ${network}`);
console.log(`Source: ${source}`);
console.log(`Player: ${playerAddress}`);
console.log(`Score: ${score}, Wave: ${wave}, Nonce: ${nonce}, Season: ${seasonId}`);
console.log('');

// Build and execute the command
const cmd = `stellar contract invoke \
  --id ${contractId} \
  --source-account ${source} \
  --network ${network} \
  -- \
  submit_zk \
  --player ${playerAddress} \
  --proof '${JSON.stringify(proofArg)}' \
  --vk '${JSON.stringify(vkArg)}' \
  --pub_signals '${JSON.stringify(pub_signals)}' \
  --nonce ${nonce} \
  --run_hash ${runHash} \
  --season_id ${seasonId} \
  --score ${score} \
  --wave ${wave}`;

console.log('Executing...');
try {
  const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  console.log('Result:', result.trim() || '(void - success)');
  console.log('\n✅ ZK PROOF SUBMITTED AND VERIFIED ON-CHAIN!');
  console.log(`Player ${playerAddress} score ${score} recorded on leaderboard.`);
} catch (err) {
  console.error('Error:', err.message);
  if (err.stderr) console.error(err.stderr);
  if (err.stdout) console.error(err.stdout);
  process.exit(1);
}
