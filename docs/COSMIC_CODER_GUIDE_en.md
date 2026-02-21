# Cosmic Coder — Formal game, Stellar, and ZK guide

**Version:** 0.8.x · Formal reference documentation (game + Stellar/Soroban + ZK ranked system).

---

## Part 1 — Game overview (off-chain runtime)

### 1.1 What is Cosmic Coder

**Cosmic Coder** is a browser-based survival game (Vampire-Survivors-like). You control one character in an arena, defeat enemies across successive waves, gain XP, and collect weapons/modifiers. Difficulty increases with the wave number. The game logic executes **off-chain** in the browser (Phaser). On-chain actions are only performed for session lifecycle and/or leaderboard submission.

- **Primary goal**: survive as many waves as possible and maximize total XP, which is the **score** used for ranking.
- **Wallet requirements**:
  - You can play the game without a wallet in **local-only** mode.
  - To appear on **public leaderboards** or submit **ranked ZK** results, you must connect a Stellar wallet (Freighter) and sign transactions.
- **Scoring**: the run score is defined as **total XP** accumulated during the run.

---

### 1.2 Controls and basic flow

- **Movement:** WASD or arrow keys (or touch controls on mobile).
- **Attack:** Automatic based on the equipped weapon; there is no fire button.
- **Waves:** Every so often a new wave spawns with more and/or tougher enemies. The wave number (`wave`) increases (1, 2, 3, …).
- **XP and score:** Enemies grant XP when killed; your **score** for the run is the **total XP** accumulated (used as *score* in the contract).
- **Death:** When your health reaches 0, the run ends. Local records are updated. If configured, the game may submit your outcome to the Stellar/Soroban ranked system. You also earn BITS (in-game currency) based on wave, kills, and XP.

---

### 1.3 Waves, enemies, and stages

- **Waves:** Each wave increases difficulty: more base enemies per wave and enemy types that join the pool by `waveMin` (e.g. bugs from wave 0, glitch from 3, “memory-leak” from 5, etc.).
- **Enemies:** Many types (bug, glitch, syntax-error, infinite-loop, segfault, dependency-hell, bosses, etc.) with different behaviours: chase, teleport, orbit, erratic, spawner, invisible, etc.
- **Bosses:** Appear at fixed waves (e.g. Stack Overflow at 20, Null Pointer at 40, Memory Leak Prime at 60, Kernel Panic at 80). They give a lot of XP and are a difficulty spike.
- **Stages:** The world has thematic stages that change the look by wave (Debug Zone, Memory Banks, Network Layer, Kernel Space, Cloud Cluster, Singularity). They are cosmetic only.

---

### 1.4 Weapons and upgrades

- **Weapons:** You start with a basic shot. During the run you can pick up weapons from enemies or crates: spread, pierce, orbital, rapid, homing, bounce, aoe, freeze, and special weapons (rmrf, sudo, forkbomb, sword, spear, boomerang, kunai, etc.). Each weapon has attack rate, damage, projectile count, and special effects.
- **Upgrades:** Bought with BITS from the main menu (outside the run). They improve base stats (health, damage, speed, etc.) and apply to all future runs.
- **Rebirth:** A “reset” system that unlocks more power in exchange for resetting progress; optional and advanced.

---

### 1.5 Persistence: records, saves, and continuation

- **Score = total XP** for the run. This is the value sent to the contract as `score`.
- **Local records**: high wave and high score are stored locally and optionally synchronized when a wallet is connected (backend progress API).
- **Run save (“Continue”)**: the game auto-saves at wave completion. Continuing restores a snapshot of your run state (wave, weapon state, health, run seed, etc.).
- **Ranked constraint**: ranked ZK submission is designed for **new runs**. A continued run is treated as non-ranked for submission purposes.

---

### 1.6 Submission modes: legacy vs ranked (ZK)

| | Casual | Ranked (ZK) |
|--|--------|-------------|
| **What is sent** | `submit_result(wave, score)` | `submit_zk(proof, vk, pub_signals, …)` |
| **On-chain check** | Basic rules (score, wave) | ZK proof verification (zk_verifier) |
| **When used** | No ZK prover or “Continue” run | **New** run + prover configured + contract with verifier |
| **Leaderboard** | Legacy (wave + score) | Per season (season_id), score only |

