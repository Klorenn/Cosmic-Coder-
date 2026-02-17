# ZK Real Proof Setup (Cosmic Coder)

Guía para compilar el circuito Circom, generar VK/proof real y usarlos con `groth16_verifier` y `submit_zk`.

## Requisitos

- **Node** 18+
- **circom** 2.1.x — [Instalación](https://docs.circom.io/getting-started/installation/)
- **snarkjs** — `npm i -g snarkjs`
- **Rust + wasm32** — para contratos (ya cubierto en `contracts/README.md`)

## 1. Circuito (Circom)

El circuito `circuits/GameRun.circom` **valida la regla de juego**: `score >= wave * 10` (MIN_SCORE_PER_WAVE). Usa `GreaterEqThan` de circomlib; una proof solo es válida si cumple la regla.

Tiene **6 señales públicas**:

| Señal       | Uso                          |
|------------|-------------------------------|
| run_hash_hi| 128 bits altos de run_hash    |
| run_hash_lo| 128 bits bajos de run_hash    |
| score      | u32                           |
| wave       | u32                           |
| nonce      | u64                           |
| season_id  | u32                           |

El contrato exige `vk.ic.len() == pub_signals.len() + 1`, es decir **7 elementos en `ic`** (6 señales + término constante).

## 2. Compilar circuito y trusted setup

```bash
# Desde repo root
chmod +x scripts/zk/build_circuit.sh
./scripts/zk/build_circuit.sh
```

Esto genera en `circuits/build/`:

- `GameRun.r1cs`, `GameRun_js/GameRun.wasm`
- `GameRun_final.zkey`
- `vkey.json`

Si no existe `pot12_final.ptau`, el script intenta descargarlo; si falla, hay que generar la ceremonia (ver snarkjs docs).

## 3. Generar proof real

Crea `circuits/input.json` (o copia `input.json.example`):

```json
{
  "run_hash_hi": "0",
  "run_hash_lo": "0",
  "score": "100",
  "wave": "5",
  "nonce": "1",
  "season_id": "1"
}
```

Genera proof y exportación para contrato:

```bash
node scripts/zk/generate_proof.js circuits/input.json circuits/build
```

Salida: `circuits/build/contract_proof.json` (proof, vk y pub_signals en hex para el contrato).

## 4. Verificar con el verifier (Soroban)

Tras desplegar el verifier (ver [DEPLOY_ZK_STEPS.md](DEPLOY_ZK_STEPS.md); build con **wasm32v1-none**). En testnet conviene usar `--source-account <SOURCE>` en las invocaciones.

**Referencia (Testnet):** Verifier `CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA`, Policy `CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO`.

```bash
# Sustituir VERIFIER_ID y los valores por los de contract_proof.json
stellar contract invoke --id <VERIFIER_ID> --source-account <SOURCE> --network testnet --sim-only -- \
  verify_proof \
  --vk '{"alpha":"<hex>","beta":"<hex>","gamma":"<hex>","delta":"<hex>","ic":["<hex>",...]}' \
  --proof '{"a":"<hex>","b":"<hex>","c":"<hex>"}' \
  --pub_signals '["<hex>","<hex>",...]'
```

Para construir los argumentos desde `contract_proof.json`:

```bash
node scripts/zk/contract_args_from_proof.js circuits/build
```

(Se puede usar la salida para rellenar vk/proof/pub_signals en la invocación.)

## 5. Opción B: backend genera la proof (flujo integrado en el juego)

El servidor (`npm run server`) expone `POST /zk/prove` con body:

`{ "run_hash_hex", "score", "wave", "nonce", "season_id" }`

El backend escribe `circuits/build/input.json`, ejecuta `generate_proof.js` y devuelve el JSON listo para contrato. El frontend llama a `requestZkProof(proverUrl, payload)` y luego `submitZkFromProver(addr, sign, proverUrl, payload)`.

- **Variable de entorno (frontend):** `VITE_ZK_PROVER_URL` (por defecto `http://localhost:3333`). Si está definida y el contrato también, al morir en partida nueva se usa **ranked (ZK)** en lugar de casual.
- **Requisito:** Partida nueva (no “continuar”) para tener `runSeed`; servidor con circuito compilado y `snarkjs` en PATH.

## 6. submit_zk con proof real (policy)

Desde el frontend (o con Stellar CLI):

- **player**: Address del jugador (auth).
- **proof / vk / pub_signals**: los de `contract_proof.json` (en formato ScVal; el cliente ya usa proof/vk/pubSignals).
- **nonce**: único por (player, season_id); debe coincidir con el `nonce` usado en el circuito (mismo que en input.json).
- **run_hash**: 32 bytes; puede ser los primeros 32 bytes del binding (p. ej. `pub_signals[0]` en hex = 32 bytes).
- **season_id, score, wave**: mismos que en input.json (y que en pub_signals).

Ejemplo mínimo en JS (con `contract_proof.json` cargado). Convierte hex a `Buffer` para que el SDK construya los ScVals:

```js
import { submitZk } from './contracts/gameClient.js';

const contractProof = await fetch('/circuits/build/contract_proof.json').then(r => r.json());

// contract_proof.json usa hex; el cliente puede esperar proof/vk/pubSignals como ScVal o como objetos con Buffers
const toBuf = (hex) => Buffer.from(hex, 'hex');
const zk = {
  proof: {
    a: toBuf(contractProof.proof.a),
    b: toBuf(contractProof.proof.b),
    c: toBuf(contractProof.proof.c),
  },
  vk: {
    alpha: toBuf(contractProof.vk.alpha),
    beta: toBuf(contractProof.vk.beta),
    gamma: toBuf(contractProof.vk.gamma),
    delta: toBuf(contractProof.vk.delta),
    ic: contractProof.vk.ic.map(toBuf),
  },
  pubSignals: contractProof.pub_signals.map(toBuf),
};
const runHashHex = contractProof.pub_signals[0]; // 32 bytes = run_hash_hi
const nonce = 1;
const seasonId = 1;
const score = 100;
const wave = 5;

await submitZk(
  signerPublicKey,
  signTransaction,
  zk,
  nonce,
  runHashHex,
  seasonId,
  score,
  wave
);
```

Si tu `gameClient.submitZk` construye los ScVals internamente, pasa `zk` con la estructura que espere (p. ej. ya convertida a `xdr.ScVal` según el SDK).

## 7. Simulación de recursos (Testnet)

```bash
stellar contract invoke --sim-only \
  --id <POLICY_ID> \
  --source-account <SOURCE> \
  --network testnet \
  -- submit_zk \
  --player <ADDRESS> \
  --proof '...' \
  --vk '...' \
  --pub_signals '...' \
  --nonce 1 \
  --run_hash <32_BYTES_HEX> \
  --season_id 1 \
  --score 100 \
  --wave 5
```

Revisar en la salida: CPU/memoria y eventos (p. ej. `zk_run_submitted`).

## 8. Checklist validación end-to-end

- [ ] **Circuito**: `circuits/GameRun.circom` compila con `build_circuit.sh` (r1cs, wasm, zkey, vkey.json).
- [ ] **Proof real**: `input.json` + `generate_proof.js` → `contract_proof.json` sin error.
- [ ] **Verifier**: `stellar contract invoke --sim-only` con proof/vk/pub_signals de `contract_proof.json` → éxito (resultado true o sin error de verificación).
- [ ] **Policy**: `submit_zk` con mismo proof, nonce único, run_hash/season_id/score/wave coherentes → Ok(()); leaderboard y evento `zk_run_submitted` visibles.
- [ ] **Anti-replay**: segunda llamada `submit_zk` con mismo (player, nonce, season_id) → falla (Replay).
- [ ] **Frontend**: envío manual con proof real desde JS (submitZk + contract_proof.json) llega al verifier y la tx tiene éxito.
- [ ] **Recursos**: simulación Testnet con proof real documentada (CPU/memoria) para el runbook.

## Notas

- **run_hash**: En el circuito son dos campos (hi/lo); en el contrato es un solo `BytesN<32>`. Para binding, usar p. ej. los 32 bytes de la primera señal pública como run_hash on-chain.
- **Byte order**: G1 y Fr: big-endian 32 bytes. G2: 128 bytes como **x0‖x1‖y0‖y1** (cada limb 32 bytes big-endian); Soroban BN254 no usa el orden x1‖x0‖y1‖y0 de Ethereum/snarkjs. El script `export_for_contract.js` ya exporta en el formato correcto.
- **Powers of Tau**: En producción usar ceremonia multi-participante; el script usa un ptau pequeño para desarrollo/demo.
