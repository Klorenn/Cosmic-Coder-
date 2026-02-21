# Cosmic Coder

**A vampire-survivors-style idle game where your coding activity powers your astronaut. Prove your runs on-chain with Stellar and zero-knowledge proofs.**

**[Play Now](https://klorenn.github.io/Cosmic-Coder-/) · [Setup Guide](./SETUP.md) · [Changelog](./CHANGELOG.md)**

---

## About the Game

Cosmic Coder is an idle survival game set in a hostile digital universe. Your astronaut fights waves of enemies while you code; the game runs in the background and rewards real coding activity.

- **3 playable characters** — **VibeCoder** (balanced), **VoidNull** (raw power), **SyncStorm** (fast & agile). Each has unique sprites, idle, walk, and death animations.
- **Auto-play AI** — HUNT, EVADE, and IDLE modes. Your character moves and attacks automatically.
- **30+ weapons** — 11 evolved combos, melee and ranged. Weapons drop during runs and expire; evolution combines two weapons into a stronger one.
- **Rebirth system** — Permanent prestige: spend BITS after each run on upgrades (damage, health, speed, etc.).
- **Shrines** — Risk/reward choices that can heal, buff, or cost health.
- **Wallet-linked progress** — Connect a [Freighter](https://www.freighterapp.com/) wallet to save progress, appear on the on-chain leaderboard, and submit ZK-ranked runs.
- **ZK proofs on every run** — When you die with score > 0 and a wallet connected, the game always attempts a Zero-Knowledge proof submission to the blockchain.

Gameplay is **100% off-chain** (Phaser 3). Only match start, match end, and leaderboard updates touch the blockchain.

---

## Characters

| Character | Internal ID | Texture | Description |
|-----------|-------------|---------|-------------|
| **VibeCoder** | `vibecoder` | `player` | A former network architect whose consciousness merged with the terminal. Balanced stats. |
| **VoidNull** | `destroyer` | `player-destroyer` | The ultimate security protocol — erases existence. High damage. |
| **SyncStorm** | `swordsman` | `player-swordsman` | An electrical storm of data — fast and agile. High speed. |

Each character has dedicated death animation spritesheets (`VibeCoder/vibecoder-death.png`, `VoidNull/voidnull-death.png`, `SyncStorm/sync-death.png`). On game over, the death animation plays once and freezes on the last frame (character lying on the ground).

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

### Deploy (GitHub Pages)

All assets (images, music, sprites) and config live **inside the repo** under `public/`. No local or absolute paths — the build uses the same base for assets and `config.json` so deploy does not 404.

- **Images & audio:** `public/assets/` (sprites, backgrounds, UI, audio). Vite copies them to `dist/`; the game resolves URLs with the same base as the build (GitHub Pages `/repo-name/` or root `/`).
- **Config:** `public/config.json` is loaded at runtime. In CI, `scripts/write_config_from_env.js` writes it from GitHub secrets before build so ZK prover URL, contract ID, and leaderboard API are set. If secrets are missing, the repo’s existing `config.json` or `config.json.example` is used.
- **ZK:** Contract ID and prover URL come from `config.json`. Circuit artifacts (`public/circuits/`) are in the repo; the frontend only needs the verification key and config — no local paths.

Set optional secrets in the repo: `VITE_COSMIC_CODER_CONTRACT_ID`, `VITE_ZK_PROVER_URL`, `VITE_LEADERBOARD_URL`, `VITE_API_URL`, etc. Then push to `main` or run the “Deploy to GitHub Pages” workflow manually.

---

## How We Use Stellar and ZK

Cosmic Coder uses **Stellar Testnet** and **Soroban** smart contracts to run a provably fair ranked leaderboard. We combine the [Stellar Game Studio](https://github.com/jamesbachini/Stellar-Game-Studio) **Game Hub** with our own **policy contract** and a **Groth16 ZK verifier** so that only cryptographically verified runs enter the ranked board.

### Architecture

1. **Game Hub (Stellar Game Studio)**  
   Central contract that tracks game sessions: `start_game()` and `end_game()`. Our policy contract calls it when a player starts or finishes a run.

2. **Policy contract (cosmic_coder)**  
   Our game logic on-chain:
   - `start_match(player)` — Called when you press "Start Game"; it calls the Game Hub's `start_game()`.
   - `submit_result(player, wave, score)` — Casual submission: checks `score >= wave * MIN_SCORE_PER_WAVE` (MIN = 5), then calls `end_game()` and updates the leaderboard.
   - `submit_zk(player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave)` — Ranked submission: verifies a Groth16 proof on-chain, enforces anti-replay via `(player, nonce, season_id)`, then updates the per-season ranked leaderboard and calls `end_game()`.

3. **Verifier contract (groth16_verifier)**  
   BN254 Groth16 verifier (see [CAP-0074](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md)). The policy contract invokes it to check that a run's public inputs (e.g. run hash, score, wave) match the proof. Only valid proofs are accepted for ranked.

### ZK Proof — Always Active

**Every run** with score > 0 and a connected wallet attempts a ZK proof submission. There is no separate "ranked" vs "casual" toggle — the game always tries to generate and submit a ZK proof when the prover and contract are configured. The **minimum score** required is **5 per wave** (`MIN_SCORE_PER_WAVE = 5`). This is clearly displayed in the ZK Terminal popup with a red warning.

If the ZK submission fails (prover offline, contract not deployed, etc.), the game falls back to a casual `submit_result` call.

### End-to-end flow

1. You connect a Freighter wallet and press **Start Game**.
2. The frontend calls `start_match()` on the policy contract; the policy calls `start_game()` on the Game Hub.
3. You play entirely off-chain (Phaser). Wave and score (total XP) are computed by the game.
4. When you die:
   - The client computes `run_hash = H(player, wave, score, runSeed, timestamp)`, requests a Groth16 proof from the backend (`/zk/prove`), then calls `submit_zk(...)` with the proof. The policy verifies the proof via the verifier contract, updates the ranked leaderboard, and calls `end_game()`.
   - **Fallback:** If the ZK proof fails, the client calls `submit_result(wave, score)`. The policy checks game rules, updates the leaderboard, and calls `end_game()`.

So: **Stellar** provides the chain and the Game Hub session lifecycle; **ZK** ensures that entries are provably valid without revealing full gameplay trace.

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
- **Anti-replay:** Each submission uses a unique `(player, nonce, season_id)`; replays are rejected.
- **Leaderboard:** Per-season ranked board via `get_leaderboard_by_season(season_id, limit)`; legacy `get_leaderboard(limit)` for casual.
- **Minimum score:** `MIN_SCORE_PER_WAVE = 5`. You need at least 5 score per wave for a valid ZK proof.

---

## How to Play and Verify On-Chain

1. Open the game and **connect your Freighter wallet** on the title screen (required to play).
2. Choose **Start Game** (not "Continue") for a run that can be submitted to the leaderboard.
3. Play until you die. On death, the game automatically submits your run via ZK proof (if prover is configured) or casual fallback.
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
│   ├── main.js              # Phaser config, characters, upgrades, legendaries
│   ├── locales/             # en.js, es.js (i18n)
│   ├── scenes/              # Boot, Title, Arena
│   ├── systems/             # EventManager, MapManager, Rebirth, Save, Shrine, RunModifiers, Leaderboard
│   ├── contracts/           # gameClient.js (Soroban: start_match, submit_result, submit_zk, get_leaderboard)
│   ├── zk/                  # gameProof.js (game hash, validateGameRules, MIN_SCORE_PER_WAVE=5)
│   └── utils/               # audio, socket, SpatialHash, i18n, stellarWallet
├── contracts/
│   ├── zk_types/            # Shared ZK types
│   ├── groth16_verifier/    # BN254 Groth16 verifier (Soroban)
│   └── cosmic_coder/        # Game policy contract (Cosmic Coder, Game Hub + leaderboard)
├── circuits/                # Circom circuit (GameRun)
├── server/                  # XP server + ZK prover (/zk/prove)
├── hooks/                   # IDE/AI hooks for XP
├── public/
│   └── assets/sprites/player/
│       ├── VibeCoder/       # vibecoder-death.png (5 frames, 640×128)
│       ├── VoidNull/        # voidnull-death.png (4 frames, 512×128)
│       └── SyncStorm/       # sync-death.png (4 frames, 512×128)
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
