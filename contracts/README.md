# Contracts (ZK Ranked Mode)

Layout:

- **zk_types** — Shared ZK types only (`Groth16Error`, `ZkProof`, `ZkVerificationKey`). No duplicated definitions; used by verifier and policy.
- **groth16_verifier** — BN254 Groth16 verification only. No game logic, no leaderboard, no replay.
- **cosmic_coder** — Game policy (Cosmic Coder): verifier address, anti-replay (player + nonce + season_id), calls verifier, leaderboard, events. Legacy `submit_result` for casual mode.

## Build (WASM)

Use **rustup’s cargo** (e.g. `export PATH="$HOME/.cargo/bin:$PATH"`) For Soroban testnet use target **wasm32v1-none**.

```bash
rustup target add wasm32v1-none
cd contracts
cargo build -p zk_types
cargo build -p groth16_verifier --target wasm32v1-none --release
cargo build -p cosmic_coder --target wasm32v1-none --release
```

Artifacts: `target/wasm32v1-none/release/groth16_verifier.wasm`, `target/wasm32v1-none/release/cosmic_coder.wasm`.

## Deploy & simulate (demo script)

Use **Stellar CLI** with `--network testnet` for deploy; `--sim-only` to validate without sending.

### Deploy verifier

```bash
stellar contract deploy --source-account <SOURCE> --wasm target/wasm32v1-none/release/groth16_verifier.wasm --network testnet
```

Save the returned contract ID as `VERIFIER_ID`.

### Deploy policy

```bash
stellar contract deploy --source-account <SOURCE> --wasm target/wasm32v1-none/release/cosmic_coder.wasm --network testnet
```

Save as `POLICY_ID`. Then init with Game Hub and call `set_verifier(VERIFIER_ID)`.

### Simulate submit_zk

Validates resource usage, events, and success without submitting:

```bash
stellar contract invoke --sim-only \
  --id <POLICY_ID> \
  --network testnet \
  -- submit_zk \
  --player <PLAYER_ADDRESS> \
  --proof '...' \
  --vk '...' \
  --pub_signals '...' \
  --nonce 1 \
  --run_hash <32_BYTES_HEX> \
  --season_id 1 \
  --score 100 \
  --wave 5
```

Output shows **resource usage**, **events** (e.g. `zk_run_submitted`), and **success** or error (VerifierNotSet, Replay, InvalidProof, etc.).

## Tests

```bash
cd contracts
cargo test -p groth16_verifier
cargo test -p cosmic_coder
```

## ZK full stack (circuit + prover + contract)

From repo root:

1. **Build circuit** (requires circom 2.x in PATH, e.g. `~/.cargo/bin`):  
   `npm run zk:build`
2. **E2E check** (circuit → proof → contract tests):  
   `npm run zk:e2e`
3. **Prover server** (for ranked submit):  
   `npm run server` → `POST http://localhost:3333/zk/prove` with `run_hash_hex`, `score`, `wave`, `nonce`, `season_id`.
4. **Frontend**: set `VITE_COSMIC_CODER_CONTRACT_ID` and `VITE_ZK_PROVER_URL` (e.g. `http://localhost:3333`) so ranked mode and submit ZK work.

## CAP / protocol

See root [README](../README.md) and [groth16_verifier/README.md](groth16_verifier/README.md). Verify CAP-0074 (BN254) and protocol version before deployment.
