# Ranked ZK system (formal): why ZK, Stellar/Soroban, contracts, and on-chain verification

**Status:** normative description of the ranked pipeline for Cosmic Coder.  
**Scope:** what is proven, what is verified on-chain, and how any third party can audit the result.

---

## 1. Why ZK is fundamental in Cosmic Coder

Cosmic Coder runs in the **player’s browser**. This creates an unavoidable integrity problem:

- The game engine state (enemy spawns, collisions, XP gain) is not observable by the network.
- A client can be modified to report arbitrary outcomes (e.g., “wave=999, score=9,999,999”).
- A centralized server could validate runs, but then the leaderboard becomes **trust-based** (operator-controlled).

The ranked system therefore requires **public verifiability**:

- A ranked result must be accepted only if it is accompanied by a cryptographic proof.
- The proof must be verifiable by an on-chain contract so that *anyone* can audit acceptance.

Zero-knowledge proofs (zk-SNARKs) provide this: a run outcome is accepted if and only if the on-chain verifier validates a proof for the declared public signals.

---

## 2. Security model and threat model

### 2.1 Trust assumptions

The ranked system assumes:

- The Soroban network executes contracts deterministically and publishes transaction effects.
- The **verifier contract** (zk_verifier) is the authoritative proof checker (BN254).
- The **policy contract** is the authoritative enforcer of replay protection and leaderboard updates.

### 2.2 Adversary capabilities

An adversary may:

- Fully control and modify the browser client.
- Attempt to submit fabricated scores.
- Attempt to replay previously accepted proofs / reuse nonces.
- Attempt to submit malformed VK / proof blobs.

The system is designed so that:

- Fabricated outcomes are rejected by on-chain proof verification.
- Replay attempts are rejected by on-chain anti-replay state.
- Verification is auditable by any third party from public chain data.

---

## 3. Components (what exists and why)

### 3.1 Client (browser / Phaser)

Responsibilities:

- Run the game loop off-chain.
- Maintain the run’s **commitment seed** (`runSeed`) for a new run.
- At run end, compute `run_hash` and build the ranked submission payload.
- Request proof generation (backend prover or local trustless prover).
- Sign and submit the ranked transaction to the policy contract.

### 3.2 Prover (off-chain service or trustless browser prover)

Responsibilities:

- Generate a Groth16 proof for the circuit statement given the public signals.
- Output data in the format expected by Soroban contracts.

In “backend prover mode”, the prover is a web service. In “trustless mode”, the proof is generated locally in the browser (requires shipping circuit artifacts).

### 3.3 Policy contract: `cosmic_coder`

Responsibilities:

- Store the verifier contract address.
- Enforce **anti-replay** keyed by `(player, nonce, season_id)`.
- Invoke the verifier contract for proof validation.
- Update the ranked leaderboard for the season.
- Emit events for external indexing/auditing.

This separation is intentional: policy contains *game and ranking policy*, the verifier contains *only cryptography*.

### 3.4 Verifier contract: `zk_verifier`

Responsibilities:

- Verify ZK proofs over BN254 (CAP-0074 host crypto).
- Accept `(vk, proof, pub_signals)` and return a boolean.

It must be free of game logic, replay logic, or leaderboard updates. This makes verification reusable and minimizes the trusted surface area.

### 3.5 Shared types: `zk_types`

Responsibilities:

- Provide a single shared definition of `ZkProof`, `ZkVerificationKey`, and verifier errors.
- Avoid ABI drift across policy and verifier contracts.

---

## 4. Public signals and what is being proven

The ranked circuit exposes a set of **public signals**, serialized as 32-byte field elements (BN254 scalar field).

At minimum, ranked verification binds to:

- `run_hash` (run commitment),
- `score` and `wave`,
- `nonce` (anti-replay),
- `season_id` (which leaderboard to update).

### 4.1 Run commitment (`run_hash`)

The client computes:

\[
run\_hash = SHA256(player \;||\; wave \;||\; score \;||\; runSeed \;||\; timestamp)
\]

The purpose is binding: the proof and the on-chain submission must refer to the same commitment, so the prover cannot swap the score/wave independently of the run hash.

---

## 5. Ranked submission protocol (end-to-end)

1. **New run begins**  
   Client generates `runSeed` and keeps it for the duration of that run.

2. **Run ends**  
   Client computes `run_hash` and selects a fresh `nonce`.

3. **Proof generation**  
   Client requests proof generation (backend or trustless).

4. **On-chain submit**  
   Client sends a transaction to the policy contract (ranked submit method) including:
   - `proof`
   - `vk`
   - `pub_signals` (public inputs)
   - `nonce`, `season_id`, `score`, `wave`, `run_hash` (or their committed representation)
   - `player` authorization (wallet signature)

5. **Policy contract checks**  
   The policy contract enforces:
   - input sanity (non-zero score/wave, correct VK shape),
   - replay protection,
   - verifier invocation success.

6. **Verifier checks**  
   The verifier contract performs the BN254 pairing check. If valid, it returns `true`.

7. **State update + events**  
   On success the policy updates:
   - replay storage for `(player, nonce, season_id)`,
   - ranked leaderboard vector for `season_id`,
   - emits a ranked submission event (e.g. `zk_run_submitted`).

---

## 6. How to verify everything on-chain (third-party audit)

The key property of this design is that verification is **public**. Anyone can check:

### 6.1 The ranked submit transaction exists

- Find the transaction hash from the client UI/logs.
- Inspect it in a Soroban explorer (e.g., Stellar Expert on testnet).

You should see:

- an invocation of the policy contract method (ranked submit),
- nested invocations (subcalls) to the verifier contract.

### 6.2 The verifier was called and returned success

On Soroban, contract invocations are part of the transaction result. A third party can:

- confirm that the policy contract invoked the verifier method,
- confirm the verifier returned `true`,
- confirm the transaction status is `SUCCESS`.

### 6.3 Replay protection was applied

After a successful ranked submission:

- resubmitting the same `(player, nonce, season_id)` must fail with a replay error.

This is auditable by simulating or sending a second submission attempt with the same replay key.

### 6.4 Leaderboard storage was updated

The ranked leaderboard is stored on-chain per season. A third party can:

- call the policy contract’s read-only leaderboard method (e.g., `get_leaderboard_by_season(season_id, limit)`),
- verify that the player address appears with the expected score ordering.

### 6.5 Events were emitted

Successful ranked submissions emit an event with:

- player address
- season id
- score and wave
- run hash bytes

Events are part of the transaction output and can be indexed by off-chain services.

---

## 7. Practical notes (correctness and clarity)

- **Proof validity is binary**: either the verifier returns `true` for the exact `(vk, proof, pub_signals)` or it does not. There is no “partial trust”.
- **ZK does not prove the entire gameplay**: it proves the run outcome satisfies the circuit statement. The statement must be designed to capture the anti-cheat rules you care about.
- **On-chain verifiability is the product**: any leaderboard that cannot be audited on-chain is not ranked in this sense.

---

## Appendix A — Code references in this repository

- Policy contract: `contracts/cosmic_coder/src/lib.rs`
- Verifier contract: `contracts/zk_verifier/src/lib.rs`
- Shared types: `contracts/zk_types/src/lib.rs`
- Frontend ranked submit integration: `src/scenes/ArenaScene.js`, `src/contracts/gameClient.js`
- Prover endpoints (backend mode): `server/index.js` (`POST /zk/prove`, `/health`)

