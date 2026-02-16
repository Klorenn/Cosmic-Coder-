/**
 * Convert snarkjs Groth16 proof + vkey + public signals to contract format.
 * Contract expects: proof { a: 64, b: 128, c: 64 }, vk { alpha, beta, gamma, delta, ic[] }, pub_signals: BytesN<32>[]
 * BN254: big-endian 32-byte field elements; G1 = 64 bytes (x||y), G2 = 128 bytes.
 */
import fs from 'fs';
import path from 'path';

const toHex = (n) => {
  if (typeof n === 'string') n = BigInt(n);
  let h = n.toString(16);
  if (h.length % 2) h = '0' + h;
  if (h.length > 64) h = h.slice(-64);
  return h.padStart(64, '0');
};

const toBytes32BE = (n) => {
  const h = toHex(n);
  return Buffer.from(h, 'hex');
};

// G1: [x, y] -> 64 bytes (x || y), each 32 bytes big-endian
function g1ToBytes(pt) {
  const x = toBytes32BE(pt[0]);
  const y = toBytes32BE(pt[1]);
  return Buffer.concat([x, y]);
}

// G2: [[x1, x0], [y1, y0]] -> 128 bytes. Soroban BN254 expects x0||x1||y0||y1 (limb order).
function g2ToBytes(pt) {
  const x1 = toBytes32BE(pt[0][0]);
  const x0 = toBytes32BE(pt[0][1]);
  const y1 = toBytes32BE(pt[1][0]);
  const y0 = toBytes32BE(pt[1][1]);
  return Buffer.concat([x0, x1, y0, y1]);
}

export function exportProof(proofPath) {
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const a = g1ToBytes(proof.pi_a.slice(0, 2));
  const b = g2ToBytes(proof.pi_b);
  const c = g1ToBytes(proof.pi_c.slice(0, 2));
  if (a.length !== 64 || b.length !== 128 || c.length !== 64) throw new Error('Proof byte length mismatch');
  return { a, b, c };
}

export function exportVk(vkeyPath) {
  const vk = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
  const alpha = g1ToBytes(vk.vk_alpha_1 ?? vk.alpha_1);
  const beta = g2ToBytes(vk.vk_beta_2 ?? vk.beta_2);
  const gamma = g2ToBytes(vk.vk_gamma_2 ?? vk.gamma_2);
  const delta = g2ToBytes(vk.vk_delta_2 ?? vk.delta_2);
  const icArr = vk.IC ?? vk.ic;
  const ic = icArr.map((p) => g1ToBytes(p));
  if (alpha.length !== 64 || beta.length !== 128 || gamma.length !== 128 || delta.length !== 128) throw new Error('VK byte length mismatch');
  ic.forEach((p, i) => { if (p.length !== 64) throw new Error(`ic[${i}] length ${p.length}`); });
  return { alpha, beta, gamma, delta, ic };
}

export function exportPubSignals(publicPath) {
  const pub = JSON.parse(fs.readFileSync(publicPath, 'utf8'));
  return pub.map((s) => toBytes32BE(s));
}

export function exportAll(buildDir, outPath) {
  const proof = exportProof(path.join(buildDir, 'proof.json'));
  const vk = exportVk(path.join(buildDir, 'vkey.json'));
  const pub_signals = exportPubSignals(path.join(buildDir, 'public.json'));
  const out = {
    proof: {
      a: proof.a.toString('hex'),
      b: proof.b.toString('hex'),
      c: proof.c.toString('hex'),
    },
    vk: {
      alpha: vk.alpha.toString('hex'),
      beta: vk.beta.toString('hex'),
      gamma: vk.gamma.toString('hex'),
      delta: vk.delta.toString('hex'),
      ic: vk.ic.map((b) => b.toString('hex')),
    },
    pub_signals: pub_signals.map((b) => b.toString('hex')),
  };
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  return out;
}

// CLI
const buildDir = process.argv[2] || path.join(process.cwd(), 'circuits/build');
const outPath = process.argv[3] || path.join(buildDir, 'contract_proof.json');
if (process.argv[1]?.includes('export_for_contract')) {
  exportAll(buildDir, outPath);
  console.log('Written', outPath);
}
