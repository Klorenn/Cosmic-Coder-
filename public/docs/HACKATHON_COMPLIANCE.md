# Stellar Game Studio Hackathon — Compliance Checklist

Cosmic Coder (vibe-coder) fulfills all requirements from the [Stellar Game Studio Quickstart Guide](https://github.com/jamesbachini/Stellar-Game-Studio).

---

## ✅ Requirements Met

### 1. Game contracts must call `start_game()` and `end_game()` on the testnet mock contract

**Required contract:** `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` (Game Hub)

**Cosmic Coder implementation:**
- The `shadow_ascension` policy contract is initialized with this Game Hub address.
- **On game start:** When the player calls `start_match(player)` on our policy, the contract invokes `start_game(game_id, session, player, system_player, x, y)` on the Game Hub.
- **On game over:** When `submit_result(player, wave, score)` or `submit_zk(...)` is called, the contract invokes `end_game(session, success)` on the Game Hub.

**Where to verify:** [Stellar Expert — Game Hub](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG) → Recent invocations → `start_game`, `end_game` from our policy contract.

**Deploy script:** `scripts/deploy_contracts_testnet.sh` passes `--game_hub CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` to `init`.

---

### 2. Zero-Knowledge integration

**Hackathon options:** RISC Zero or Noir.  
**Cosmic Coder:** Uses **Groth16** (Circom + snarkjs) — a standard ZK proof system for provably fair leaderboard submission.

**Flow:**
1. Client computes `run_hash = H(player || wave || score || run_seed || timestamp)` at run start.
2. On death, backend generates a Groth16 proof with `run_hash`, `score`, `wave`, `nonce`, `season_id`.
3. Client submits proof via `submit_zk` to the policy contract.
4. Policy invokes the Groth16 verifier contract; on success, updates leaderboard and calls `end_game` on the Game Hub.

**Circuit:** `circuits/GameRun.circom` — validates `score >= wave * MIN_SCORE_PER_WAVE` and binds proof to `run_hash`.

---

### 3. Smart contract (Soroban)

**Contracts:**
- **Policy (shadow_ascension):** `start_match`, `submit_result`, `submit_zk`, `get_leaderboard`.
- **Verifier (groth16_verifier):** BN254 Groth16 verification.

**Deploy:** `./scripts/deploy_contracts_testnet.sh` with `SOURCE_ACCOUNT` set.

---

### 4. Frontend

**Stack:** Phaser 3 + Vite + Freighter (Stellar wallet).

**Features:**
- Connect wallet (Freighter) to play.
- Start Game → calls `start_match` → policy calls Game Hub `start_game`.
- On death → submit ZK (or casual) → policy calls Game Hub `end_game`.
- Leaderboard (on-chain via `get_leaderboard`).

---

### 5. Publish

**Repository:** [GitHub — Cosmic Coder](https://github.com/Klorenn/Cosmic-Coder-)  
**Play online:** [GitHub Pages](https://klorenn.github.io/Cosmic-Coder-/)

---

## Quick verification

| Step | Action |
|------|--------|
| 1 | Connect Freighter wallet |
| 2 | Click **Start Game** |
| 3 | Play until death |
| 4 | See "ZK RANKED — Submitted" or "Casual — Submitted" |
| 5 | Check [Game Hub](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG) for `start_game` and `end_game` invocations |

---

## Summary

| Requirement | Status |
|-------------|--------|
| `start_game` on Game Hub | ✅ Called by policy on `start_match` |
| `end_game` on Game Hub | ✅ Called by policy on `submit_result` / `submit_zk` |
| ZK technology | ✅ Groth16 (Circom) |
| Soroban contract | ✅ Policy + Verifier |
| Frontend + wallet | ✅ Phaser + Freighter |
| Published repo | ✅ GitHub + GitHub Pages |
