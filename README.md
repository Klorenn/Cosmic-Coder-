# Cosmic Coder

**A vampire-survivors-style idle game where your coding activity powers your astronaut. Prove your runs on-chain with Stellar and zero-knowledge proofs.**

**[Play Now](https://klorenn.github.io/Cosmic-Coder-/) · [Setup Guide](./SETUP.md) · [Changelog](./CHANGELOG.md)**

---

## About the Game

Cosmic Coder is an idle survival game set in a hostile digital universe. Your astronaut fights waves of enemies while you code; the game runs in the background and rewards real coding activity.

- **Auto-play AI** — HUNT, EVADE, and IDLE modes. Your character moves and attacks automatically.
- **30 weapons** — 11 evolved combos, melee and ranged. Weapons drop during runs and expire; evolution combines two weapons into a stronger one.
- **Rebirth system** — Permanent prestige: spend BITS after each run on upgrades (damage, health, speed, etc.).
- **Shrines** — Risk/reward choices that can heal, buff, or cost health.
- **Wallet-linked progress** — Connect a [Freighter](https://www.freighterapp.com/) wallet to save progress, appear on the on-chain leaderboard, and submit ZK-ranked runs.

Gameplay is **100% off-chain** (Phaser 3). Only match start, match end, and leaderboard updates touch the blockchain.

---

## Quick Start

**Play in the browser (no install):**  
**[https://klorenn.github.io/Cosmic-Coder-/](https://klorenn.github.io/Cosmic-Coder-/)**

On mobile, the game asks you to rotate to landscape. Connect your Freighter wallet on the title screen to play and submit to the leaderboard.

**Run locally:**
```bash
npm install && npm run dev
```
Open http://localhost:3000. Optional: `npm run server` for the XP/prover backend.

**Language:** English and Spanish in **Settings → Language** on the title screen.

---

## How We Use Stellar and ZK

Cosmic Coder uses **Stellar Testnet** and **Soroban** smart contracts to run a provably fair ranked leaderboard. We combine the [Stellar Game Studio](https://github.com/jamesbachini/Stellar-Game-Studio) **Game Hub** with our own **policy contract** and a **Groth16 ZK verifier** so that only cryptographically verified runs enter the ranked board.

### Architecture

1. **Game Hub (Stellar Game Studio)**  
   Central contract that tracks game sessions: `start_game()` and `end_game()`. Our policy contract calls it when a player starts or finishes a run.

2. **Policy contract (cosmic_coder)**  
   Our game logic on-chain:
   - `start_match(player)` — Called when you press “Start Game”; it calls the Game Hub’s `start_game()`.
   - `submit_result(player, wave, score)` — Casual submission: checks `score >= wave * MIN_SCORE_PER_WAVE`, then calls `end_game()` and updates the leaderboard.
   - `submit_zk(player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave)` — Ranked submission: verifies a Groth16 proof on-chain, enforces anti-replay via `(player, nonce, season_id)`, then updates the per-season ranked leaderboard and calls `end_game()`.

3. **Verifier contract (groth16_verifier)**  
   BN254 Groth16 verifier (see [CAP-0074](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md)). The policy contract invokes it to check that a run’s public inputs (e.g. run hash, score, wave) match the proof. Only valid proofs are accepted for ranked.

### End-to-end flow

1. You connect a Freighter wallet and press **Start Game**.
2. The frontend calls `start_match()` on the policy contract; the policy calls `start_game()` on the Game Hub.
3. You play entirely off-chain (Phaser). Wave and score (total XP) are computed by the game.
4. When you die:
   - **ZK Ranked (if prover is configured):** The client computes `run_hash = H(player, wave, score, runSeed, timestamp)`, requests a Groth16 proof from our backend (`/zk/prove`), then calls `submit_zk(...)` with the proof. The policy verifies the proof via the verifier contract, updates the ranked leaderboard, and calls `end_game()`.
   - **Casual (fallback):** The client calls `submit_result(wave, score)`. The policy checks the same game rules, updates the leaderboard, and calls `end_game()`.

So: **Stellar** provides the chain and the Game Hub session lifecycle; **ZK** ensures that ranked entries are provably valid without revealing full gameplay trace.

### Contracts on Stellar Testnet

| Contract | Role | Stellar Expert |
|----------|------|----------------|
| **Game Hub** | Session lifecycle: `start_game`, `end_game` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG) |
| **Policy (Cosmic Coder)** | Our game: `start_match`, `submit_result`, `submit_zk`, leaderboard | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO) |
| **Verifier (groth16_verifier)** | BN254 Groth16 proof verification | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA) |

- **Play:** [Cosmic Coder](https://klorenn.github.io/Cosmic-Coder-/)
- **Deploy contracts & prover:** [docs/DEPLOY_ZK_STEPS.md](docs/DEPLOY_ZK_STEPS.md)

### ZK details

- **Circuit:** Built with [Circom](https://github.com/iden3/circom); public inputs include run hash, score, wave. Proof + verification key are produced off-chain (backend prover) and submitted via the frontend.
- **Anti-replay:** Each ranked submission uses a unique `(player, nonce, season_id)`; replays are rejected.
- **Leaderboard:** Per-season ranked board via `get_leaderboard_by_season(season_id, limit)`; legacy `get_leaderboard(limit)` for casual.

---

## How to Play and Verify On-Chain

1. Open the game and **connect your Freighter wallet** on the title screen (required to play).
2. Choose **Start Game** (not “Continue”) for a run that can be submitted to the ranked leaderboard.
3. Play until you die. On death, the game submits your run: **ZK Ranked** (if the prover is configured and the proof succeeds) or **Casual** (rules-only).
4. **Verify:** On Stellar Expert, open the [Policy contract](https://stellar.expert/explorer/testnet/contract/CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO) and check recent invocations for `start_match`, `submit_zk`, or `submit_result` and the resulting `end_game` calls on the Game Hub.

**Local setup for full ZK flow:** Set `VITE_COSMIC_CODER_CONTRACT_ID` and `VITE_ZK_PROVER_URL` (e.g. to your prover backend), run the prover, then connect wallet and play. See [docs/DEPLOY_ZK_STEPS.md](docs/DEPLOY_ZK_STEPS.md) and [docs/HACKATHON_DO_THIS.md](docs/HACKATHON_DO_THIS.md).

---

## AI Coding Tool Integration

Connect the game to your IDE or AI coding tools for live XP:

| Tool | Hook | Bonus XP |
|------|------|----------|
| Claude Code | `hooks/claude-code-hook.sh` | +15 |
| Codex | `hooks/codex-hook.sh` | +12 |
| Gemini | `hooks/gemini-hook.sh` | +12 |
| Cursor | `hooks/cursor-hook.sh` | +10 |
| Generic | `hooks/vibe-coder-hook.sh` | +8 |

See [Setup Guide](./SETUP.md) for configuration.

---

## Project Structure

```
cosmic-coder/
├── src/
│   ├── main.js              # Phaser config, upgrades, legendaries
│   ├── locales/             # en.js, es.js (i18n)
│   ├── scenes/              # Boot, Title, Arena
│   ├── systems/             # EventManager, MapManager, Rebirth, Save, Shrine, RunModifiers, Leaderboard
│   ├── contracts/           # gameClient.js (Soroban: start_match, submit_result, submit_zk, get_leaderboard)
│   ├── zk/                  # gameProof.js (game hash, validateGameRules)
│   └── utils/               # audio, socket, SpatialHash, i18n, stellarWallet
├── contracts/
│   ├── zk_types/            # Shared ZK types
│   ├── groth16_verifier/    # BN254 Groth16 verifier (Soroban)
│   └── cosmic_coder/        # Game policy contract (Cosmic Coder, Game Hub + leaderboard)
├── circuits/                # Circom circuit (GameRun)
├── server/                  # XP server + ZK prover (/zk/prove)
├── hooks/                   # IDE/AI hooks for XP
└── index.html
```

---

## Tech Stack

- **Phaser 3** — Game engine
- **Vite** — Build and dev server
- **Stellar SDK + Soroban** — On-chain contracts and wallet signing (Freighter)
- **Circom + snarkjs** — ZK circuit and proof generation
- **Vitest** — Unit tests

---

## Deploy

The game deploys to **GitHub Pages** on push to `main` via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (build with `npm run build`). Enable GitHub Pages in the repo settings (Source: GitHub Actions). The live URL is **https://klorenn.github.io/Cosmic-Coder-/**.

For contract and prover deployment (Testnet + Render or similar), see [docs/DEPLOY_ZK_STEPS.md](docs/DEPLOY_ZK_STEPS.md) and [docs/HACKATHON_DO_THIS.md](docs/HACKATHON_DO_THIS.md).

---

*Code to Conquer.*