For ranked (ZK), all of the following must be true:
- A Stellar wallet is connected and can sign.
- A policy contract is configured (`VITE_COSMIC_CODER_CONTRACT_ID`).
- A prover service is reachable (`VITE_ZK_PROVER_URL` or trustless mode).
- The run is a **new** run (not a continuation).

---

## Part 2 — Stellar/Soroban integration (identity, sessions, leaderboards)

### 2.1 Identity and authentication (SEP-10)

Cosmic Coder uses **Stellar SEP-10 Web Authentication** to establish a backend session associated with a Stellar public key (the wallet address). This provides:
- a standard wallet signature challenge/response flow,
- a server-issued session token,
- a consistent identity for progress persistence and optional API features.

The in-game ranked path will prompt wallet signatures when needed and may attempt to establish a SEP-10 session before starting a ranked match.

### 2.2 Soroban contracts (ranked policy + verifier)

The ranked system is implemented on Soroban as two main contracts:
- **Policy contract (Cosmic Coder / Shadow Ascension)**: orchestrates ranked submission, replay protection, and leaderboard updates.
- **Verifier contract (zk_verifier, BN254)**: verifies the proof and public signals; it is intended to be stateless and free of game logic.

The policy contract is the entry point for ranked runs and enforces anti-replay by tracking nonces per player and season.

### 2.3 Leaderboards: legacy vs ranked

The project maintains two leaderboards:
- **Legacy leaderboard** (non-ZK): records `(player, wave, score)` for non-ranked submissions.
- **Ranked leaderboard** (ZK, per season): records `(player, score)` for successful ZK submissions, keyed by `season_id`.

The UI may also display a simple API-backed leaderboard for convenience; the authoritative ranked leaderboard is on-chain.

---

## Part 3 — How ZK ranked works (formal description)

### 3.1 Purpose of ZK in a browser game

In a game that runs in the browser, the server/contract cannot “see” your run. If you only sent “I reached wave 50 with 100,000 points”, anyone could lie. With **zero-knowledge (ZK)**:

- You **prove** that you know data (wave, score, run_hash, nonce, season_id) that satisfy the circuit **without revealing** how you played step by step.
- The **contract** only receives a **proof** and the **public signals** (those numbers). It verifies the proof with a **verification key (VK)**. If the pairing equation holds, it accepts that the run is valid for that score/wave/run_hash/nonce/season.
- So the on-chain ranking does not rely on trusting the client: the mathematical proof guarantees that the result is consistent with the circuit (same run_hash, score, wave, nonce, season_id).

---

### 3.2 Circuit and proof (Groth16, BN254)

- **Circuit (Circom):** A program that defines a “statement”: given some **private inputs** and **public outputs**, the circuit checks relations between them. In Cosmic Coder, the circuit `GameRun.circom` exposes as **public outputs**:
  - `run_hash_hi`, `run_hash_lo` (run commitment),
  - `score`, `wave`, `nonce`, `season_id`.
- **Proof (Groth16):** A short certificate (three group elements: a, b, c) that proves “I ran the circuit with these inputs and got these public outputs”. Anyone with the **verification key (VK)** can check on-chain that the proof matches those public signals **without** re-running the circuit.
- **On-chain verification:** The **zk_verifier** contract receives (VK, proof, pub_signals), computes the linear combination `vk_x` from the public signals, and checks the pairing equation. If it holds, it returns “valid”; the policy contract (Cosmic Coder) then marks the nonce as used, updates the season leaderboard, and emits the event.

---

### 3.3 Ranked run flow (client → prover → contract)

1. **Run start (new):** The client generates a random **runSeed** and keeps it in memory for that run.
2. **You play:** Waves, enemies, XP, etc. (all off-chain).
3. **Death:** The client computes:
   - `run_hash = H(player || wave || score || runSeed || timestamp)` (SHA-256).
   - Validates that (wave, score) satisfy game rules.
4. **Proof generation:** either:
   - **Backend prover mode:** the client calls the prover service with `run_hash_hex`, `score`, `wave`, `nonce`, `season_id`. The prover generates a proof and returns it in the format expected by the contract.
   - **Trustless mode (optional):** the client generates a proof locally in the browser (requires circuit artifacts to be available).
