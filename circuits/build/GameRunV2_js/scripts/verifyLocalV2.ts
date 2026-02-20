#!/usr/bin/env ts-node
// verifyLocalV2.ts: Verify a GameRunV2 proof locally using verification key
// Usage: ./verifyLocalV2.ts

import fs from 'fs';
import path from 'path';
import { snarkjs } from 'snarkjs';

const VKEY_PATH = path.join(__dirname, '../../build/GameRunV2_js/GameRunV2.vkey');
const PROOF_PATH = path.join(__dirname, '../../build/GameRunV2_js/proof.json');
const PUBLIC_INPUTS_PATH = path.join(__dirname, '../../build/GameRunV2_js/public_inputs.json');

async function main() {
  if (!fs.existsSync(VKEY_PATH) || !fs.existsSync(PROOF_PATH) || !fs.existsSync(PUBLIC_INPUTS_PATH)) {
    console.error('[-] Missing artifacts. Run generateProofV2.ts first.');
    process.exit(1);
  }

  const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
  const proof = JSON.parse(fs.readFileSync(PROOF_PATH, 'utf8'));
  const publicInputs = JSON.parse(fs.readFileSync(PUBLIC_INPUTS_PATH, 'utf8'));

  // Reorder public inputs as flat array (order must match circuit outputs)
  const publicSignals = [
    publicInputs.run_hash_hi,
    publicInputs.run_hash_lo,
    publicInputs.score,
    publicInputs.wave,
    publicInputs.nonce,
    publicInputs.season_id,
    publicInputs.challenge_id,
    publicInputs.player_address,
    publicInputs.contract_id,
    publicInputs.domain_separator,
  ];

  console.log('[+] Verifying proof locally...');
  const ok = await snarkjs.groth16.verify(vKey, publicSignals, proof);
  if (ok) {
    console.log('[+] Proof is valid.');
  } else {
    console.error('[-] Proof is INVALID.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
