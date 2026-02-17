# ZK flow, anti-replay and leaderboard — Con balance de dificultad

**Cosmic Coder** usa pruebas de conocimiento cero (Groth16) en Soroban para un leaderboard **provably fair**. Este documento describe el flujo ZK, la anti-replay, el leaderboard por temporada y cómo enviar `submit_zk` desde el frontend con el nuevo balance (daño reducido, escalado de enemigos).

---

## 1. Regla de validación: score >= wave × MIN_SCORE_PER_WAVE

Tanto el **contrato** como el **cliente** exigen que la partida cumpla:

- **score ≥ wave × MIN_SCORE_PER_WAVE** (por ejemplo MIN_SCORE_PER_WAVE = 10).

Así se evitan envíos con puntuación desproporcionadamente baja para la oleada. Con el nuevo balance (armas nerfeadas, enemigos más duros), sigue siendo alcanzable: el jugador gana XP por kills y por completar oleadas; si llega a wave 5, debe tener al menos 50 de score (total XP).

- **En el contrato:** `submit_zk` y `submit_result` comprueban esta regla. Si no se cumple, `submit_zk` devuelve `InvalidInput`.
- **En el cliente:** `validateGameRules(wave, score)` en `src/zk/gameProof.js` devuelve `{ valid, reason }`. El frontend debe validar antes de llamar a `submitZk` / `submitZkFromProver`; además, `submitZk` vuelve a validar y lanza si no se cumple.

---

## 2. Flujo ZK (submit_zk)

1. **Partida nueva:** El cliente genera `runSeed` al iniciar la run.
2. **Al morir:** Se calcula `run_hash = H(player || wave || score || runSeed || timestamp)` (SHA-256).
3. **Validación cliente:** `validateGameRules(wave, score)` → si no válido, no se envía.
4. **Petición de proof (opción B):** El cliente llama al backend `POST /zk/prove` con `{ run_hash_hex, score, wave, nonce, season_id }`. El backend ejecuta el prover (Circom/snarkjs) y devuelve `contract_proof.json`.
5. **Envío on-chain:** El cliente firma y llama `submit_zk(player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave)`.
6. **En el contrato:**  
   - Comprueba verifier configurado, forma de VK, `score > 0`, `wave > 0`, **score ≥ wave × MIN_SCORE_PER_WAVE**.  
   - Comprueba anti-replay: si `(player, nonce, season_id)` ya usado → `Replay`.  
   - Invoca al verifier Groth16; si la proof es válida, marca el nonce como usado, actualiza el leaderboard de la temporada, llama al Game Hub `end_game` y emite el evento `zk_run_submitted`.

La proof real (Circom) se integra usando el mismo flujo: el backend genera la proof con los mismos `run_hash`, `score`, `wave`, `nonce`, `season_id` que luego se envían en `submit_zk`.

---

## 3. Anti-replay (player, nonce, season_id)

- Cada envío ranked usa un **nonce** único (por ejemplo `Date.now()`).
- El contrato guarda **ReplayKey = (player, nonce, season_id)**. Tras un `submit_zk` exitoso, esa clave queda marcada como usada.
- Un segundo envío con el mismo `(player, nonce, season_id)` devuelve **Replay** y no actualiza el leaderboard.
- La proof incluye el nonce como señal pública; no se puede reutilizar la misma proof con otro nonce sin generar otra proof.

---

## 4. Leaderboard on-chain por temporada

- **Ranked (ZK):** El contrato mantiene un leaderboard por **season_id**: `LeaderboardKey { season_id }` → lista de `ScoreEntry { player, score }`, ordenada por score descendente.
- En cada `submit_zk` exitoso: se actualiza o inserta la entrada del jugador (solo se actualiza si el nuevo score es mayor) y se reordena la lista.
- **Evento:** Se emite `zk_run_submitted` con (player, season_id, score, wave, run_hash) para indexadores y analytics.

---

## 5. Cómo enviar submit_zk desde el frontend (JS) con el nuevo balance

Con el balance actual (más difícil), el score total (XP) puede ser menor para la misma oleada; aun así debe cumplir `score >= wave * MIN_SCORE_PER_WAVE`. Ejemplo mínimo:

```javascript
import * as gameClient from './contracts/gameClient.js';
import { validateGameRules, computeGameHash, generateRunSeed } from './zk/gameProof.js';

// 1) Al iniciar partida nueva (no "Continuar")
const runSeed = generateRunSeed(); // guardar en memoria para esta run

// 2) Al morir: wave, score = Math.floor(state.totalXP)
const wave = this.waveNumber;
const score = Math.floor(state.totalXP);

// 3) Validar reglas (obligatorio)
const { valid, reason } = validateGameRules(wave, score);
if (!valid) {
  console.warn('No submit_zk:', reason);
  return;
}

// 4) Opción B: pedir proof al backend y enviar
const run_hash_hex = await computeGameHash(addr, wave, score, runSeed, Date.now());
await gameClient.submitZkFromProver(addr, sign, proverUrl, {
  run_hash_hex,
  score,
  wave,
  nonce: Date.now(),
  season_id: 1
});
```

