# VibeCoder — Hackathon & Repository

**Complete documentation for hackathon judges and repository users.**  
**VibeCoder** (formerly Cosmic Coder) is a Vampire Survivors–style survival game with on-chain ranked mode on Stellar/Soroban and ZK verification (Groth16/BN254).

---

## Requirements Checklist

| Requirement | Status | Description |
|-------------|--------|-------------|
| `start_game` in Game Hub | ✅ | Policy calls `start_game` in `start_match` |
| `end_game` in Game Hub | ✅ | Policy calls `end_game` after `submit_result` / `submit_zk` |
| ZK Technology | ✅ | Groth16 over BN254 (Circom/snarkjs) |
| Soroban Contract | ✅ | Policy (VibeCoder) + Verifier (groth16_verifier) |
| Frontend + Wallet | ✅ | Phaser 3 + Electron + Freighter |
| Published Repo | ✅ | [GitHub](https://github.com/Klorenn/Cosmic-Coder-) |

---

## Overview

VibeCoder integrates:

- **ZK Ranked Mode** — Only runs verified with a Groth16 proof enter the ranked leaderboard.
- **Casual Mode** — Legacy runs via `submit_result(wave, score)` with rule `score ≥ wave × 10`.
- **Frontend & Wallet** — Phaser 3, Electron, Freighter (Stellar).
- **Open Source Repo** — Public code on GitHub.

**Stack:** Phaser 3 · Soroban/Rust · Circom/snarkjs · Freighter · Electron

---

## Gameplay — How to Play

### Starting a Run

1. Open the game: [Online Demo](https://klorenn.github.io/Cosmic-Coder-/)
2. **Connect Freighter** on the title screen (browser extension).
3. **Start Game** — Sign the `start_match` transaction.
4. The contract registers the session with the Game Hub (`start_game`).

### During a Run

- **Movement:** WASD or Arrow keys (or touch controls).
- **Attack:** Automatic; no fire button.
- **Waves:** Enemies spawn in waves; completing a wave levels you up and grants XP.
- **Weapons:** Collect from enemies; evolution and combinations available.

### On Death

- **Score = total XP** accumulated.
- Validation: `score ≥ wave × MIN_SCORE_PER_WAVE` (10 per wave).
- On-chain submission:
  - **ZK Ranked:** If prover and contract configured → `submit_zk` (proof + VK + public signals).
  - **Casual:** `submit_result(wave, score)` (basic rule).
- Visual messages: **"ZK RANKED — Submitted"** or **"Casual — Submitted"** depending on mode.

---

## End-to-End ZK Flow

### 1. Off-Chain

- Game computes `wave`, `score` (total XP).
- `run_hash = H(player || wave || score || runSeed || timestamp)` (SHA-256).
- `runSeed` is generated at run start and kept in memory.

### 2. Circuit (Circom/Noir)

- Verified rules: `score ≥ wave × 10`, binding with `run_hash`.
- **Public signals:** `run_hash_hi`, `run_hash_lo`, `score`, `wave`, `nonce`, `season_id`.
- Circuit ready for real Circom; pipeline prepared for Noir.

### 3. Proof Generation

- Client calls `POST /zk/prove` with `{ run_hash_hex, score, wave, nonce, season_id }`.
- Backend runs snarkjs Groth16 and returns `contract_proof.json`.
- Dummy vs real proofs: the pipeline supports both; for real ranked runs the compiled circuit and `pot12_final.ptau` are required.

### 4. On-Chain

- `submit_zk(player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave)`.
- Anti-replay: `(player, nonce, season_id)` must be unique.
- Verifier runs BN254 pairing; if OK → updates ranked leaderboard and calls Hub `end_game`.

---

## Anti-Replay and Leaderboard

- **Anti-replay:** Each `(player, nonce, season_id)` can be used only once. Retry returns `Err(Replay)`.
- **Ranked leaderboard:** Per season; sorted by `score` descending; only ZK-verified entries.
- **Casual leaderboard:** `get_leaderboard(limit)` for `submit_result`.

---

## On-Chain Verification

### Game Hub

- [Stellar Expert — Game Hub (Testnet)](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG)
- Invocations: `start_game` (on start) and `end_game` (on finish).

### Policy (VibeCoder)

- [Stellar Expert — Policy (Testnet)](https://stellar.expert/explorer/testnet/contract/CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO)
- Functions: `start_match`, `submit_result`, `submit_zk`, `get_leaderboard`, `get_leaderboard_by_season`.

### How to Check in Stellar Expert

1. Open the Policy contract.
2. **Invocations** tab — you will see `start_match` and `submit_zk` / `submit_result`.
3. **Events** tab — look for `zk_run_submitted` for ranked runs.

---

## Installation and Build

### Dependencies

```bash
npm install
```

### Development

```bash
npm run dev          # Game at http://localhost:3000
npm run server       # XP server + ZK prover at :3333
```

### WASM Build (Contracts)

```bash
cd contracts
rustup target add wasm32v1-none
cargo build -p groth16_verifier --target wasm32v1-none --release
cargo build -p shadow_ascension --target wasm32v1-none --release
```

### Deploy

See [DEPLOY_ZK_STEPS.md](DEPLOY_ZK_STEPS.md) for deploying verifier and policy to Testnet.

### Tests

```bash
cargo test -p groth16_verifier
cargo test -p shadow_ascension
npm run zk:e2e       # E2E with real proof (optional)
```

---

## Scripts to Simulate submit_zk

### Generate Proof

```bash
node scripts/zk/generate_proof.js circuits/input.json circuits/build
```

### Invoke Verifier (Stellar CLI)

```bash
stellar contract invoke --id <VERIFIER_ID> --source-account <SOURCE> --network testnet --sim-only -- \
  verify_proof \
  --vk '{"alpha":"<hex>","beta":"<hex>","gamma":"<hex>","delta":"<hex>","ic":["<hex>",...]}' \
  --proof '{"a":"<hex>","b":"<hex>","c":"<hex>"}' \
  --pub_signals '["<hex>","<hex>",...]'
```

### Build Arguments from contract_proof.json

```bash
node scripts/zk/contract_args_from_proof.js circuits/build
```

---

## Verification Tips (Without Trusting the Client)

To verify that a run satisfies the rules **without depending on the client**:

1. **On-chain:** Check `submit_zk` in Stellar Expert; the contract only accepts valid proofs.
2. **Score/wave rule:** The circuit enforces `score ≥ wave × 10`; the verifier rejects inconsistent proofs.
3. **Anti-replay:** Retrying the same `(player, nonce, season_id)` returns `Replay`.
4. **Leaderboard:** Only proof-verified entries appear in `get_leaderboard_by_season`.

---

## Reference Links

- **Demo:** [https://klorenn.github.io/Cosmic-Coder-/](https://klorenn.github.io/Cosmic-Coder-/)
- **GitHub:** [https://github.com/Klorenn/Cosmic-Coder-](https://github.com/Klorenn/Cosmic-Coder-)
- **Game Hub (Testnet):** [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG)
- **Policy (Testnet):** [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO)
- **Verifier (Testnet):** [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA)
- **CAP-0074 (BN254):** [Stellar Protocol](https://stellar.github.io/stellar-protocol/master/core/cap-0074.html)

---

*VibeCoder · Hackathon & Repository Documentation · v0.7.x*
