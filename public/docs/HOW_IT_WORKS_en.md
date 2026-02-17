# Cosmic Coder — Technical Documentation

**Complete reference for game mechanics, zero-knowledge proofs, Stellar integration, and smart contracts.**

---

## Executive Summary

**Cosmic Coder** is a Vampire-Survivors-style survival game built on Phaser 3, with on-chain ranked mode on **Stellar/Soroban**. Gameplay runs entirely off-chain in the browser; only run outcomes (wave, score) are submitted to smart contracts upon death. Ranked submissions require a **Groth16 zero-knowledge proof** that cryptographically attests to the validity of the run. The system integrates with the Stellar Game Hub for session lifecycle and maintains a provably fair leaderboard.

**Core stack:** Phaser 3 (frontend) · Soroban/Rust (contracts) · Circom/snarkjs (ZK) · Freighter (Stellar wallet)

---

## Part 1 — Game Mechanics

### 1.1 Game Design

Cosmic Coder is a **wave-based survival game** in which the player controls a single character in a top-down arena. The objective is to survive as many waves as possible by defeating enemies, levelling up, and collecting weapons. All game logic executes client-side; the blockchain is used solely for score verification and leaderboard persistence.

**Design principles:**

- **Off-chain gameplay:** No latency, no gas during play. Combat, movement, and progression are handled locally.
- **On-chain verification:** Run outcomes are submitted only on death. The contract verifies legitimacy via ZK proof (ranked) or basic rules (casual).
- **Wallet-gated play:** A connected [Freighter](https://www.freighterapp.com/) wallet is required to start a run and submit to chain.

### 1.2 Controls and Core Loop

| Action | Input |
|--------|-------|
| Movement | WASD or Arrow keys |
| Attack | Automatic (no fire button) |
| Touch | Supported on mobile |

**Core loop:**

1. **Start run** → Wallet signs `start_match` → Contract registers session with Game Hub.
2. **Play** → Waves spawn; enemies grant XP; weapons and upgrades drop.
3. **Death** → Score = total XP. Client submits `submit_result` (casual) or `submit_zk` (ranked).
4. **Post-run** → BITS awarded; local and on-chain leaderboards updated.

### 1.3 Wave System

- **Wave number** (`wave`) increases with each completed wave (1, 2, 3, …).
- **Difficulty scaling:** Base enemy count and strength scale with wave. New enemy types join the pool at thresholds (e.g. `waveMin` per type).
- **Boss waves:** Fixed waves (e.g. 20, 40, 60, 80) spawn named bosses with higher HP and XP rewards.

### 1.4 Enemies and Stages

**Enemy types:** bug, glitch, syntax-error, infinite-loop, segfault, dependency-hell, plus named bosses (Stack Overflow, Null Pointer, Memory Leak Prime, Kernel Panic, etc.).

**Behaviours:** Chase, teleport, orbit, erratic movement, spawner, invisible phases.

**Stages:** Thematic zones (Debug Zone, Memory Banks, Network Layer, Kernel Space, Cloud Cluster, Singularity) change visuals by wave. Cosmetic only; no gameplay effect.

### 1.5 Weapons and Upgrades

**Weapons (in-run):** Collected from enemies and crates. Types include spread, pierce, orbital, rapid, homing, bounce, aoe, freeze, plus special (rmrf, sudo, forkbomb, sword, spear, boomerang, kunai). Each has attack rate, damage, projectile count, and effects. Weapons can **evolve** when certain combinations are held.

**Upgrades (permanent):** Purchased with BITS in the menu. Improve base stats (health, damage, speed, attack rate, XP gain, crit chance, duration). Apply to all future runs.

**Rebirth:** Optional prestige system; reset progress for permanent multipliers.

### 1.6 Score, Death, and Validation

- **Score = total XP** accumulated in the run. This is the value sent to the contract.
- **Validation rule:** `score ≥ wave × MIN_SCORE_PER_WAVE` (e.g. 10 per wave). Enforced client-side before submit and on-chain in the contract.
- **On death:** Local records updated; BITS awarded; on-chain submit attempted if wallet connected and contract configured.

### 1.7 Modes: Casual vs Ranked

| | Casual | Ranked (ZK) |
|--|--------|-------------|
| **Submit** | `submit_result(wave, score)` | `submit_zk(proof, vk, pub_signals, …)` |
| **Verification** | Rule check: `score ≥ wave × 10` | Groth16 proof verification |
| **When** | No prover, or "Continue" run | New run + prover + verifier contract |
| **Leaderboard** | Legacy (wave, score) | Per-season (score only) |

---

## Part 2 — Zero-Knowledge Proofs

### 2.1 Motivation

The game runs in the browser. The contract cannot observe gameplay. A client could claim "I reached wave 50 with 100,000 points" without proof. **Zero-knowledge proofs** allow the client to prove that it knows inputs satisfying a circuit (e.g. valid `run_hash`, `score`, `wave`) **without** revealing the private execution path.

**Security property:** The on-chain leaderboard does not trust the client. Acceptance depends solely on cryptographic verification of the proof.

### 2.2 Groth16 and BN254

**Groth16** is a zk-SNARK with constant-size proofs (three group elements) and constant-size verification keys. Verification cost is bounded and predictable, suitable for on-chain execution. See [Groth, 2016](https://eprint.iacr.org/2016/260).

**BN254** (alt_bn128) is the elliptic curve used for Groth16 in Cosmic Coder. Stellar/Soroban supports BN254 via [CAP-0074](https://stellar.github.io/stellar-protocol/master/core/cap-0074.html), enabling native pairing and group operations in the host.

### 2.3 Circuit Design

The circuit (`GameRun.circom`) defines a statement over **private inputs** and **public outputs**. Public outputs exposed to the contract:

| Index | Name | Description |
|-------|------|-------------|
| 0 | `run_hash_hi` | High 128 bits of run commitment |
| 1 | `run_hash_lo` | Low 128 bits of run commitment |
| 2 | `score` | Final score (u32) |
| 3 | `wave` | Final wave (u32) |
| 4 | `nonce` | Replay token (u64) |
| 5 | `season_id` | Season for leaderboard (u32) |

The circuit binds these values; the proof certifies that the prover ran the circuit with consistent inputs and obtained these outputs.

### 2.4 Proof Format

A Groth16 proof consists of three elements:

- **a** — G1 (64 bytes)
- **b** — G2 (128 bytes)
- **c** — G1 (64 bytes)

The verification key (VK) contains `alpha` (G1), `beta`, `gamma`, `delta` (G2), and `ic` (vector of G1 points). The verifier computes `vk_x = ic[0] + Σ(pub_signals[i] × ic[i+1])` and checks the pairing equation. See `zk_types` and `groth16_verifier` in the codebase.

### 2.5 Run Hash and Binding

`run_hash = H(player || wave || score || runSeed || timestamp)` (SHA-256)

- **runSeed:** Random value generated at run start; kept in memory for that run only.
- **Binding:** The proof binds to `run_hash` via public signals. The contract receives the same `run_hash` in `submit_zk`; the verifier ensures the proof matches.
- **Integrity:** Tampering with `score` or `wave` invalidates the proof; the pairing check fails.

### 2.6 Anti-Replay

- **ReplayKey = (player, nonce, season_id)**. Each successful `submit_zk` marks this key as used.
- A second submit with the same triple returns `Replay`; the verifier is not invoked.
- The nonce is a public signal of the circuit; the proof cannot be reused with a different nonce without recomputing.

### 2.7 Full Ranked Flow

1. **New run start** → Client generates `runSeed`; stores in memory.
2. **Play** → Waves, enemies, XP (all off-chain).
3. **Death** → Client computes `run_hash`; validates `(wave, score)` against rules.
4. **Proof request** → Client calls backend `POST /zk/prove` with `{ run_hash_hex, score, wave, nonce, season_id }`.
5. **Backend** → Builds `input.json`; runs snarkjs Groth16 prover; returns `contract_proof.json`.
6. **Submit** → Client signs and calls `submit_zk` on Shadow Ascension with proof, VK, pub_signals, nonce, run_hash, season_id, score, wave.
7. **Contract** → Anti-replay check; invoke Groth16 verifier; on success, update leaderboard, call Hub `end_game`, emit `zk_run_submitted`.

---

## Part 3 — Stellar and Soroban

### 3.1 Stellar Network

[Stellar](https://stellar.org) is a public blockchain for fast, low-cost payments and assets. [Soroban](https://soroban.stellar.org) is Stellar’s smart contract platform, with Rust-based contracts and a deterministic runtime.

### 3.2 Wallet Integration (Freighter)

[Freighter](https://www.freighterapp.com/) is a Stellar wallet extension. Cosmic Coder uses it for:

- **Connection:** Player connects wallet on the title screen.
- **Signing:** `start_match` and `submit_zk` / `submit_result` require the player’s signature.
- **Authorization:** All on-chain actions are authorized by the wallet; the contract enforces `player.require_auth()`.

### 3.3 Game Hub Integration

The **Stellar Game Hub** (`CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` on Testnet) is the reference contract for game session lifecycle:

- **start_game(game_id, session, player, system_player, x, y)** — Called by Shadow Ascension on `start_match`.
- **end_game(session, success)** — Called after `submit_result` or successful `submit_zk`.

This integration ensures compliance with the Stellar Game Studio standard.

### 3.4 Testnet

The game targets **Stellar Testnet** for development and judging. RPC and network IDs are configured for Testnet; mainnet deployment would require updated configuration.

---

## Part 4 — Smart Contracts

### 4.1 Architecture

| Component | Role |
|-----------|------|
| **shadow_ascension** | Policy contract. Entry points: `start_match`, `submit_result`, `submit_zk`, `get_leaderboard`. Manages replay storage, leaderboard updates, and Game Hub calls. |
| **groth16_verifier** | Stateless verifier. Accepts (VK, proof, pub_signals); runs BN254 pairing check; returns `Ok(true)` or `Err`. |
| **zk_types** | Shared crate. Types: `ZkProof`, `ZkVerificationKey`; errors: `Groth16Error`, etc. |

### 4.2 Shadow Ascension — Main Functions

- **init(game_hub)** — Stores Game Hub address. Verifier is set separately via `set_verifier`.
- **start_match(player)** — Requires auth. Increments session; calls Hub `start_game`.
- **submit_result(player, wave, score)** — Requires auth. Checks `score ≥ wave × MIN_SCORE_PER_WAVE`; calls Hub `end_game`; updates legacy leaderboard.
- **submit_zk(player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave)** — Requires auth. Validates VK shape, score > 0, wave > 0; checks anti-replay; invokes verifier; on success, updates per-season leaderboard, calls Hub `end_game`, emits `zk_run_submitted`.
- **get_leaderboard(season_id)** — Returns ranked entries for that season, sorted by score descending.

### 4.3 Groth16 Verifier

- Validates `vk.ic.len() == pub_signals.len() + 1`.
- Deserializes proof (a, b, c) and VK (alpha, beta, gamma, delta, ic).
- Computes `vk_x`; runs `env.crypto().bn254().pairing_check(...)`.
- Returns `Ok(true)` if pairing equation holds; else `Ok(false)` or `Err`.

### 4.4 Storage Model

- **Replay:** One persistent entry per `(player, nonce, season_id)`.
- **Leaderboard (ranked):** Keyed by `LeaderboardKey { season_id }`; value is sorted vector of `ScoreEntry { player, score }`.
- **Leaderboard (casual):** Single `Leaderboard` symbol with `LeaderboardEntry { player, wave, score }`.

---

## Part 5 — References

- **Stellar Protocol — CAP-0074 (BN254):** https://stellar.github.io/stellar-protocol/master/core/cap-0074.html
- **Circom:** https://docs.circom.io
- **snarkjs:** https://github.com/iden3/snarkjs
- **Freighter:** https://www.freighterapp.com/
- **Soroban:** https://soroban.stellar.org

---

*Cosmic Coder — Technical Documentation · Version 0.7.x*
