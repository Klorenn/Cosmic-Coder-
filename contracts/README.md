# Contracts (ZK Ranked Mode)

Layout:

- **zk_types** — Shared ZK types only (`Groth16Error`, `ZkProof`, `ZkVerificationKey`). No duplicated definitions; used by verifier and policy.
- **groth16_verifier** — BN254 Groth16 verification only. No game logic, no leaderboard, no replay.
- **shadow_ascension** — Game policy: verifier address, anti-replay (player + nonce + season_id), calls verifier, leaderboard, events. Legacy `submit_result` for casual mode.

## Build (WASM)

Use **rustup’s cargo** (e.g. `export PATH="$HOME/.cargo/bin:$PATH"`) so the `wasm32-unknown-unknown` target is available. Homebrew cargo can lack the target and fail with "can't find crate for \`core\`".

```bash
rustup target add wasm32-unknown-unknown
cd contracts
cargo build -p zk_types
cargo build -p groth16_verifier --target wasm32-unknown-unknown --release
cargo build -p shadow_ascension --target wasm32-unknown-unknown --release
```

Artifacts: `target/wasm32-unknown-unknown/release/groth16_verifier.wasm`, `target/wasm32-unknown-unknown/release/shadow_ascension.wasm`.

## Deploy & simulate (demo script)

Use **Stellar CLI** with `--network testnet` for deploy; `--sim-only` to validate without sending.

### Deploy verifier

```bash
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/groth16_verifier.wasm --network testnet
```

Save the returned contract ID as `VERIFIER_ID`.

### Deploy policy

```bash
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/shadow_ascension.wasm --network testnet
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
cargo test -p shadow_ascension
```

## CAP / protocol

See root [README](../README.md) and [groth16_verifier/README.md](groth16_verifier/README.md). Verify CAP-0074 (BN254) and protocol version before deployment.
