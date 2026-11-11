/**
 * ZK proof generation for Cosmic Coder ranked submit (Groth16, in-process snarkjs).
 * Each request proves in memory: no shared input.json/proof.json, so concurrent requests cannot
 * read each other's proof and circuits/build/contract_proof.json (deploy + test fixture) is never touched.
 * Every proof is verified against the circuit VK before it is returned.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as snarkjs from 'snarkjs';
import { StrKey } from '@stellar/stellar-base';
import { toContractFormat } from '../scripts/zk/export_for_contract.js';
import { buildRunWitness } from '../src/zk/gameProof.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(path.resolve(__dirname, '..'), 'circuits', 'build');

const CIRCUITS = {
  GameRun: {
    wasm: path.join(BUILD_DIR, 'GameRun_js', 'GameRun.wasm'),
    zkey: path.join(BUILD_DIR, 'GameRun_final.zkey'),
    vkey: path.join(BUILD_DIR, 'GameRun_vkey.json'),
  },
  GameRunV3: {
    wasm: path.join(BUILD_DIR, 'GameRunV3_js', 'GameRunV3.wasm'),
    zkey: path.join(BUILD_DIR, 'GameRunV3_final.zkey'),
    vkey: path.join(BUILD_DIR, 'GameRunV3_vkey.json'),
  },
  GameRunV2: {
    wasm: path.join(BUILD_DIR, 'GameRunV2_js', 'GameRunV2.wasm'),
    zkey: path.join(BUILD_DIR, 'GameRunV2_final.zkey'),
    vkey: path.join(BUILD_DIR, 'GameRunV2_vkey.json'),
  },
};

const vkCache = new Map();
function loadVk(name) {
  if (!vkCache.has(name)) vkCache.set(name, JSON.parse(fs.readFileSync(CIRCUITS[name].vkey, 'utf8')));
  return vkCache.get(name);
}

async function prove(name, input) {
  const c = CIRCUITS[name];
  for (const f of [c.wasm, c.zkey, c.vkey]) {
    if (!fs.existsSync(f)) throw new Error(`${name} artifact missing: ${path.relative(BUILD_DIR, f)}. Run npm run zk:build.`);
  }
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, c.wasm, c.zkey);
  const vk = loadVk(name);
  if (!(await snarkjs.groth16.verify(vk, publicSignals, proof))) {
    throw new Error(`${name} proof failed local verification`);
  }
  return toContractFormat(proof, vk, publicSignals);
}

const u32 = (v, field) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`${field} must be a u32 integer`);
  return String(n);
};
const u64 = (v, field) => {
  const n = BigInt(String(v ?? '').trim() || 'x');
  if (n < 0n || n >= 1n << 64n) throw new Error(`${field} must be a u64 integer`);
  return n.toString();
};

/** Decimal, 0x-hex or bare hex -> decimal string (bare all-digit values are decimal). */
function toDecimalString(val) {
  if (val === undefined || val === null || val === '') return '0';
  let str = String(val).trim();
  if (!/^\d+$/.test(str) && /^[0-9a-fA-F]+$/.test(str)) str = `0x${str}`;
  return BigInt(str).toString(10);
}

/** G.../C... strkey or 32-byte hex -> { hi, lo } 128-bit limbs (decimal strings). */
function addressToLimbs(addr) {
  if (!addr) return { hi: '0', lo: '0' };
  const s = String(addr).trim();
  let hex;
  if (StrKey.isValidEd25519PublicKey(s)) hex = Buffer.from(StrKey.decodeEd25519PublicKey(s)).toString('hex');
  else if (StrKey.isValidContract(s)) hex = Buffer.from(StrKey.decodeContract(s)).toString('hex');
  else if (/^(0x)?[0-9a-fA-F]{1,64}$/.test(s)) hex = s.replace(/^0x/, '');
  else throw new Error(`invalid address: ${s.slice(0, 8)}...`);
  const v = BigInt('0x' + hex);
  return { hi: (v >> 128n).toString(), lo: (v & ((1n << 128n) - 1n)).toString() };
}

