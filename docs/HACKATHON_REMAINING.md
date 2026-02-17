# Lo que aún falta / What still needs to be done

Estado actual y mejoras pendientes para cumplir totalmente los requisitos del hackathon.

---

## 1. Circuito ZK real

**Estado actual**

- ✅ Circuito Circom existe: `circuits/GameRun.circom`
- ✅ **Circuito valida regla**: `score >= wave * 10` (usando `GreaterEqThan` de circomlib)
- ✅ Genera proof real: `scripts/zk/generate_proof.js` → `circuits/build/contract_proof.json`
- ✅ Tests con proof real: `test_real_proof_verifier_and_submit_zk` pasa

**Hecho**

- Constraint añadida en `GameRun.circom`; circomlib como devDependency.
- Recompilación y regeneración de proof; `contract_proof.json` actualizado.

---

## 2. Pruebas end-to-end con proof real

**Estado actual**

- ✅ `test_real_proof_verifier_and_submit_zk` existe: carga `contract_proof.json`, verifica proof en el verifier y llama `submit_zk` en la policy.
- ✅ Script E2E: `npm run zk:e2e` — compila circuito, genera proof real, ejecuta tests (verifier + policy).
- ✅ Anti-replay cubierto en `test_submit_zk_anti_replay` (tests unitarios).

**Hecho**

- `scripts/e2e_zk.sh` + comando `npm run zk:e2e`.

---

## 3. Gameplay / dificultad / balance

**Estado actual**

- ✅ Cambios de balance aplicados: enemigos pegan más (`ENEMY_DAMAGE_MULT`), menos vida (`maxHealth: 100`), menos disparos base (arma basic `attackRate: 0.6`).
- ✅ UI muestra: XP, salud (barra HP), wave, score, BITS.
- ✅ AFK reforzado: `AFK_THRESHOLD_MS` 5s, `AFK_DAMAGE_MULT` 1.75, `AFK_SPAWN_MULT` 1.5, `AFK_WEAPON_NERF` 0.5.

- ✅ UI: GAME OVER, BITS, mensajes de submit claros (ZK/Casual/Failed).

---

## 4. Sistema de apuestas (opcional)

**Estado actual**

- ✅ ZK bits multiplier: +25% BITS al enviar a ZK ranked (incentiva jugar activo y ZK).

---

## 5. Documentación completa

**Estado actual**

- ✅ README.md: en EN/ES, flujo ZK, deploy, cómo jugar.
- ✅ HACKATHON_DO_THIS.md: deploy contratos, prover, secrets.
- ✅ ZK_REAL_SETUP.md, ZK_AND_BALANCE.md: circuito, proof real, balance.
- ✅ E2E_VERIFICATION.md: checklist para demo.

**Qué falta**

- Ejemplo concreto de `submit_zk` con proof real (p. ej. script o snippet JS que use `contract_proof.json`).
- Sección explícita “Para jueces” en README con pasos de verificación visual.

---

## 6. Verificación visual para jueces

**Estado actual**

- ✅ E2E_VERIFICATION.md describe: start run → start_match() → jugar off-chain → morir → submit_zk/submit_result → leaderboard actualizado.
- ✅ Jueces pueden jugar en la URL desplegada si conectan Freighter.

**Qué falta**

- Sección en README “Demo para jueces” con pasos numerados y enlaces a Stellar Expert.
- Asegurar que el mensaje “Submitted to ZK leaderboard” / “Submitted to casual leaderboard” sea claro en la UI.
---

## Resumen de prioridades

| Prioridad | Tarea | Estado |
|-----------|-------|--------|
| Alta | Circuito: constraint `score >= wave*10` | ✅ Hecho |
| Alta | Script E2E: generar proof + correr tests | ✅ Hecho |
| Media | README: sección “Para jueces” | ✅ Hecho |
| Media | Ejemplo submit_zk con proof real | ✅ ZK_REAL_SETUP.md |
| Baja | Refuerzo anti-AFK | ✅ Hecho |
| Opcional | Sistema de apuestas (ZK multiplier) | ✅ Hecho |

**Nota:** Tras añadir la constraint al circuito, el VK cambió. Para Testnet/producción hay que **redesplegar el verifier** con el nuevo VK.

---

## Comandos útiles

```bash
# E2E completo: circuito + proof real + tests
npm run zk:e2e

# O paso a paso:
npm run zk:proof   # genera contract_proof.json
cd contracts && cargo test -p groth16_verifier -p shadow_ascension

# Correr juego local
npm run dev

# Servidor con prover ZK
npm run server
```
