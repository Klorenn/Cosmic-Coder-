/**
 * ZK proof generation for Cosmic Coder ranked submit.
 * Writes input.json from request, runs generate_proof.js, returns contract_proof.json content.
 * Requires: circuits built (npm run zk:build), snarkjs, circom in PATH.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'circuits', 'build');

/**
 * Build circuit input from prover request.
 * @param {{ run_hash_hex: string, score: number, wave: number, nonce: number, season_id: number }} body
 * run_hash_hex: 64 hex chars (32 bytes). Split into hi (first 16 bytes) and lo (last 16 bytes) as decimal strings.
 */
function buildInput(body) {
  const run_hash_hex = String(body.run_hash_hex || '').replace(/^0x/, '').padStart(64, '0').slice(0, 64);
  if (run_hash_hex.length !== 64) {
    throw new Error('run_hash_hex must be 64 hex chars (32 bytes)');
  }
  const run_hash_hi = BigInt('0x' + run_hash_hex.slice(0, 32)).toString();
  const run_hash_lo = BigInt('0x' + run_hash_hex.slice(32, 64)).toString();
  const score = Math.max(0, Math.floor(Number(body.score) || 0));
  const wave = Math.max(0, Math.floor(Number(body.wave) || 0));
  const nonce = BigInt(body.nonce != null ? body.nonce : 0).toString();
  const season_id = Math.max(0, Math.floor(Number(body.season_id) || 1));
  const used_zk_weapon = Number(body.used_zk_weapon) ? 1 : 0;
  return {
    run_hash_hi,
    run_hash_lo,
    score: String(score),
    wave: String(wave),
    nonce,
    season_id: String(season_id),
    used_zk_weapon: String(used_zk_weapon)
  };
}

/**
 * Generate proof and return contract-ready payload.
 * @param {{ run_hash_hex: string, score: number, wave: number, nonce: number, season_id: number }} body
 * @returns {{ proof: { a, b, c }, vk: { alpha, beta, gamma, delta, ic }, pub_signals: string[] }}
 */
export function generateProof(body) {
  const input = buildInput(body);
  const inputPath = path.join(BUILD_DIR, 'input.json');
  if (!fs.existsSync(BUILD_DIR)) {
    throw new Error('circuits/build not found. Run npm run zk:build first.');
  }
  if (!fs.existsSync(path.join(BUILD_DIR, 'GameRun_final.zkey'))) {
    throw new Error('Circuit not built. Run npm run zk:build first.');
  }
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));

  const scriptPath = path.join(ROOT, 'scripts', 'zk', 'generate_proof.js');
  execSync(`node "${scriptPath}" "${inputPath}" "${BUILD_DIR}"`, {
    cwd: ROOT,
    stdio: 'pipe',
    timeout: 60000
  });

  const outPath = path.join(BUILD_DIR, 'contract_proof.json');
  const raw = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  return raw;
}

/**
 * Generate proof and return contract-ready payload for GameRunV2.
 * @param {{ run_hash_hi, run_hash_lo, score, wave, nonce, season_id, challenge_id, player_address, contract_id, domain_separator }} body
 * @returns {{ proof: { a, b, c }, vk: { alpha, beta, gamma, delta, ic }, pub_signals: string[] }}
 */
export function generateProofV2(body) {
  const input = buildInputV2(body);
  const inputPath = path.join(BUILD_DIR, 'input.json');
  if (!fs.existsSync(BUILD_DIR)) {
    throw new Error('circuits/build not found. Run npm run zk:build first.');
  }
  if (!fs.existsSync(path.join(BUILD_DIR, 'GameRunV2_js', 'GameRunV2.wasm'))) {
    throw new Error('GameRunV2 circuit not built. Run npm run zk:build first.');
  }
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));

  const scriptPath = path.join(ROOT, 'scripts', 'zk', 'generate_proof_v2.js');
  execSync(`node "${scriptPath}" "${inputPath}" "${BUILD_DIR}"`, {
    cwd: ROOT,
    stdio: 'pipe',
    timeout: 60000
  });

  const outPath = path.join(BUILD_DIR, 'contract_proof.json');
  const raw = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  return raw;
}

function buildInputV2(body) {
  // Normalize any numeric/hex-ish value to decimal string for snarkjs/circom runtime.
  const toDecimalString = (val) => {
    if (val === undefined || val === null || val === '') return '0';
    let str = String(val).trim();
    if (/^[0-9a-fA-F]+$/.test(str) && !str.startsWith('0x')) str = `0x${str}`;
    return BigInt(str).toString(10);
  };

  // Convert all inputs to decimal strings for circom compatibility
  const run_hash_hi = toDecimalString(body.run_hash_hi);
  const run_hash_lo = toDecimalString(body.run_hash_lo);
  const score = String(Math.max(0, Math.floor(Number(body.score) || 0)));
  const wave = String(Math.max(0, Math.floor(Number(body.wave) || 0)));
  const nonce = toDecimalString(body.nonce != null ? body.nonce : '0');
  const season_id = String(Math.max(0, Math.floor(Number(body.season_id) || 1)));
  const challenge_id = String(Math.max(0, Math.floor(Number(body.challenge_id) || 1)));
  
  // Handle Stellar addresses - split hex into 128-bit parts for Circom
  const stellarAddressTo128BitParts = (hexAddress) => {
    if (!hexAddress || typeof hexAddress !== 'string') return { hi: '0', lo: '0' };
    
    // Remove 0x prefix if present
    const cleanHex = hexAddress.replace(/^0x/, '');
    
    // Convert to BigInt and split into 128-bit parts
    const val = BigInt('0x' + cleanHex);
    const hi = (val >> 128n).toString();
    const lo = (val & ((1n << 128n) - 1n)).toString();
    
    return { hi, lo };
  };
  
  const playerParts = body.player_address_hi != null && body.player_address_lo != null
    ? { hi: toDecimalString(body.player_address_hi), lo: toDecimalString(body.player_address_lo) }
    : stellarAddressTo128BitParts(body.player_address);
  const contractParts = body.contract_id_hi != null && body.contract_id_lo != null
    ? { hi: toDecimalString(body.contract_id_hi), lo: toDecimalString(body.contract_id_lo) }
    : stellarAddressTo128BitParts(body.contract_id);
  const player_address_hi = playerParts.hi;
  const player_address_lo = playerParts.lo;
  const contract_id_hi = contractParts.hi;
  const contract_id_lo = contractParts.lo;
  const domain_separator = toDecimalString(body.domain_separator || '0');
  
  return {
    run_hash_hi,
    run_hash_lo,
    score,
    wave,
    nonce,
    season_id,
    challenge_id,
    player_address_hi,
    player_address_lo,
    contract_id_hi,
    contract_id_lo,
    domain_separator
  };
}
