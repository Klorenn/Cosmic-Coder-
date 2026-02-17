/**
 * ZK proof generation for Cosmic Coder ranked submit.
 * Writes input.json from request, runs generate_proof.js, returns contract_proof.json content.
 * Requires: circuits built (npm run zk:build), snarkjs, circom in PATH.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  return {
    run_hash_hi,
    run_hash_lo,
    score: String(score),
    wave: String(wave),
    nonce,
    season_id: String(season_id)
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
