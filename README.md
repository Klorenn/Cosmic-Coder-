# 🚀 Cosmic Coder 🪐 / Codificador Cósmico 🪐

**A vampire-survivors-style idle game where coding powers your astronaut. Code, conquer, and grow!**  
**Un juego idle al estilo Vampire Survivors donde tu actividad de codificación potencia a tu astronauta. Programa, conquista y crece.**

▶️ [Play Now / Jugar Ahora](https://daredev256.github.io/vibe-coder/) | ⬇️ [Download Desktop App / Descargar App](#-desktop-app--app-de-escritorio) | 📖 [Setup Guide / Guía de Configuración](./SETUP.md) | 📋 [Changelog / Historial de Cambios](./CHANGELOG.md)

![Phaser 3](https://img.shields.io/badge/Phaser-3.x-blue) ![Vite](https://img.shields.io/badge/Vite-7.x-purple) ![Electron](https://img.shields.io/badge/Electron-33.x-9feaf9) ![Node](https://img.shields.io/badge/Node-18+-green) ![Tests](https://img.shields.io/badge/Tests-240_passing-brightgreen) ![Deploy](https://img.shields.io/github/actions/workflow/status/DareDev256/vibe-coder/deploy.yml?label=Deploy) ![Play Online](https://img.shields.io/badge/Play-Online-brightgreen)

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
**[▶️ Play Cosmic Coder Now / Jugar Cosmic Coder](https://daredev256.github.io/vibe-coder/)**

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

---

## 🖥️ Desktop App / App de escritorio

Run Cosmic Coder as a native desktop app with system tray integration!  
**Ejecuta Cosmic Coder como app de escritorio con integración en la bandeja del sistema.**

### Download / Descargar
Check the [Releases](https://github.com/DareDev256/vibe-coder/releases) page for pre-built binaries / Revisa la página de [Releases](https://github.com/DareDev256/vibe-coder/releases) para binarios:
- **macOS**: `.dmg` (Universal)
- **Windows**: `.exe`
- **Linux**: `.AppImage` o `.deb`

### Build from Source / Compilar desde código
```bash
npm run electron:dev    # Modo desarrollo (hot reload)
npm run electron:build # Compilar instalable
```

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

### Contract (Soroban)

- **Location**: `contracts/shadow_ascension/`
- **Functions**: `init(game_hub)`, `start_match()`, `submit_result(wave, score)`, `get_leaderboard(limit)`
- **Build** (requires [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup)):

```bash
cd contracts/shadow_ascension
cargo build --target wasm32-unknown-unknown --release
# Or: stellar contract build
```

Deploy and init with the Game Hub address, then set `VITE_SHADOW_ASCENSION_CONTRACT_ID` in your env so the frontend uses your contract.

### Frontend

- **Connect wallet**: Stellar Wallets Kit (Freighter, xBull, etc.) on the title screen.
- **Start game**: If contract is configured, "Start Game" triggers `start_match()` (one signature).
- **Game over**: If rules pass, the game calls `submit_result(wave, score)` (one signature).

### Requirements met

- ✅ **ZK / provably fair**: Score validation rule enforced on-chain; submission is authorized by the player.
- ✅ **Stellar Game Studio**: Contract calls `start_game()` and `end_game()` on the Game Hub.
- ✅ **Contract on Testnet**: Deploy the WASM and set the contract ID in the app.
- ✅ **Frontend**: Connect wallet, start game, play, submit on death, leaderboard.
- ✅ **Open source**: This repo.

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
