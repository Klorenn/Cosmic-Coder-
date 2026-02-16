/**
 * Build Soroban invoke args from contract_proof.json for verify_proof and submit_zk.
 * Outputs JSON with hex/base64 for use by stellar CLI or frontend.
 */
import fs from 'fs';
import path from 'path';

const buildDir = process.argv[2] || path.join(process.cwd(), 'circuits/build');
const proofPath = path.join(buildDir, 'contract_proof.json');

if (!fs.existsSync(proofPath)) {
  console.error('Run generate_proof.js first to produce contract_proof.json');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(proofPath, 'utf8'));

// ScVal-friendly: bytes as hex (frontend can use xdr.ScVal.scvBytes(Buffer.from(hex, 'hex')))
const proof = {
  a: data.proof.a,
  b: data.proof.b,
  c: data.proof.c,
};
const vk = {
  alpha: data.vk.alpha,
  beta: data.vk.beta,
  gamma: data.vk.gamma,
  delta: data.vk.delta,
  ic: data.vk.ic,
};
const pub_signals = data.pub_signals;

console.log(JSON.stringify({
  verify_proof: { vk, proof, pub_signals },
  submit_zk: {
    proof,
    vk,
    pub_signals,
    run_hash_hex: pub_signals[0], // 32 bytes (64 hex chars); matches first public signal run_hash_hi
    score: parseInt(pub_signals[2], 16),
    wave: parseInt(pub_signals[3], 16),
    nonce: BigInt('0x' + pub_signals[4]).toString(),
    season_id: parseInt(pub_signals[5], 16),
  },
}, null, 2));