`submitZk` (y por tanto `submitZkFromProver`) ya llama internamente a `validateGameRules` y lanza si no se cumple la regla.

---

## 6. Tests

- **test_submit_zk_invalid_input_score_below_min:** `submit_zk` con score=40, wave=5 (mínimo 50) debe fallar con InvalidInput.
- **test_submit_zk_valid_updates_nonce_leaderboard_and_emits_event:** Comprueba que tras un `submit_zk` válido el leaderboard por temporada se actualiza.
- **test_real_proof_verifier_and_submit_zk:** Con `circuits/build/contract_proof.json` generado, verifica la proof en el verifier y un `submit_zk` exitoso en la policy.

Los tests usan (wave, score) que cumplen la regla (por ejemplo wave=5 score=100, wave=10 score=200) para reflejar el balance actual.

---

# ¿Por qué no vi la verificación ZK? ¿Por qué no salgo en el leaderboard?

## Qué pasa cuando mueres (memento mori)

1. **Local:** Tu partida se guarda siempre en el leaderboard **local** (y récord de ola/puntos en localStorage).
2. **Envío on-chain** solo ocurre si:
   - Tienes **wallet conectada** (Freighter).
   - El **contrato está configurado:** `VITE_SHADOW_ASCENSION_CONTRACT_ID` en `.env` (ver `.env.example`).
3. **Qué ves en game over:**
   - Si el contrato está configurado y se cumplen las reglas: **"Enviando a la cadena..."** y luego **"✓ ZK RANKED"** (proof enviada), **"✓ CASUAL"** (envío sin ZK) o **"✗ No se pudo enviar a la cadena"** (error de red/contrato).
   - Si el contrato **no** está configurado: no sale "Enviando..."; tu puntuación solo se guarda local.

## ZK vs casual

- **ZK RANKED:** Aparece cuando el juego llama al **prover** (`VITE_ZK_PROVER_URL`, ej. `http://localhost:3333`), obtiene una proof y envía `submit_zk` al contrato. Requiere el backend ZK en marcha y el contrato desplegado con el verifier.
- **CASUAL:** Aparece cuando no se usa ZK (prover no configurado o falló la petición de proof) pero `submit_result` tuvo éxito. Igual apareces en el leaderboard **on-chain**.
- Si ambos fallan, ves **"✗ No se pudo enviar a la cadena"** y **no** apareces en el leaderboard de **cadena** (solo local).

## Por qué el leaderboard está vacío o no sales

- El panel **TOP PLAYERS** del menú lee del **contrato Soroban** (`get_leaderboard`), no del servidor local.
- **"No entries yet" / "Aún no hay partidas"** puede ser:
  1. **Contract ID no configurado** — nadie puede enviar; pon `VITE_SHADOW_ASCENSION_CONTRACT_ID` en `.env` y reinicia.
  2. **Contrato desplegado pero nadie ha enviado aún** — juega una partida, **muere**, con wallet y contrato configurados; deberías ver "Enviando..." y luego "✓ ZK RANKED" o "✓ CASUAL". Después abre de nuevo el leaderboard.
  3. **El envío falló** — habrías visto "✗ No se pudo enviar a la cadena" al morir; revisa red, RPC y que el contrato esté desplegado y el prover (para ZK) en marcha.

**Checklist para salir en el leaderboard on-chain:** Conectar wallet → configurar `VITE_SHADOW_ASCENSION_CONTRACT_ID` → jugar → morir → ver "✓ ZK RANKED" o "✓ CASUAL" → volver a abrir el leaderboard.

---

# ZK flow, anti-replay and leaderboard — With difficulty balance (English)

**Cosmic Coder** uses zero-knowledge proofs (Groth16) on Soroban for a **provably fair** leaderboard. This section summarizes the same content in English.

## 1. Validation rule: score >= wave × MIN_SCORE_PER_WAVE

Both the **contract** and the **client** require:

- **score ≥ wave × MIN_SCORE_PER_WAVE** (e.g. MIN_SCORE_PER_WAVE = 10).

This avoids submissions with unreasonably low score for the wave. With the new balance (weapon nerfs, stronger enemies), the rule remains achievable: the player gains XP from kills and wave completion.

