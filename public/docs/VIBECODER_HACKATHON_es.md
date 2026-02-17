# VibeCoder — Hackathon & Repositorio

**Documentación completa para jueces de hackathon y usuarios del repositorio.**  
**VibeCoder** (antes Cosmic Coder) es un juego de supervivencia estilo Vampire Survivors con modo ranked on-chain en Stellar/Soroban y verificación ZK (Groth16/BN254).

---

## Tabla de requisitos

| Requisito | Estado | Descripción |
|-----------|--------|-------------|
| `start_game` en Game Hub | ✅ | Policy llama `start_game` en `start_match` |
| `end_game` en Game Hub | ✅ | Policy llama `end_game` tras `submit_result` / `submit_zk` |
| Tecnología ZK | ✅ | Groth16 sobre BN254 (Circom/snarkjs) |
| Contrato Soroban | ✅ | Policy (VibeCoder) + Verifier (groth16_verifier) |
| Frontend + wallet | ✅ | Phaser 3 + Electron + Freighter |
| Repositorio publicado | ✅ | [GitHub](https://github.com/Klorenn/Cosmic-Coder-) |

---

## Overview

VibeCoder integra:

- **ZK Ranked Mode** — Solo partidas verificadas con prueba Groth16 entran al leaderboard ranked.
- **Casual Mode** — Partidas legacy con `submit_result(wave, score)` y regla `score ≥ wave × 10`.
- **Frontend & Wallet** — Phaser 3, Electron, Freighter (Stellar).
- **Open Source Repo** — Código público en GitHub.

**Stack:** Phaser 3 · Soroban/Rust · Circom/snarkjs · Freighter · Electron

---

## Gameplay — Cómo jugar

### Iniciar partida

1. Abre el juego: [Demo online](https://klorenn.github.io/Cosmic-Coder-/)
2. **Conecta Freighter** en la pantalla de título (extensión de navegador).
3. **Start Game** — Firma la transacción `start_match`.
4. El contrato registra la sesión con el Game Hub (`start_game`).

### Durante la partida

- **Movimiento:** WASD o flechas (o controles táctiles).
- **Ataque:** Automático, no hay botón de disparo.
- **Oleadas:** Enemigos aparecen por oleadas; al completar oleada subes de nivel y ganas XP.
- **Armas:** Recógelas de enemigos; hay evolución y combinaciones.

### Al morir

- **Score = total XP** acumulado.
- Validación: `score ≥ wave × MIN_SCORE_PER_WAVE` (10 por oleada).
- Envío on-chain:
  - **ZK Ranked:** Si hay prover y contrato configurado → `submit_zk` (proof + VK + señales).
  - **Casual:** `submit_result(wave, score)` (regla básica).
- Mensajes visuales: **"ZK RANKED — Submitted"** o **"Casual — Submitted"** según el modo.

---

## Flujo ZK end-to-end

### 1. Off-chain

- Juego calcula `wave`, `score` (total XP).
- `run_hash = H(player || wave || score || runSeed || timestamp)` (SHA-256).
- `runSeed` se genera al iniciar run y se mantiene en memoria.

### 2. Circuito (Circom/Noir)

- Reglas verificadas: `score ≥ wave × 10`, binding con `run_hash`.
- **Public signals:** `run_hash_hi`, `run_hash_lo`, `score`, `wave`, `nonce`, `season_id`.
- Circuito listo para Circom real; pipeline preparado para Noir.

### 3. Generación de proof

- Cliente llama `POST /zk/prove` con `{ run_hash_hex, score, wave, nonce, season_id }`.
- Backend ejecuta snarkjs Groth16 y devuelve `contract_proof.json`.
- Pruebas dummy vs reales: el pipeline soporta ambos; para ranked real se requiere circuito compilado y `pot12_final.ptau`.

### 4. On-chain

- `submit_zk(player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave)`.
- Anti-replay: `(player, nonce, season_id)` único.
- Verifier ejecuta pairing BN254; si OK → actualiza leaderboard ranked y llama Hub `end_game`.

---

## Anti-replay y leaderboard

- **Anti-replay:** Cada `(player, nonce, season_id)` solo puede usarse una vez. Reintento devuelve `Err(Replay)`.
- **Leaderboard ranked:** Por temporada; ordenado por `score` descendente; solo entradas verificadas con ZK.
- **Leaderboard casual:** `get_leaderboard(limit)` para `submit_result`.

---

## Verificación on-chain

### Game Hub

- [Stellar Expert — Game Hub (Testnet)](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG)
- Invocaciones: `start_game` (al iniciar) y `end_game` (al finalizar).

### Policy (VibeCoder)

- [Stellar Expert — Policy (Testnet)](https://stellar.expert/explorer/testnet/contract/CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO)
- Funciones: `start_match`, `submit_result`, `submit_zk`, `get_leaderboard`, `get_leaderboard_by_season`.

### Cómo revisar en Stellar Expert

1. Abre el contrato Policy.
2. Pestaña **Invocations** — verás `start_match` y `submit_zk` / `submit_result`.
3. Pestaña **Events** — busca `zk_run_submitted` para ranked.

---

## Instalación y build

### Dependencias

```bash
npm install
```

### Desarrollo

```bash
npm run dev          # Juego en http://localhost:3000
npm run server       # XP server + ZK prover en :3333
```

### Build WASM (contratos)

```bash
cd contracts
rustup target add wasm32v1-none
cargo build -p groth16_verifier --target wasm32v1-none --release
cargo build -p shadow_ascension --target wasm32v1-none --release
```

### Deploy

Ver [DEPLOY_ZK_STEPS.md](DEPLOY_ZK_STEPS.md) para deploy del verifier y policy en Testnet.

### Tests

```bash
cargo test -p groth16_verifier
cargo test -p shadow_ascension
npm run zk:e2e       # E2E con proof real (opcional)
```

---

## Scripts para simular submit_zk

### Generar proof

```bash
node scripts/zk/generate_proof.js circuits/input.json circuits/build
```

### Invocar verifier (Stellar CLI)

```bash
stellar contract invoke --id <VERIFIER_ID> --source-account <SOURCE> --network testnet --sim-only -- \
  verify_proof \
  --vk '{"alpha":"<hex>","beta":"<hex>","gamma":"<hex>","delta":"<hex>","ic":["<hex>",...]}' \
  --proof '{"a":"<hex>","b":"<hex>","c":"<hex>"}' \
  --pub_signals '["<hex>","<hex>",...]'
```

### Construir argumentos desde contract_proof.json

```bash
node scripts/zk/contract_args_from_proof.js circuits/build
```

---

## Consejos para verificar cumplimiento

Para comprobar que una partida cumple las reglas **sin depender del cliente**:

1. **On-chain:** Revisa `submit_zk` en Stellar Expert; el contrato solo acepta proofs válidos.
2. **Regla score/wave:** El circuito exige `score ≥ wave × 10`; el verifier rechaza pruebas inconsistentes.
3. **Anti-replay:** Reintentar el mismo `(player, nonce, season_id)` devuelve `Replay`.
4. **Leaderboard:** Solo entradas con proof verificado aparecen en `get_leaderboard_by_season`.

---

## Enlaces de referencia

- **Demo:** [https://klorenn.github.io/Cosmic-Coder-/](https://klorenn.github.io/Cosmic-Coder-/)
- **GitHub:** [https://github.com/Klorenn/Cosmic-Coder-](https://github.com/Klorenn/Cosmic-Coder-)
- **Game Hub (Testnet):** [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG)
- **Policy (Testnet):** [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO)
- **Verifier (Testnet):** [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA)
- **CAP-0074 (BN254):** [Stellar Protocol](https://stellar.github.io/stellar-protocol/master/core/cap-0074.html)

---

*VibeCoder · Documentación Hackathon & Repo · v0.7.x*
