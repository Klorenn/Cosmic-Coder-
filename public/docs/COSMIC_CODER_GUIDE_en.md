# Cosmic Coder — Complete Guide

**Reference and usage documentation. Version 0.7.x**

---

## 1. Introduction

**Cosmic Coder** is a Vampire-Survivors-style survival game built on Phaser 3 and Stellar/Soroban. You control a character in a top-down arena, clear waves of enemies, level up, unlock weapons and upgrades, and attempt to survive as many waves as possible. When you die, your run is recorded locally and, if a wallet is connected and the contract is configured, on-chain. The game supports two on-chain modes: **casual** (basic rule check) and **ranked** (zero-knowledge proof verification).

**Requirements:** A [Freighter](https://www.freighterapp.com/) wallet must be connected on the title screen to play and submit to chain.

---

## 2. Gameplay Fundamentals

### 2.1 Controls

| Action | Input |
|--------|-------|
| Movement | WASD or Arrow keys |
| Attack | Automatic (no fire button) |
| Touch | Mobile supported |

### 2.2 Core Loop

1. **Start Game** — Connect Freighter; sign `start_match`. The contract registers your session with the Stellar Game Hub.
2. **Play** — Waves spawn; enemies grant XP; weapons and upgrades drop. Score = total XP accumulated.
3. **Death** — Run ends. If wallet and contract are configured, the client attempts an on-chain submission (casual or ranked).
4. **Post-Run** — BITS are awarded; local and on-chain leaderboards are updated.

### 2.3 Waves and Difficulty

- Each wave increases difficulty: more base enemies and higher scaling.
- Enemy types join the pool at defined wave thresholds (`waveMin`).
- Boss waves (e.g. 20, 40, 60, 80) spawn named bosses with higher HP and XP rewards.

### 2.4 Weapons

- **Basic:** Single projectile; starting weapon.
- **Collected:** spread, pierce, orbital, rapid, homing, bounce, aoe, freeze; special (rmrf, sudo, forkbomb, sword, spear, boomerang, kunai).
- **Evolution:** Certain weapon combinations can evolve into stronger variants.
- Each weapon has attack rate, damage, projectile count, and effects.

### 2.5 Upgrades (Permanent)

Purchased with BITS in the main menu. Improve base stats (health, damage, speed, attack rate, XP gain, crit chance, duration). Apply to all future runs.

### 2.6 Rebirth

Optional prestige system. Reset progress in exchange for permanent multipliers. Advanced feature.

---

## 3. Score and On-Chain Submission

### 3.1 Score Definition

**Score = total XP** accumulated in the run. This is the value sent to the contract as `score`. The contract uses it for leaderboard ranking and validation.

### 3.2 Validation Rule

Both the client and the contract enforce:

**score ≥ wave × MIN_SCORE_PER_WAVE** (default 10 per wave)

This prevents submissions with unreasonably low score for the wave reached. For example: wave 5 requires at least 50 score; wave 10 requires at least 100.

### 3.3 Casual vs Ranked

| Mode | When Used | What Is Sent | On-Chain Verification |
|------|-----------|--------------|------------------------|
| **Casual** | No ZK prover, or "Continue" run | `submit_result(wave, score)` | Rule check: score ≥ wave × 10 |
| **Ranked** | New run + prover configured + verifier contract | `submit_zk(proof, vk, pub_signals, …)` | Groth16 proof verification |

**For ranked:** Start a **new** run (not "Continue"). The run needs a `runSeed` generated at start; "Continue" runs do not have a fresh runSeed and therefore cannot produce a ZK proof.

---

## 4. Zero-Knowledge (ZK) in Cosmic Coder

### 4.1 Why ZK?

The game runs in the browser. The contract cannot observe your run. If the client only sent "I reached wave 50 with 100,000 points", anyone could submit false data. **Zero-knowledge proofs** allow the client to prove that it knows inputs satisfying a circuit (valid run_hash, score, wave) **without** revealing the private execution path.

**Security property:** The contract does not trust the client. Acceptance depends solely on cryptographic verification of the proof.

### 4.2 Groth16 and BN254

- **Groth16:** zk-SNARK with constant-size proofs and verification keys. Widely used (e.g. Ethereum); mature tooling (Circom, snarkjs).
- **BN254:** Elliptic curve used for Groth16 in Cosmic Coder. Stellar/Soroban supports BN254 via [CAP-0074](https://stellar.github.io/stellar-protocol/master/core/cap-0074.html).

### 4.3 Circuit and Proof

- **Circuit (Circom):** Defines the statement. Public outputs: `run_hash_hi`, `run_hash_lo`, `score`, `wave`, `nonce`, `season_id`.
- **Proof (Groth16):** Short certificate (three group elements) proving "I ran the circuit with these inputs and got these outputs".
- **Verification:** The Groth16 verifier contract checks the pairing equation. If it holds, the policy contract accepts and updates the leaderboard.

### 4.4 Run Hash

`run_hash = H(player || wave || score || runSeed || timestamp)` (SHA-256)

- **runSeed:** Random value generated at run start; kept in memory for that run only.
- **Binding:** The proof binds to this run_hash; tampering with score or wave invalidates the proof.

### 4.5 Anti-Replay

- Each ranked submit uses a unique **nonce** (e.g. timestamp).
- The contract stores **ReplayKey = (player, nonce, season_id)**.
- Duplicate submits with the same triple return `Replay`; the verifier is not invoked.
- The nonce is a public signal of the circuit; the proof cannot be reused with another nonce without generating a new proof.

### 4.6 Full Ranked Flow

1. New run start → Client generates `runSeed`; stores in memory.
2. Play → Waves, enemies, XP (all off-chain).
3. Death → Client computes `run_hash`; validates (wave, score).
4. Proof request → Client calls backend `POST /zk/prove` with run_hash_hex, score, wave, nonce, season_id.
5. Backend → Runs snarkjs Groth16 prover; returns contract_proof.json.
6. Submit → Client signs and calls `submit_zk` on Shadow Ascension with proof, VK, pub_signals, nonce, run_hash, season_id, score, wave.
7. Contract → Anti-replay check; invokes Groth16 verifier; on success, updates leaderboard, calls Game Hub `end_game`, emits `zk_run_submitted`.

---

## 5. Stellar and Soroban

### 5.1 Stellar Network

[Stellar](https://stellar.org) is a public blockchain for fast, low-cost payments. [Soroban](https://soroban.stellar.org) is Stellar's smart contract platform.

### 5.2 Freighter Wallet

[Freighter](https://www.freighterapp.com/) is a Stellar wallet extension. Used for connection, signing `start_match` and `submit_zk`/`submit_result`, and authorization of all on-chain actions.

### 5.3 Game Hub Integration

The Stellar Game Hub manages session lifecycle. Shadow Ascension calls `start_game` on match start and `end_game` on match end, ensuring compliance with the Stellar Game Studio standard.

### 5.4 Testnet

The game targets Stellar Testnet for development and judging.

---

## 6. Contracts Overview

| Contract | Role |
|----------|------|
| **shadow_ascension** | Policy: start_match, submit_result, submit_zk, get_leaderboard. Replay, leaderboard, Hub calls. |
| **groth16_verifier** | Stateless BN254 proof verification. |
| **zk_types** | Shared ZK types and errors. |

**Main functions:**

- **start_match(player)** — Registers session; calls Hub start_game.
- **submit_result(player, wave, score)** — Casual submit; rule check; calls Hub end_game.
- **submit_zk(...)** — Ranked submit; anti-replay; invokes verifier; updates leaderboard; calls Hub end_game.
- **get_leaderboard(season_id)** — Returns ranked entries for that season.

---

## 7. Further Documentation

- **HOW_IT_WORKS_en.md** — Complete technical documentation.
- **TECHNICAL_DOCUMENTATION.md** — Formal reference (circuit, VK, pairing, security).
- **ZK_AND_BALANCE.md** — ZK flow, anti-replay, validation rules.
- **ZK_REAL_SETUP.md** — Requirements, circuit build, scripts, checklist.

---

*Cosmic Coder — Complete Guide · Version 0.7.x*