/**
 * GameRun input (the circuit submit_zk consumes: 7 public signals).
 * run_hash_hex: 64 hex chars (32 bytes) -> hi = first 16 bytes, lo = last 16 bytes.
 */
export function buildInput(body) {
  const run_hash_hex = String(body.run_hash_hex || '').replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(run_hash_hex)) throw new Error('run_hash_hex must be 64 hex chars (32 bytes)');
  return {
    run_hash_hi: BigInt('0x' + run_hash_hex.slice(0, 32)).toString(),
    run_hash_lo: BigInt('0x' + run_hash_hex.slice(32, 64)).toString(),
    score: u32(body.score, 'score'),
    wave: u32(body.wave, 'wave'),
    nonce: u64(body.nonce, 'nonce'),
    season_id: u32(body.season_id ?? 1, 'season_id'),
    used_zk_weapon: Number(body.used_zk_weapon) ? '1' : '0',
  };
}

/** @returns {Promise<{ proof: { a, b, c }, vk: { alpha, beta, gamma, delta, ic }, pub_signals: string[] }>} hex */
export function generateProof(body) {
  return prove('GameRun', buildInput(body));
}

export function buildInputV2(body) {
  const player = body.player_address_hi != null && body.player_address_lo != null
    ? { hi: toDecimalString(body.player_address_hi), lo: toDecimalString(body.player_address_lo) }
    : addressToLimbs(body.player_address);
  const contract = body.contract_id_hi != null && body.contract_id_lo != null
    ? { hi: toDecimalString(body.contract_id_hi), lo: toDecimalString(body.contract_id_lo) }
    : addressToLimbs(body.contract_id);
  return {
    run_hash_hi: toDecimalString(body.run_hash_hi),
    run_hash_lo: toDecimalString(body.run_hash_lo),
    score: u32(body.score, 'score'),
    wave: u32(body.wave, 'wave'),
    nonce: u64(body.nonce, 'nonce'),
    season_id: u32(body.season_id ?? 1, 'season_id'),
    challenge_id: u32(body.challenge_id ?? 1, 'challenge_id'),
    player_address_hi: player.hi,
    player_address_lo: player.lo,
    contract_id_hi: contract.hi,
    contract_id_lo: contract.lo,
    domain_separator: toDecimalString(body.domain_separator || '0'),
  };
}

/**
 * GameRunV2 (12 public signals). NOTE: cosmic_coder.submit_zk only accepts the 7-signal GameRun
 * layout, so this proof is verifiable off-chain / by the verifier contract but not submittable.
 */
export function generateProofV2(body) {
  return prove('GameRunV2', buildInputV2(body));
}

/** True when the GameRunV3 wasm/zkey/vkey are built (scripts/zk/build_GameRunV3.sh). */
export function hasV3Artifacts() {
  const c = CIRCUITS.GameRunV3;
  return [c.wasm, c.zkey, c.vkey].every((f) => fs.existsSync(f));
}

/**
 * GameRunV3 input. Body = buildRunWitness output (docs/ZK_CIRCUIT_STATUS.md, "V3 payload"):
 * { seed, kills, events_hash, score, wave, nonce, season_id?, used_zk_weapon? }. `events` (raw log) is accepted
 * instead of `events_hash`. Throws on values outside u32/u64 or a score the circuit cannot prove.
 */
export function buildInputV3(body) {
  return buildRunWitness({
    score: body.score,
    wave: body.wave,
    kills: body.kills,
    seed: body.seed,
    nonce: body.nonce,
    season: body.season_id ?? 1,
    events: body.events,
    eventsHash: body.events_hash,
    usedZkWeapon: body.used_zk_weapon,
  });
}

/** GameRunV3 (7 public signals, same layout as GameRun; run_hash = Poseidon commitment in signals 0/1). */
export async function generateProofV3(body) {
  return prove('GameRunV3', await buildInputV3(body));
}