- **Contract:** `submit_zk` and `submit_result` enforce this; `submit_zk` returns `InvalidInput` if it fails.
- **Client:** `validateGameRules(wave, score)` in `src/zk/gameProof.js`; the frontend validates before calling `submitZk` / `submitZkFromProver`, and `submitZk` validates again and throws if invalid.

## 2. ZK flow (submit_zk)

1. **New run:** Client generates `runSeed` at run start.  
2. **On death:** Compute `run_hash = H(player || wave || score || runSeed || timestamp)`.  
3. **Client validation:** `validateGameRules(wave, score)`; if invalid, do not submit.  
4. **Proof request (option B):** Client calls backend `POST /zk/prove` with `{ run_hash_hex, score, wave, nonce, season_id }`; backend returns `contract_proof.json`.  
5. **On-chain submit:** Client signs and calls `submit_zk(...)`.  
6. **Contract:** Validates rule, anti-replay, invokes Groth16 verifier; on success, marks nonce used, updates per-season leaderboard, calls Hub `end_game`, emits `zk_run_submitted`.

Real proof (Circom) integrates by having the backend produce the proof with the same inputs used in `submit_zk`.

## 3. Anti-replay

- **ReplayKey = (player, nonce, season_id)**; each successful `submit_zk` marks the key as used.  
- Duplicate (player, nonce, season_id) returns **Replay**.

## 4. Per-season leaderboard

- **Ranked (ZK):** Stored under `LeaderboardKey { season_id }` as a list of `ScoreEntry { player, score }`, sorted by score descending.  
- Updated on each successful `submit_zk` (insert or update only if new score is higher).  
- Event **zk_run_submitted** is emitted for indexing.

## 5. Submitting submit_zk from frontend (JS) with new balance

Ensure `validateGameRules(wave, score)` passes (e.g. score and wave from current run). Then use `submitZkFromProver(addr, sign, proverUrl, { run_hash_hex, score, wave, nonce, season_id })`. The `submitZk` helper already validates and throws if the rule fails.

## 6. Tests

- **test_submit_zk_invalid_input_score_below_min:** score &lt; wave×MIN_SCORE_PER_WAVE → InvalidInput.  
- **test_submit_zk_valid_updates_nonce_leaderboard_and_emits_event:** Leaderboard and nonce updated after valid submit.  
- **test_real_proof_verifier_and_submit_zk:** With `contract_proof.json`, verifies real proof and policy submit.

Tests use (wave, score) pairs that satisfy the rule (e.g. 5/100, 10/200) to match current balance.

---

# Why didn’t I see ZK verification? Why am I not on the leaderboard?

## What happens when you die (memento mori)

1. **Local:** Your run is always saved to the **local** leaderboard (and high wave/score in localStorage).
2. **On-chain submit** only runs if:
   - **Wallet is connected** (Freighter).
   - **Contract is configured:** `VITE_SHADOW_ASCENSION_CONTRACT_ID` in `.env` (see `.env.example`).
3. **What you see on game over:**
   - If contract is configured and rules are valid: **"Submitting to chain..."** then either **"✓ ZK RANKED"** (proof sent) or **"✓ CASUAL"** (fallback without ZK) or **"✗ Could not submit to chain"** (network/contract error).
   - If contract is **not** configured: no "Submitting..." message; your score is only stored locally.

## ZK vs casual

- **ZK RANKED:** Shown when the game calls the **prover** (`VITE_ZK_PROVER_URL`, e.g. `http://localhost:3333`), gets a proof, and sends `submit_zk` to the contract. Requires the ZK backend running and the contract deployed with the verifier.
- **CASUAL:** Shown when ZK is skipped (prover not configured or proof request failed) but `submit_result` succeeded. You still appear on the **on-chain** leaderboard.
- If both fail, you see **"✗ Could not submit to chain"** and you **won’t** appear on the **chain** leaderboard (only local).

## Why is the leaderboard empty / why am I not on it?

- The **TOP PLAYERS** panel in the menu reads from the **Soroban contract** (`get_leaderboard`), not from the local server.
- **"No entries yet"** means either:
  1. **Contract ID not set** — no one can submit; leave `VITE_SHADOW_ASCENSION_CONTRACT_ID` in `.env` and redeploy/restart.
  2. **Contract deployed but no successful submit yet** — play a run, **die**, have wallet connected and contract set; you should see "Submitting..." then "✓ ZK RANKED" or "✓ CASUAL". After that, reopen the leaderboard.
  3. **Submit failed** — you would see "✗ Could not submit to chain" on game over; check network, RPC, and that the contract is deployed and the prover (for ZK) is running.

**Checklist to appear on chain leaderboard:** Connect wallet → set `VITE_SHADOW_ASCENSION_CONTRACT_ID` → play → die → see "✓ ZK RANKED" or "✓ CASUAL" → reopen leaderboard.