5. **On-chain submit:** the client signs and calls `submit_zk` (or an equivalent ranked method) on the policy contract with:
   - proof, VK, pub_signals,
   - nonce, run_hash (32 bytes), season_id, score, wave,
   - authorized as `player`.
6. **In the contract:**
   - It checks that the verifier is set, that the VK has the right shape (`ic.len() == pub_signals.len() + 1`), and that score > 0 and wave > 0.
   - It checks anti-replay: if (player, nonce, season_id) is already used, it returns `Replay`.
   - It calls the **zk_verifier** with (VK, proof, pub_signals). If it returns `true`, it marks the nonce as used, updates the season leaderboard, calls the Game Hub `end_game`, and emits `zk_run_submitted`.

The entire ranked flow is tied: same run_hash/score/wave/nonce/season in the proof and in the contract, and the proof is only valid for those values.

---

### 3.4 Run commitment (`run_hash`) and binding

- **run_hash** is the run commitment: it ties together player, wave, score, run seed, and timestamp. The circuit does not “recompute” run_hash in detail; the public signals include run_hash_hi and run_hash_lo so the contract and proof are bound to the same commitment.
- On the client, `run_hash` is computed with `computeGameHash(playerAddress, wave, score, runSeed, timestamp)`. The backend generates the proof with that run_hash (and the other inputs); the contract receives the same run_hash in `submit_zk` for consistency.

---

### 3.5 Replay protection (nonce)

- Each ranked submit uses a **nonce** (e.g. timestamp). The contract stores `ReplayKey = (player, nonce, season_id)`. If you submit again with the same (player, nonce, season_id), the contract returns `Replay` and does not call the verifier.
- The proof includes the nonce as a public signal; you cannot reuse the same proof with a different nonce without generating a new proof. This prevents submitting the same run multiple times to inflate the leaderboard.

---

### 3.6 Parameters and references

- **Circuit:** 6 public outputs (run_hash hi/lo, score, wave, nonce, season_id). VK with `ic` of length 7.
- **Proof:** Groth16 (a, b, c); verification with BN254 on Soroban.
- **Contracts:** `zk_types` (shared types), `zk_verifier` (proof verification only), `cosmic_coder` (policy: replay, leaderboard, events, Hub).
- **Detailed references:** `TECHNICAL_DOCUMENTATION.md`, `ZK_REAL_SETUP.md`, `DEPLOY_GITHUB_IO.md`, and `SEP10_AUTH.md`.

---

## Part 4 — Public on-chain verification (how anyone can audit ranked results)

Cosmic Coder’s ranked mode is designed so that verification does not depend on trusting the client or a server. A third party can audit a ranked submission using only public chain data.

### 4.1 What “verifiable on-chain” means here

For a ranked run to be considered valid, all of the following must be true on-chain:

- The policy contract transaction is successful.
- The policy contract invoked the verifier contract.
- The verifier returned `true` for the submitted `(vk, proof, pub_signals)`.
- Replay protection was applied for `(player, nonce, season_id)`.
- The per-season leaderboard storage was updated deterministically.
- A ranked submission event was emitted (for indexing / transparency).

### 4.2 How to audit a specific ranked submission

Given a transaction hash (from the client logs or UI):

1. Open the transaction in a Soroban explorer (e.g. Stellar Expert on testnet).
2. Confirm the invocation target is the **policy contract** (Cosmic Coder).
3. Inspect nested invocations and confirm the **verifier contract** method was called.
4. Confirm the transaction result is `SUCCESS`.
5. Check emitted events for a ranked submission payload (player, season, score, wave, run hash).

### 4.3 How to audit leaderboard state

Independently of events, you can audit state:

- Call the policy contract read-only method `get_leaderboard_by_season(season_id, limit)` and verify:
  - the player address appears,
  - the score ordering is descending and deterministic.

### 4.4 Replay protection audit

Replay protection is not a “best effort” feature. It is part of the ranked definition:

- If the same `(player, nonce, season_id)` is resubmitted, the policy contract must reject it (Replay).

This can be validated via simulation or by observing a rejected resubmission attempt.

---

*End of guide. For implementation details, contract interfaces, and deployment steps, use the technical documentation and setup guides listed above.*
