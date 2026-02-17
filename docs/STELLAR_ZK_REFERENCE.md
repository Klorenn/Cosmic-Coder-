# Zero-Knowledge Proofs on Stellar (Reference)

Reference for ZK proof patterns on Stellar/Soroban. **Status-sensitive** — always verify CAP status and network support before implementation.

## Source-of-Truth Checks (Required)

1. **CAP status** in `stellar/stellar-protocol` — Accepted/Implemented or draft?
2. **Target network** protocol version supports required primitives
3. **soroban-sdk** version includes crypto host function bindings
4. **Production examples** exist for your proving system

### Key CAPs

| CAP | Primitive | Purpose |
|-----|-----------|---------|
| [CAP-0059](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0059.md) | BLS12-381 | Pairing-based ZK |
| [CAP-0074](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md) | BN254 | Groth16/PLONK |
| [CAP-0075](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0075.md) | Poseidon/Poseidon2 | ZK-friendly hash |

Protocol versions: https://developers.stellar.org/docs/networks/software-versions

## Architecture Patterns

- **Verification Gateway**: Dedicated verifier contract; small audit surface.
- **Policy-and-Proof Split**: Verifier (crypto only) → Policy (business) → Application (state).
- **Feature flags**: Gate ZK by `is_zk_supported(&env)`; deterministic fallback for unsupported networks.

## Anti-Replay

- Bind proofs to **nonce** (and optionally run_hash, season_id).
- Persist used nonces in contract storage; reject replay.

## Common Pitfalls

- **Over-trusting payload shape**: Validate public-input semantics and statement domain.
- **Missing anti-replay**: Bind proof to session/nonce/action; persist replay guards.
- **Monolithic contract**: Keep verifier logic isolated (Policy-and-Proof Split).
- **Hardcoded protocol assumptions**: Capability-gate; verify at deployment; test on target network.

## Example Repositories

- [Soroban Examples](https://github.com/stellar/soroban-examples) — groth16_verifier, privacy-pools
- [Soroban SDK BN254](https://docs.rs/soroban-sdk/latest/soroban_sdk/crypto/bn254/)

## Integration Checklist

- [ ] Target network supports required primitives (check CAP status)
- [ ] Proof statement includes anti-replay binding (nonce/context)
- [ ] Full simulation path covered (proof + policy + state)
- [ ] Negative-path tests for malformed/tampered inputs
- [ ] Fallback behavior defined for unsupported environments
