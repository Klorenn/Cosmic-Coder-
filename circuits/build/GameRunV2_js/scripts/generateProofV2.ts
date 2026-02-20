#!/usr/bin/env ts-node
// generateProofV2.ts: Generate Groth16 proof for GameRunV2.circom
// Usage: ./generateProofV2.ts <run_hash_hi_hex> <run_hash_lo_hex> <score> <wave> <nonce> <season_id> <challenge_id> <player_address_hex> <contract_id_hex> <domain_separator_hex>
// Outputs: proof.json, public_inputs.json

import fs from 'fs';
import path from 'path';
import { snarkjs } from 'snarkjs';

const WASM_PATH = path.join(__dirname, '../../build/GameRunV2_js/GameRunV2.wasm');
const ZKEY_PATH = path.join(__dirname, '../../build/GameRunV2_js/GameRunV2.zkey');

function parseHex32(str: string): string {
  // Ensure 32-byte hex string (64 chars), pad if needed
  let s = str.replace(/^0x/, '');
  if (s.length < 64) s = s.padStart(64, '0');
  if (s.length > 64) s = s.slice(-64);
  return s;
}

function parseU64(str: string): string {
  const n = BigInt(str);
  return n.toString();
}

function parseU32(str: string): string {
  const n = Number(str);
  return n.toString();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 10) {
    console.error('Usage: generateProofV2.ts <run_hash_hi_hex> <run_hash_lo_hex> <score> <wave> <nonce> <season_id> <challenge_id> <player_address_hex> <contract_id_hex> <domain_separator_hex>');
    process.exit(1);
  }

  const [
    run_hash_hi_hex,
    run_hash_lo_hex,
    score_str,
    wave_str,
    nonce_str,
    season_id_str,
    challenge_id_str,
    player_address_hex,
    contract_id_hex,
    domain_separator_hex,
  ] = args;

  const input = {
    run_hash_hi: parseHex32(run_hash_hi_hex),
    run_hash_lo: parseHex32(run_hash_lo_hex),
    score: parseU32(score_str),
    wave: parseU32(wave_str),
    nonce: parseU64(nonce_str),
    season_id: parseU32(season_id_str),
    challenge_id: parseU32(challenge_id_str),
    player_address: parseHex32(player_address_hex),
    contract_id: parseHex32(contract_id_hex),
    domain_separator: parseHex32(domain_separator_hex),
  };

  console.log('[+] Generating witness...');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);

  // Map publicSignals to ZkPublicInputs order (should match circuit outputs)
  const publicInputs = {
    run_hash_hi: publicSignals[0],
    run_hash_lo: publicSignals[1],
    score: publicSignals[2],
    wave: publicSignals[3],
    nonce: publicSignals[4],
    season_id: publicSignals[5],
    challenge_id: publicSignals[6],
    player_address: publicSignals[7],
    contract_id: publicSignals[8],
    domain_separator: publicSignals[9],
  };

  const outDir = path.join(__dirname, '../../build/GameRunV2_js');
  fs.writeFileSync(path.join(outDir, 'proof.json'), JSON.stringify(proof, null, 2));
  fs.writeFileSync(path.join(outDir, 'public_inputs.json'), JSON.stringify(publicInputs, null, 2));

  console.log('[+] Proof written to', path.join(outDir, 'proof.json'));
  console.log('[+] Public inputs written to', path.join(outDir, 'public_inputs.json'));
  console.log('[+] Public signals:', publicSignals);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
