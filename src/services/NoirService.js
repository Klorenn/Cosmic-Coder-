import { keccak_256 } from '@noble/hashes/sha3';
import { getAssetPath } from '../utils/assetBase.js';

export class NoirService {
  async generateProof(circuitName, inputs) {
    const { Noir } = await import('@noir-lang/noir_js');
    const { UltraHonkBackend } = await import('@aztec/bb.js');

    const circuitUrl = getAssetPath(`circuits/${circuitName}.json`);
    const circuitRes = await fetch(circuitUrl);
    if (!circuitRes.ok) throw new Error(`Cannot load circuit: ${circuitName}.json`);
    const circuit = await circuitRes.json();

    const noir = new Noir(circuit);
    const { witness } = await noir.execute(inputs);

    const backend = new UltraHonkBackend(circuit.bytecode);
    const proofData = await backend.generateProof(witness, { keccak: true });

    const publicInputs = this.encodePublicInputs(circuit, inputs);
    const proofBytes = proofData.proof instanceof Uint8Array ? proofData.proof : new Uint8Array(proofData.proof);
    const { proofBlob, proofId } = this.buildProofBlob(publicInputs, proofBytes);

    const vkJson = await this.loadVk(circuitName);
    return { vkJson, proofBlob, proofId };
  }

  async loadVk(circuitName) {
    const vkUrl = getAssetPath(`circuits/${circuitName}_vk.json`);
    const res = await fetch(vkUrl);
    if (!res.ok) throw new Error(`Cannot load VK: ${circuitName}_vk.json`);
    const txt = await res.text();
    return new TextEncoder().encode(txt);
  }

  encodePublicInputs(circuit, inputs) {
    const params = (circuit?.abi?.parameters || []).filter((p) => p.visibility === 'public');
    const out = [];

    const encodeField = (value, type) => {
      const field = new Uint8Array(32);
      let v = BigInt(value);
      if (type?.kind === 'integer' && type?.sign === 'signed' && v < 0n) {
        // two's complement into width, then place in 32-byte slot
        const width = BigInt(type.width || 32);
        const mod = 1n << width;
        v = (v % mod + mod) % mod;
      }
      for (let i = 31; i >= 0; i--) {
        field[i] = Number(v & 0xffn);
        v >>= 8n;
      }
      out.push(field);
    };

    for (const p of params) {
      const val = inputs[p.name];
      if (p.type.kind === 'array') {
        if (!Array.isArray(val)) throw new Error(`Public input ${p.name} must be array`);
        for (const item of val) encodeField(item, p.type.type);
      } else {
        encodeField(val, p.type);
      }
    }

    const bytes = new Uint8Array(out.length * 32);
    out.forEach((f, i) => bytes.set(f, i * 32));
    return bytes;
  }

  buildProofBlob(publicInputsBytes, proofBytes) {
    const proofFieldCount = Math.floor(proofBytes.length / 32);
    const publicFieldCount = Math.floor(publicInputsBytes.length / 32);
    const totalFields = proofFieldCount + publicFieldCount;

    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, totalFields, false);

    const proofBlob = new Uint8Array(header.length + publicInputsBytes.length + proofBytes.length);
    proofBlob.set(header, 0);
    proofBlob.set(publicInputsBytes, 4);
    proofBlob.set(proofBytes, 4 + publicInputsBytes.length);

    const proofId = Array.from(keccak_256(proofBlob))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return { proofBlob, proofId };
  }
}
