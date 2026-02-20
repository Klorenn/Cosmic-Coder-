#!/usr/bin/env ts-node
// test_negative_v2.ts: Negative-path tests for GameRunV2 ZK v2
// Simulate tampered proofs, replay, mismatched domain, etc.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as snarkjs from 'snarkjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VKEY_PATH = path.join(__dirname, '../GameRunV2.vkey');
const PROOF_PATH = path.join(__dirname, '../proof.json');
const PUBLIC_INPUTS_PATH = path.join(__dirname, '../public.json');

function loadArtifacts() {
  if (!fs.existsSync(VKEY_PATH) || !fs.existsSync(PROOF_PATH) || !fs.existsSync(PUBLIC_INPUTS_PATH)) {
    console.error('[-] Missing artifacts. Run generateProofV2.ts first.');
    process.exit(1);
  }
  const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
  const proof = JSON.parse(fs.readFileSync(PROOF_PATH, 'utf8'));
  const publicInputs = JSON.parse(fs.readFileSync(PUBLIC_INPUTS_PATH, 'utf8'));
  return { vKey, proof, publicInputs };
}

function publicSignalsFromInputs(publicInputs: any): string[] {
  return [
    publicInputs[0], // run_hash_hi
    publicInputs[1], // run_hash_lo
    publicInputs[2], // score
    publicInputs[3], // wave
    publicInputs[4], // nonce
    publicInputs[5], // season_id
    publicInputs[6], // challenge_id
    publicInputs[7], // player_address
    publicInputs[8], // contract_id
    publicInputs[9], // domain_separator
  ];
}

async function verify(name: string, vKey: any, publicSignals: string[], proof: any, expectValid: boolean) {
  const ok = await snarkjs.groth16.verify(vKey, publicSignals, proof);
  if (ok === expectValid) {
    console.log(`[+] ${name}: ${ok ? 'valid' : 'invalid'} (as expected)`);
  } else {
    console.error(`[-] ${name}: ${ok ? 'valid' : 'invalid'} (UNEXPECTED!)`);
    process.exit(1);
  }
}

async function main() {
  const { vKey, proof, publicInputs } = loadArtifacts();
  const baseSignals = publicSignalsFromInputs(publicInputs);
  console.log('[+] Loaded base proof and public inputs');

  // 1) Tampered proof: flip one bit in proof.pi_a
  const tamperedA = JSON.parse(JSON.stringify(proof));
  tamperedA.pi_a[0] = (parseInt(tamperedA.pi_a[0], 16) ^ 1).toString(16).padStart(64, '0');
  await verify('tampered_proof_a', vKey, baseSignals, tamperedA, false);

  // 2) Tampered proof: flip one bit in proof.pi_b
  const tamperedB = JSON.parse(JSON.stringify(proof));
  tamperedB.pi_b[0][0] = (parseInt(tamperedB.pi_b[0][0], 16) ^ 1).toString(16).padStart(64, '0');
  await verify('tampered_proof_b', vKey, baseSignals, tamperedB, false);

  // 3) Tampered proof: flip one bit in proof.pi_c
  const tamperedC = JSON.parse(JSON.stringify(proof));
  tamperedC.pi_c[0] = (parseInt(tamperedC.pi_c[0], 16) ^ 1).toString(16).padStart(64, '0');
  await verify('tampered_proof_c', vKey, baseSignals, tamperedC, false);

  // 4) Replay: same proof but different nonce (simulate replay)
  const replayInputs = [...publicInputs];
  replayInputs[4] = (parseInt(replayInputs[4], 10) + 1).toString();
  const replaySignals = publicSignalsFromInputs(replayInputs);
  await verify('replay_wrong_nonce', vKey, replaySignals, proof, false);

  // 5) Mismatched challenge_id
  const wrongChallengeInputs = [...publicInputs];
  wrongChallengeInputs[6] = (parseInt(wrongChallengeInputs[6], 10) + 1).toString();
  const wrongChallengeSignals = publicSignalsFromInputs(wrongChallengeInputs);
  await verify('wrong_challenge_id', vKey, wrongChallengeSignals, proof, false);

  // 6) Mismatched player_address
  const wrongPlayerInputs = [...publicInputs];
  wrongPlayerInputs[7] = (parseInt(wrongPlayerInputs[7], 16) ^ 1).toString(16).padStart(64, '0');
  const wrongPlayerSignals = publicSignalsFromInputs(wrongPlayerInputs);
  await verify('wrong_player_address', vKey, wrongPlayerSignals, proof, false);

  // 7) Mismatched contract_id
  const wrongContractInputs = [...publicInputs];
  wrongContractInputs[8] = (parseInt(wrongContractInputs[8], 16) ^ 1).toString(16).padStart(64, '0');
  const wrongContractSignals = publicSignalsFromInputs(wrongContractInputs);
  await verify('wrong_contract_id', vKey, wrongContractSignals, proof, false);

  // 8) Mismatched domain_separator
  const wrongDomainInputs = [...publicInputs];
  wrongDomainInputs[9] = (parseInt(wrongDomainInputs[9], 16) ^ 1).toString(16).padStart(64, '0');
  const wrongDomainSignals = publicSignalsFromInputs(wrongDomainInputs);
  await verify('wrong_domain_separator', vKey, wrongDomainSignals, proof, false);

  // 9) Invalid semantic: score < wave * 10 (should be caught by circuit, but test)
  // Note: This requires generating a new proof with invalid inputs; here we just test verification fails if we flip score in public inputs
  const invalidScoreInputs = [...publicInputs];
  invalidScoreInputs[2] = '0';
  const invalidScoreSignals = publicSignalsFromInputs(invalidScoreInputs);
  await verify('invalid_score', vKey, invalidScoreSignals, proof, false);

  console.log('[+] All negative tests passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
