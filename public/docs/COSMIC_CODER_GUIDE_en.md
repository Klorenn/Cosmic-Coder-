# Cosmic Coder — Full game and ZK guide

**Version:** 0.7.x · Reference and usage documentation.

---

## Part 1 — How the game works

### 1.1 What is Cosmic Coder

**Cosmic Coder** is a Vampire-Survivors-style survival game: you control a character in an arena, clear waves of enemies, level up, unlock weapons and upgrades, and try to last as many waves as possible. When you die, your run is recorded (locally and, if you have a wallet connected, on-chain). The game has two on-chain submission modes: **casual** (legacy) and **ranked** (with a ZK proof).

- **Requirement to play:** You **must** link your **[Freighter](https://www.freighterapp.com/)** wallet on the title screen to play. The game requires a connected Stellar wallet (Freighter extension in the browser).
- **Goal:** Survive as many waves as possible, accumulate XP (score), and appear on the leaderboard.
- **Engine:** Phaser (browser); run logic runs off-chain. Only on death is the result sent to Stellar/Soroban contracts if configured.

---

### 1.2 Controls and basic flow

- **Movement:** WASD or arrow keys (or touch controls on mobile).
- **Attack:** Automatic based on the equipped weapon; there is no fire button.
- **Waves:** Every so often a new wave spawns with more and/or tougher enemies. The wave number (`wave`) increases (1, 2, 3, …).
- **XP and score:** Enemies grant XP when killed; your **score** for the run is the **total XP** accumulated (used as *score* in the contract).
- **Death:** When your health reaches 0, the run ends: local records are saved, submission to chain (casual or ranked) may occur, and you earn BITS (in-game currency) based on wave, kills, and XP.

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

### 1.5 Score, death, and save

- **Score = total XP** for the run. This is the value sent to the contract as `score`.
- **On death:**
  - Local records are updated (max wave, max score).
  - The entry is added to the local leaderboard.
  - If a wallet is connected and the contract is configured, an on-chain submit is attempted:
    - **Casual mode:** `submit_result(wave, score)` — the contract may check basic rules (e.g. `score >= wave * MIN_SCORE_PER_WAVE`).
    - **Ranked mode (ZK):** If the prover is configured (`VITE_ZK_PROVER_URL`) and the run is **new** (you have `runSeed`), `run_hash` is computed, the proof is requested from the backend, and `submit_zk` is called with proof, VK, and public signals.
  - BITS are awarded based on wave, kills, and XP.
- **Save:** You can save the run and “Continue” from the menu; that restores position, wave, health, etc. If you **continue** a run, ZK flow is not used on death (no runSeed for a new run), so that death is submitted as casual if at all.

---

### 1.6 Modes: casual vs ranked

| | Casual | Ranked (ZK) |
|--|--------|-------------|
| **What is sent** | `submit_result(wave, score)` | `submit_zk(proof, vk, pub_signals, …)` |
| **On-chain check** | Basic rules (score, wave) | Groth16 proof verification |
| **When used** | No ZK prover or “Continue” run | **New** run + prover configured + contract with verifier |
| **Leaderboard** | Legacy (wave + score) | Per season (season_id), score only |

For **ranked** you need: (1) connected wallet, (2) contract (Shadow Ascension) configured with verifier, (3) backend prover (`VITE_ZK_PROVER_URL`), and (4) start a **new** run (not “Continue”) so `runSeed` exists and the proof can be generated and verified.

---

## Part 2 — How ZK works (in depth)

### 2.1 Why we use ZK in the game

In a game that runs in the browser, the server/contract cannot “see” your run. If you only sent “I reached wave 50 with 100,000 points”, anyone could lie. With **zero-knowledge (ZK)**:

- You **prove** that you know data (wave, score, run_hash, nonce, season_id) that satisfy the circuit **without revealing** how you played step by step.
- The **contract** only receives a **proof** and the **public signals** (those numbers). It verifies the proof with a **verification key (VK)**. If the pairing equation holds, it accepts that the run is valid for that score/wave/run_hash/nonce/season.
- So the on-chain ranking does not rely on trusting the client: the mathematical proof guarantees that the result is consistent with the circuit (same run_hash, score, wave, nonce, season_id).

---

### 2.2 What the “proof” and circuit actually are

- **Circuit (Circom):** A program that defines a “statement”: given some **private inputs** and **public outputs**, the circuit checks relations between them. In Cosmic Coder, the circuit `GameRun.circom` exposes as **public outputs**:
  - `run_hash_hi`, `run_hash_lo` (run commitment),
  - `score`, `wave`, `nonce`, `season_id`.
- **Proof (Groth16):** A short certificate (three group elements: a, b, c) that proves “I ran the circuit with these inputs and got these public outputs”. Anyone with the **verification key (VK)** can check on-chain that the proof matches those public signals **without** re-running the circuit.
- **On-chain verification:** The **Groth16 verifier** contract receives (VK, proof, pub_signals), computes the linear combination `vk_x` from the public signals, and checks the pairing equation. If it holds, it returns “valid”; the policy contract (Shadow Ascension) then marks the nonce as used, updates the season leaderboard, and emits the event.

---

### 2.3 Full ranked (ZK) flow

1. **Run start (new):** The client generates a random **runSeed** and keeps it in memory for that run.
2. **You play:** Waves, enemies, XP, etc. (all off-chain).
3. **Death:** The client computes:
   - `run_hash = H(player || wave || score || runSeed || timestamp)` (SHA-256).
   - Validates that (wave, score) satisfy game rules.
4. **Proof request (option B — backend):** The client calls the backend with `run_hash_hex`, `score`, `wave`, `nonce`, `season_id`. The backend writes `input.json`, runs the prover (snarkjs), and returns `contract_proof.json` (proof + VK + pub_signals in contract format).
5. **On-chain submit:** The client signs and calls `submit_zk` on the Shadow Ascension contract with:
   - proof, VK, pub_signals,
   - nonce, run_hash (32 bytes), season_id, score, wave,
   - authorized as `player`.
6. **In the contract:**
   - It checks that the verifier is set, that the VK has the right shape (`ic.len() == pub_signals.len() + 1`), and that score > 0 and wave > 0.
   - It checks anti-replay: if (player, nonce, season_id) is already used, it returns `Replay`.
   - It calls the **Groth16 verifier** with (VK, proof, pub_signals). If it returns `true`, it marks the nonce as used, updates the season leaderboard, calls the Game Hub `end_game`, and emits `zk_run_submitted`.

The entire ranked flow is tied: same run_hash/score/wave/nonce/season in the proof and in the contract, and the proof is only valid for those values.

---

### 2.4 Run_hash and binding

- **run_hash** is the run commitment: it ties together player, wave, score, run seed, and timestamp. The circuit does not “recompute” run_hash in detail; the public signals include run_hash_hi and run_hash_lo so the contract and proof are bound to the same commitment.
- On the client, `run_hash` is computed with `computeGameHash(playerAddress, wave, score, runSeed, timestamp)`. The backend generates the proof with that run_hash (and the other inputs); the contract receives the same run_hash in `submit_zk` for consistency.

---

### 2.5 Anti-replay and nonce

- Each ranked submit uses a **nonce** (e.g. timestamp). The contract stores `ReplayKey = (player, nonce, season_id)`. If you submit again with the same (player, nonce, season_id), the contract returns `Replay` and does not call the verifier.
- The proof includes the nonce as a public signal; you cannot reuse the same proof with a different nonce without generating a new proof. This prevents submitting the same run multiple times to inflate the leaderboard.

---

### 2.6 Quick technical summary

- **Circuit:** 6 public outputs (run_hash hi/lo, score, wave, nonce, season_id). VK with `ic` of length 7.
- **Proof:** Groth16 (a, b, c); verification with BN254 on Soroban.
- **Contracts:** `zk_types` (shared types), `groth16_verifier` (proof verification only), `shadow_ascension` (policy: replay, leaderboard, events, Hub).
- **Detailed technical docs:** See `TECHNICAL_DOCUMENTATION.md` and `ZK_REAL_SETUP.md` (requirements, circuit build, scripts, option B, checklist).

---

*End of guide. For implementation details and contract references, use the technical documentation and ZK guide links above.*
