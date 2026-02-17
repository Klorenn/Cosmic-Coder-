# Groth16 Verifier (BN254)

Single-responsibility contract: verify Groth16 proofs on the BN254 curve. No game or leaderboard logic. Uses shared types from `zk_types`.

- **CAP**: [CAP-0074](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md) (BN254)
- **SDK**: [soroban_sdk::crypto::bn254](https://docs.rs/soroban-sdk/latest/soroban_sdk/crypto/bn254/) — pairing_check, g1_add, g1_mul
- **Protocol**: Verify network supports BN254 before deploy — [Networks / software versions](https://developers.stellar.org/docs/networks/software-versions)

## Build

```bash
rustup target add wasm32v1-none
cd contracts
cargo build -p groth16_verifier --target wasm32v1-none --release
```

## Deploy

Deploy the WASM to Stellar Testnet, then call the game policy contract's `set_verifier(verifier_id)` with this contract's ID.

## Resource simulation

Simulate cost with a real proof payload (replace with your vk/proof/pub_signals):

```bash
stellar contract invoke \
  --id <VERIFIER_ID> \
  --source <SIGNER> \
  --network testnet \
  --sim-only \
  -- verify_proof \
  --vk '...' \
  --proof '...' \
  --pub_signals '...'
```

Document the resulting CPU/memory envelope in your deployment runbook.

## Unit tests

- **Malformed VK rejected**: `ic.len() != pub_signals.len() + 1` → Err
- **Invalid proof**: pairing fails → false
- **Valid proof**: returns bool (point-at-infinity may pass)

```bash
cargo test -p groth16_verifier
```
