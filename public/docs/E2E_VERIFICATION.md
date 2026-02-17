# E2E verification checklist (Hackathon demo)

Use this checklist before presenting to confirm the full flow works.

## Demo para jueces (verificación visual)

**Flujo completo que deben ver los jueces:**

1. **Iniciar run** → Conectar Freighter → **Start Game** → firma `start_match()` → el contrato llama `start_game()` al Game Hub.
2. **Jugar off-chain** → El jugador juega en el navegador hasta morir (health 0).
3. **Al morir** → El cliente pide proof al prover → envía `submit_zk` al contrato → verifier valida proof on-chain → leaderboard actualizado.
4. **Verificar on-chain** → En Stellar Expert (Policy o Game Hub), ver `submit_zk` / `end_game` y entradas en el leaderboard.

**Mensaje esperado al morir:** "Submitted to ZK leaderboard" o "Submitted to casual leaderboard".

**Circuito real:** El circuito Circom exige `score >= wave * 10`; una proof inválida (p. ej. score < wave*10) no verifica. Anti-replay: mismo (player, nonce, season_id) no puede usarse dos veces.

## Contract tests (automated)

**Opción rápida (proof real + tests):**

```bash
npm run zk:e2e
```

Compila circuito, genera proof real (score=100, wave=5) y ejecuta los tests de verifier + policy (incl. `test_real_proof_verifier_and_submit_zk`).

**O manualmente (desde repo root):**

```bash
npm run zk:proof   # genera contract_proof.json
cd contracts
cargo test -p groth16_verifier -p shadow_ascension
```

All tests should pass. These cover verifier behaviour, policy init, `submit_zk` (anti-replay, invalid proof, valid proof), and `submit_result`.

## Manual E2E (game + chain)

1. **Deploy and config**
   - [ ] Verifier and policy deployed on Stellar Testnet (see [DEPLOY_ZK_STEPS.md](DEPLOY_ZK_STEPS.md)). Current deployment: Policy `CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO`, Verifier `CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA`.
   - [ ] Policy initialized: `init(game_hub)`, `set_verifier(verifier_id)` (already done for the IDs above).
   - [ ] Frontend: `.env` has `VITE_SHADOW_ASCENSION_CONTRACT_ID=CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO` (or your POLICY_ID) and `VITE_ZK_PROVER_URL` (local or production prover).

2. **Start game**
   - [ ] Connect wallet (Freighter) on title screen — **required to play**; the game requires a linked Freighter account.
   - [ ] If ZK prover is configured, menu shows "START GAME (ZK Ranked)".
   - [ ] Click **Start Game** (new run, not Continue). Sign the transaction.
   - [ ] Optional: On Stellar Expert, open the Game Hub contract and confirm a `start_game` invocation from your policy.

3. **Play and die**
   - [ ] Play until death (health reaches 0).
   - [ ] On death you see BITS earned and one of: "Submitted to ZK leaderboard", "Submitted to casual leaderboard", or "Could not submit to chain".
   - [ ] Optional: On Stellar Expert, confirm `end_game` on the Game Hub and/or `submit_zk` / `submit_result` on the policy.

4. **Fallback**
   - [ ] If the ZK prover is down or returns an error, the game should fall back to `submit_result` (casual) and show "Submitted to casual leaderboard" (or "Could not submit to chain" if that also fails).

5. **Leaderboard**
   - [ ] Open Leaderboard in the game; if using on-chain data, entries should reflect recent runs.
   - [ ] Ranked runs (ZK) update the per-season leaderboard; casual runs update the legacy leaderboard.

## Production (GitHub Pages)

- [ ] Repo secrets set: `VITE_SHADOW_ASCENSION_CONTRACT_ID`, `VITE_ZK_PROVER_URL` (public prover URL).
- [ ] After push to `main`, the built game uses these and shows ZK Ranked when the prover is configured.
- [ ] Judges can play at the deployed URL (they must connect Freighter to play), and see submissions on-chain.
