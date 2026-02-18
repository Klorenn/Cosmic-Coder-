# 🚀 Cosmic Coder 🪐 / Codificador Cósmico 🪐

**A vampire-survivors-style idle game where coding powers your astronaut. Code, conquer, and grow!**  
**Un juego idle al estilo Vampire Survivors donde tu actividad de codificación potencia a tu astronauta. Programa, conquista y crece.**

▶️ [Play Now / Jugar Ahora](https://klorenn.github.io/Cosmic-Coder-/) | 📖 [Setup Guide / Guía de Configuración](./SETUP.md) | 📋 [Changelog / Historial de Cambios](./CHANGELOG.md)

![Phaser 3](https://img.shields.io/badge/Phaser-3.x-blue) ![Vite](https://img.shields.io/badge/Vite-7.x-purple) ![Electron](https://img.shields.io/badge/Electron-33.x-9feaf9) ![Node](https://img.shields.io/badge/Node-18+-green) ![Tests](https://img.shields.io/badge/Tests-240_passing-brightgreen) ![Deploy](https://img.shields.io/github/actions/workflow/status/Klorenn/Cosmic-Coder-/deploy.yml?label=Deploy) ![Play Online](https://img.shields.io/badge/Play-Online-brightgreen)

---

## 🌌 About / Acerca de

**Cosmic Coder / Codificador Cósmico** is an idle survival game where your coding activity fuels your astronaut in a hostile digital universe. Every action you take in your workflow powers up your character.  
**Es un juego idle de supervivencia donde tu actividad de codificación alimenta a tu astronauta en un universo digital hostil. Cada acción en tu flujo de trabajo potencia a tu personaje.**

**While you code / Mientras programas:**

- 🎯 Your astronaut hunts enemies with smart auto-play AI (HUNT / EVADE / IDLE modes)  
  **Tu astronauta caza enemigos con IA de auto-juego inteligente (MODOS: CAZAR / EVADIR / IDLE)**
- ⚔️ Auto-attacks with 30 weapons including 11 evolved combos  
  **Ataca automáticamente con 30 armas, incluyendo 11 combinaciones evolucionadas**
- 🔄 Gains permanent prestige bonuses via the Rebirth system  
  **Obtiene bonificaciones permanentes a través del sistema Rebirth**
- 🎲 Discovers interactive shrines with risk/reward choices  
  **Descubre santuarios interactivos con opciones de riesgo/recompensa**
- 💬 Enjoys theme-related quotes while playing  
  **Disfruta de frases temáticas mientras juega**

---

## 🛰 How It Works / Cómo Funciona

```
 You Code                    Cosmic Coder
┌──────────┐  WebSocket   ┌──────────────────────────────┐
│ Claude   │──on-prompt──▶│  XP Server (:3333)           │
│ Code     │  hook fires  │    │                          │
│          │              │    ▼                          │
│ IDE      │──HTTP POST──▶│  Game Engine (Phaser 3)      │
│ Terminal │              │    ├─ Auto-Play AI            │
│ etc.     │              │    ├─ 18 Enemy Types + Bosses │
└──────────┘              │    ├─ Weapon Evolution        │
                          │    └─ Prestige System         │
                          └──────────────────────────────┘
```

---

## 🚀 Quick Start / Inicio Rápido

### Play Online (No Install) / Jugar en línea (sin instalar)
**[▶️ Play Cosmic Coder Now / Jugar Cosmic Coder](https://klorenn.github.io/Cosmic-Coder-/)**

Press **SPACE** to manually gain XP, or connect the hooks for real coding rewards!  
**Pulsa ESPACIO para ganar XP manualmente, o conecta los hooks para recompensas por codificar.**

### Local Development / Desarrollo local
```bash
npm install       # Instalar dependencias
npm run dev       # Iniciar el juego
npm run server    # (Opcional) Servidor XP para recompensas en vivo
```

Open http://localhost:3000 in your browser.  
**Abre http://localhost:3000 en tu navegador.**

### Language / Idioma
The game supports **English** and **Spanish**. Change language in **Settings → Language** on the title screen.  
El juego soporta **inglés** y **español**. Cambia el idioma en **Ajustes → Idioma** en la pantalla de título.

### Menu Character Assets (Important)

The title menu and character selector use sprite sheets from `public/assets/sprites`:

- `public/assets/sprites/player/robot-idle.png`
- `public/assets/sprites/player/robot-walk.png`
- `public/assets/sprites/player/robot-hurt.png`
- `public/assets/sprites/player/destroyer-idle.png`
- `public/assets/sprites/player/destroyer-walk.png`
- `public/assets/sprites/player/destroyer-hurt.png`
- `public/assets/sprites/player/swordsman-idle.png`
- `public/assets/sprites/player/swordsman-walk.png`
- `public/assets/sprites/player/swordsman-hurt.png`
- `public/assets/sprites/enemies/werewolf-run.png`

Behavior notes:

- The title menu keeps wolves/mobs disabled by default for a clean UI.
- Character preview in `PERSONAJE` updates immediately on LEFT/RIGHT selection.
- If assets are missing, the game falls back to generated placeholder textures.

---

## 📜 Contracts & Stellar Expert (Testnet) / Contratos y Stellar Expert

Contratos Soroban desplegados en **Stellar Testnet**. Enlaces en Stellar Expert para inspeccionar invocaciones y estado.

**Soroban contracts deployed on Stellar Testnet. Stellar Expert links to inspect invocations and state.**

| Contract | Description / Descripción | Stellar Expert |
|----------|----------------------------|----------------|
| **Game Hub** | Game Studio hub: `start_game`, `end_game` | [Stellar Expert – Game Hub](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG) |
| **Policy (shadow_ascension)** | Game policy: `start_match`, `submit_result`, `submit_zk`, leaderboard | [Stellar Expert – Policy](https://stellar.expert/explorer/testnet/contract/CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO) |
| **Verifier (groth16_verifier)** | BN254 Groth16 proof verification | [Stellar Expert – Verifier](https://stellar.expert/explorer/testnet/contract/CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA) |

- **Game (online):** [Play Cosmic Coder](https://klorenn.github.io/Cosmic-Coder-/)
- **Deploy / re-deploy:** [docs/DEPLOY_ZK_STEPS.md](docs/DEPLOY_ZK_STEPS.md)

---

## 🔌 AI Coding Tool Integration / Integración con herramientas de IA

Connect Cosmic Coder to your AI coding assistant for real XP gains while coding!  
**Conecta Cosmic Coder a tu asistente de IA para ganar XP real mientras programas.**

| Tool / Herramienta | Hook | Bonus XP |
|--------------------|------|----------|
| **Claude Code** | `hooks/claude-code-hook.sh` | +15 |
| **Codex** | `hooks/codex-hook.sh` | +12 |
| **Gemini** | `hooks/gemini-hook.sh` | +12 |
| **Cursor** | `hooks/cursor-hook.sh` | +10 |
| **Generic** | `hooks/vibe-coder-hook.sh` | +8 |

**[📖 Full Setup Guide / Guía completa](./SETUP.md)**

---

## 🏆 Hackathon: Provably Fair Survival (Stellar + ZK)

Cosmic Coder integrates with [Stellar Game Studio](https://github.com/jamesbachini/Stellar-Game-Studio) and a **ZK-style proof** for the leaderboard.  
**[📋 Hackathon & Repo documentation](./public/docs/index.html)** — complete doc for judges and repo (ES/EN). Select "Hackathon & Repo" in the nav.

### Quick Setup: Make Stellar + ZK work locally

If you want the full ranked flow working end-to-end (wallet + contracts + prover + on-chain leaderboard), use this order:

1. **Install deps and run the game**
   ```bash
   npm install
   npm run dev
   ```
2. **Set required env vars** (`.env`):
   ```bash
   VITE_SHADOW_ASCENSION_CONTRACT_ID=<your_policy_contract_id_on_testnet>
   VITE_ZK_PROVER_URL=http://localhost:3333
   ```
3. **Run prover/backend** (for proof generation endpoint `/zk/prove`):
   - Use your prover service (local or hosted), and ensure `VITE_ZK_PROVER_URL` points to it.
4. **Connect wallet in title screen** (Freighter/Testnet account with balance).
5. **Start a fresh run** with **Start Game** (ranked path), play, die, and submit.

How the app decides ranked availability:

- `VITE_SHADOW_ASCENSION_CONTRACT_ID` must be set.
- `VITE_ZK_PROVER_URL` must be reachable.
- Wallet must be connected and able to sign.

In code, this is handled in `src/contracts/gameClient.js` via:
- `start_match(...)`
- `submit_result(...)`
- `submit_zk(...)`
- `isZkProverConfigured()`

### Local verification checklist

- On run start: contract `start_match` is invoked.
- On run end: rules are validated and `submit_zk` (or fallback `submit_result`) is sent.
- Leaderboard query returns entries from chain (`get_leaderboard` / season variant).
- UI hint disappears once wallet + contract/prover are configured.

### Useful commands

```bash
npm run dev        # frontend
npm run server     # xp/prover backend (project setup dependent)
npm run zk:e2e     # end-to-end zk script
```

### What it does

- **Gameplay stays 100% off-chain** (Phaser). No lag, no on-chain combat.
- **On game start**: If wallet is connected and the Soroban contract is deployed, the game calls `start_match()` on our contract, which in turn calls **`start_game()`** on the [Game Hub](https://github.com/jamesbachini/Stellar-Game-Studio) (Testnet: `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`).
- **On game over**: The client validates that `score >= wave * MIN_SCORE_PER_WAVE` (game rules). Then it calls **`submit_result(wave, score)`** on our contract. The contract:
  - Enforces the same rule.
  - Calls **`end_game()`** on the Game Hub.
  - Stores the result in the on-chain leaderboard.

So **ZK / provably fair** = the contract only accepts scores that satisfy the public rules; the player proves (by signing the tx) that they reached that wave/score without revealing every in-game action.

### ZK flow (summary)

1. **Off-chain**: You play; `wave` and `score` (total XP) are computed by the game.
2. **Proof**: Client checks `score >= wave * 10` (and optional `game_hash = H(player, wave, score, seed, ts)` for binding).
3. **On-chain**: You submit `(wave, score)`; the contract re-checks the rule, then calls `end_game()` and updates the leaderboard.

### ZK Ranked Mode (Groth16 BN254)

**The ZK proof is the central mechanic for ranked mode:** only runs that pass on-chain Groth16 verification enter the ranked leaderboard. It is not decorative; ranked progression is gated by the verifier.

- **Groth16 over BN254**: Conceptually aligned with [CAP-0074](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md). The contract verifies pairing-based proofs; only cryptographically valid runs are accepted.
- **Separation of concerns**:
  - **zk_types** (`contracts/zk_types/`): Shared types only (`Groth16Error`, `ZkProof`, `ZkVerificationKey`). No duplicated definitions.
  - **Verifier** (`contracts/groth16_verifier/`): BN254 pairing only. `verify_proof(vk, proof, pub_signals)` → `Result<bool, Groth16Error>`. No game logic, no leaderboard, no replay.
  - **Policy** (`contracts/shadow_ascension/`): `set_verifier(verifier)`, `submit_zk(player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave)` → `Result<(), ShadowAscensionError>`. Validates `ic.len() == pub_signals.len() + 1`, score/wave > 0, then calls verifier; on success: anti-replay (player, nonce, season_id), per-season leaderboard update, event `zk_run_submitted`.
- **Anti-replay**: (player, nonce, season_id) must be unique; replay attempts return `Err(Replay)`.
- **On-chain leaderboard**: Per-season `LeaderboardKey(season_id)` storing `Vec<ScoreEntry>` (player, score), sorted by score desc; update only if new score is higher.
- **Circuit (off-chain)**: Generated with [Circom](https://github.com/iden3/circom) (or snarkjs/Noir). Public inputs bound to run_hash, score, wave; proof + VK submitted via frontend to `submit_zk`.

**CAP & protocol (verify before deploy):**

| CAP | Purpose |
|-----|---------|
| [CAP-0074](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md) | BN254 (Groth16) |
| [CAP-0059](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0059.md) | BLS12-381 (optional) |
| [Protocol version](https://developers.stellar.org/docs/networks/software-versions) | Confirm BN254 primitives on target network |
| [SDK crypto](https://docs.rs/soroban-sdk/latest/soroban_sdk/crypto/) | `bn254` module |

**Resource simulation:**

```bash
stellar contract invoke --id <VERIFIER_ID> --source <SIGNER> --network testnet --sim-only -- verify_proof --vk "..." --proof "..." --pub_signals "..."
```

Document the cost envelope from simulation in your runbook.

**Circuit (off-chain):** [circom](https://github.com/iden3/circom) + [snarkjs](https://github.com/iden3/snarkjs) or [Noir](https://noir-lang.org/docs/). Constraints: e.g. kills ≤ time×MAX_KILLS_PER_SECOND, damage = kills×BASE_DAMAGE, time ≤ MAX_ALLOWED_TIME. Public inputs: player_address, run_hash, final_score, nonce.

**Demo narrative:** *"Shadow Ascension is a competitive survival game where every ranked run is validated on-chain using Groth16 zero-knowledge proofs over BN254. The Stellar Testnet contract verifies mathematical consistency of run stats without revealing internal gameplay state. Only cryptographically valid runs enter the official leaderboard."*

### Hackathon: How to play and verify

**Requirement:** Players **must** link a [Freighter](https://www.freighterapp.com/) wallet on the title screen to play (browser extension). The game cannot be played without a connected wallet.

**How to play and verify:**

1. Open the game (online: [Play Cosmic Coder](https://klorenn.github.io/Cosmic-Coder-/) or run `npm run dev` locally).
2. **Connect your Freighter wallet** on the title screen — **required to play**. Install the [Freighter](https://www.freighterapp.com/) extension if needed.
3. Choose **Start Game** (not "Continue") so the run is eligible for **ZK Ranked** submission.
4. Play until you die. On death, the game submits your run on-chain: either **ZK Ranked** (proof + verifier) or **Casual** (legacy). You’ll see a short message: "Submitted to ZK leaderboard" or "Submitted to casual leaderboard".

**How ZK works (short):** The client binds your run with a hash `run_hash = H(player, wave, score, runSeed, timestamp)`, requests a Groth16 proof from the backend, and sends it to the policy contract. The contract verifies the proof on-chain and updates the ranked leaderboard; anti-replay is enforced by (player, nonce, season_id).

**Links:**

- **Game (online):** [Play Cosmic Coder](https://klorenn.github.io/Cosmic-Coder-/)
- **Game Hub (Testnet):** [Stellar Expert – Game Hub](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG)
- **Policy (shadow_ascension) on Testnet:** [Stellar Expert – Policy](https://stellar.expert/explorer/testnet/contract/CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO)
- **Verifier (groth16_verifier) on Testnet:** [Stellar Expert – Verifier](https://stellar.expert/explorer/testnet/contract/CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA)
- **Deploy / re-deploy:** [docs/DEPLOY_ZK_STEPS.md](docs/DEPLOY_ZK_STEPS.md) (build with `wasm32v1-none`, then deploy with Stellar CLI).

**How to verify on-chain:**

- On **Start Game**, the policy calls `start_game()` on the Game Hub; you can look up the Game Hub contract on Stellar Expert and check recent invocations.
- On **death**, the policy calls `end_game(session, success)` on the Game Hub after a valid `submit_result` or `submit_zk`. Ranked runs appear in the per-season leaderboard via `get_leaderboard_by_season(season_id, limit)`.

**Verificación visual:** Flujo: Iniciar run → `start_match()` → jugar off-chain → morir → `submit_zk` → leaderboard actualizado on-chain. Ver [public/docs/VIBECODER_HACKATHON_es.md](public/docs/VIBECODER_HACKATHON_es.md) y [docs/E2E_VERIFICATION.md](docs/E2E_VERIFICATION.md).

**Comandos E2E:** `npm run zk:e2e` — compila circuito, genera proof real y ejecuta tests (verifier + policy + proof real).

**Deploying contracts, prover, and GitHub Pages:** See [docs/HACKATHON_DO_THIS.md](docs/HACKATHON_DO_THIS.md) for step-by-step: deploy verifier + policy on Testnet, init policy, deploy the ZK prover (Render/Railway), and add GitHub secrets for the production build.

### Contract (Soroban)

- **Layout**: `contracts/zk_types/` (shared types), `contracts/groth16_verifier/`, `contracts/shadow_ascension/`
- **Build** ([Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup); for testnet use target `wasm32v1-none`):

```bash
cd contracts
rustup target add wasm32v1-none
cargo build -p groth16_verifier --target wasm32v1-none --release
cargo build -p shadow_ascension --target wasm32v1-none --release
```

Deploy verifier and game policy; init policy with Game Hub, then `set_verifier(verifier_id)`. Set `VITE_SHADOW_ASCENSION_CONTRACT_ID` for the frontend.

### Frontend

- **Connect wallet (required to play):** Stellar wallet via [Freighter](https://www.freighterapp.com/) on the title screen; the game requires a linked wallet to play.
- **Start game**: If contract is configured, "Start Game" triggers `start_match()` (one signature).
- **Game over**: If rules pass, the game calls `submit_result(wave, score)` (one signature).

### Requirements met

- ✅ **ZK / provably fair**: Score validation rule enforced on-chain; submission is authorized by the player.
- ✅ **Stellar Game Studio**: Contract calls `start_game()` and `end_game()` on the Game Hub.
- ✅ **Contract on Testnet**: Deploy the WASM and set the contract ID in the app.
- ✅ **Frontend**: Connect wallet, start game, play, submit on death, leaderboard.
- ✅ **Open source**: This repo.

### Hackathon Compliance Checklist

- [x] **Mecánica central impulsada por ZK** — Ranked leaderboard depends exclusively on Groth16 verification; only valid proofs enter.
- [x] **Componente on-chain en Stellar Testnet** — Verifier and policy contracts deployed on Testnet.
- [x] **Verifier Groth16 en contrato separado** — `groth16_verifier` (BN254 pairing only); policy calls it via `invoke_contract`.
- [x] **Anti-replay implementado** — (player, nonce, season_id) unique; replay returns `Err(Replay)`.
- [x] **Leaderboard en cadena** — Per-season `get_leaderboard_by_season(season_id, limit)`; legacy `get_leaderboard(limit)` for casual.
- [x] **Frontend integrado** — `submit_zk` with player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave.
- [x] **Simulación reproducible** — `stellar contract invoke --sim-only --id <POLICY_ID> --network testnet -- submit_zk ...` (see `contracts/README.md`).
- [x] **Tests automatizados** — `cargo test -p groth16_verifier` and `cargo test -p shadow_ascension`.

---

## 📁 Project Structure / Estructura del proyecto

```
cosmic-coder/
├── src/
│   ├── main.js            # Game config, upgrades, legendaries
│   ├── locales/           # en.js, es.js (i18n)
│   ├── scenes/            # Boot, Title, Arena
│   ├── systems/           # EventManager, MapManager, Rebirth, Save, Shrine, RunModifiers, Leaderboard
│   ├── contracts/         # gameClient.js (Soroban start_match, submit_result, get_leaderboard)
│   ├── zk/                # gameProof.js (game hash, validateGameRules)
│   └── utils/             # audio, socket, SpatialHash, i18n, stellarWallet
├── contracts/shadow_ascension/   # Soroban contract (Game Hub integration)
├── electron/              # Desktop app
├── server/                # XP server + leaderboard API
├── hooks/                 # Claude Code / Cursor hooks
└── index.html
```

---

## 🔧 Tech Stack

- **Phaser 3** – Game engine
- **Vite** – Build & dev server
- **Electron** – Desktop app
- **Vitest** – Unit tests
- **WebSocket** – Real-time XP

---

## 📤 Deploy / Despliegue (GitHub Pages)

El juego se despliega automáticamente en **GitHub Pages** al hacer push a la rama `main`.  
**The game deploys automatically to GitHub Pages on push to `main`.**

- **Workflow**: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — build con `npm run build` y publicación en Pages.
- **URL**: `https://<tu-usuario>.github.io/vibe-coder/` (o la configurada en el repo).
- Asegúrate de tener **GitHub Pages** activado en el repo (Settings → Pages → Source: GitHub Actions).

---

**Code to Conquer! / ¡Programa para conquistar!** 🚀🪐
