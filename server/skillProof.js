/**
 * ZK proof generation for SkillProof (weapon unlock verification).
 * Proves: score >= threshold without revealing exact score.
 * Uses Poseidon hash to bind wallet + score + nonce.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'circuits', 'build');

// Field prime for BN254
const FIELD_PRIME = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

/**
 * Convert wallet address to field element
 * @param {string} wallet - Stellar address (G...)
 * @returns {BigInt} Field element
 */
function walletToField(wallet) {
  const walletStr = String(wallet || '');
  let hash = 0n;
  for (let i = 0; i < walletStr.length; i++) {
    hash = (hash * 31n + BigInt(walletStr.charCodeAt(i))) % FIELD_PRIME;
  }
  return hash;
}

/**
 * Build circuit input for skill proof.
 * The circuit computes publicHash = Poseidon(wallet, score, nonce)
 * @param {{ score: number, wallet: string, nonce: number, threshold: number }} body
 */
function buildInput(body) {
  const score = Math.max(0, Math.floor(Number(body.score) || 0));
  const threshold = Math.max(0, Math.floor(Number(body.threshold) || 0));
  const nonce = BigInt(body.nonce != null ? body.nonce : Date.now());
  const wallet = walletToField(body.wallet);
  
  // For the initial input, we set publicHash to 0
  // The circuit will compute the actual hash and verify it
  // But we need to provide the correct publicHash as a public input
  // We'll compute it by running the witness generation first
  
  return {
    score: String(score),
    wallet: String(wallet),
    nonce: String(nonce),
    threshold: String(threshold),
    publicHash: '0' // Placeholder - will be computed
  };
}

/**
 * Calculate Poseidon hash for the given inputs using PoseidonHash circuit
 * @param {string} wallet - Wallet field element
 * @param {string} score - Score
 * @param {string} nonce - Nonce
 * @returns {string} Poseidon hash
 */
function calculatePoseidonHash(wallet, score, nonce) {
  const tempInput = {
    wallet: String(wallet),
    score: String(score),
    nonce: String(nonce)
  };
   
  const inputPath = path.join(BUILD_DIR, 'poseidon_input.json');
  fs.writeFileSync(inputPath, JSON.stringify(tempInput, null, 2));
  
  // Generate witness using PoseidonHash circuit
  execSync(
    `cd "${BUILD_DIR}" && snarkjs wtns calculate PoseidonHash_js/PoseidonHash.wasm poseidon_input.json poseidon_witness.wtns`,
    { stdio: 'pipe', timeout: 30000 }
  );
  
  // Export public signals (the hash is the only output)
  execSync(
    `cd "${BUILD_DIR}" && snarkjs wtns export json poseidon_witness.wtns poseidon_public.json`,
    { stdio: 'pipe', timeout: 10000 }
  );
  
  const publicJson = JSON.parse(fs.readFileSync(path.join(BUILD_DIR, 'poseidon_public.json'), 'utf8'));
  // The Poseidon component in circomlib outputs multiple values
  // The actual hash appears to be at index 1 (second position)
  return publicJson[1];
}

/**
 * Generate skill proof and return contract-ready payload.
 * @param {{ score: number, wallet: string, nonce: number, threshold: number }} body
 * @returns {{ proof: { a, b, c }, vk: { alpha, beta, gamma, delta, ic }, pub_signals: string[] }}
 */
export function generateSkillProof(body) {
  const input = buildInput(body);
  
  if (!fs.existsSync(BUILD_DIR)) {
    throw new Error('circuits/build not found. Run npm run zk:build first.');
  }
  if (!fs.existsSync(path.join(BUILD_DIR, 'SkillProof_final.zkey'))) {
    throw new Error('SkillProof circuit not built. Run npm run zk:build first.');
  }

  // Calculate the correct publicHash
  const publicHash = calculatePoseidonHash(input.wallet, input.score, input.nonce);
  
  // Update input with correct publicHash
  input.publicHash = publicHash;
  
  // Now generate the actual proof with correct publicHash
  const inputPath = path.join(BUILD_DIR, 'skill_input.json');
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));

  // Run snarkjs to generate proof
  const scriptPath = path.join(ROOT, 'scripts', 'zk', 'generate_skill_proof.js');
  execSync(`node "${scriptPath}" "${inputPath}" "${BUILD_DIR}"`, {
    cwd: ROOT,
    stdio: 'pipe',
    timeout: 60000
  });

  const outPath = path.join(BUILD_DIR, 'skill_contract_proof.json');
  const raw = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  return raw;
}
