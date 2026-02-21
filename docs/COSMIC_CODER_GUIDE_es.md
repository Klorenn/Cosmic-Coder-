# Cosmic Coder — Guía completa del juego y ZK

**Versión:** 0.8.x · Documentación de referencia y uso.

---

## Parte 1 — Cómo funciona el juego

### 1.1 Qué es Cosmic Coder

**Cosmic Coder** (Codificador Cósmico) es un juego de supervivencia al estilo *Vampire Survivors*: controlas a un personaje en una arena, matas oleadas de enemigos, subes de nivel, desbloqueas armas y mejoras, y tratas de aguantar el máximo de oleadas posible. Cuando mueres, tu partida se registra (local y, si tienes wallet conectada, en blockchain). El juego tiene dos modos de envío a chain: **casual** (legacy) y **ranked** (con prueba ZK).

- **Requisito para jugar:** Tienes que **vincular sí o sí** tu cuenta de **[Freighter](https://www.freighterapp.com/)** en la pantalla de título para poder jugar. El juego exige una wallet de Stellar conectada (extensión Freighter en el navegador).
- **Objetivo:** Sobrevivir el máximo de oleadas, acumular XP (puntuación) y aparecer en el ranking.
- **Motor:** Phaser (navegador); la lógica de partida corre off-chain. Solo al morir se envía resultado a contratos en Stellar/Soroban si está configurado.

---

### 1.2 Controles y flujo básico

- **Movimiento:** WASD o flechas (o controles táctiles en móvil).
- **Ataque:** Automático según el arma equipada; no hay botón de disparo.
- **Oleadas:** Cada cierto tiempo aparece una nueva oleada con más y/o más duros enemigos. El número de oleada (`wave`) sube (1, 2, 3, …).
- **XP y puntuación:** Los enemigos dan XP al morir; tu **puntuación** en la partida es el **XP total** acumulado (se usa como *score* en el contrato).
- **Muerte:** Cuando tu vida llega a 0, la partida termina: se guarda el récord local, se puede enviar a chain (casual o ranked) y recibes BITS (moneda interna) según oleada, kills y XP.

---

### 1.3 Oleadas, enemigos y etapas

- **Oleadas:** Cada oleada aumenta la dificultad: más enemigos base por oleada y tipos de enemigos que entran en el pool según `waveMin` (p. ej. bugs desde oleada 0, glitch desde 3, “memory-leak” desde 5, etc.).
- **Enemigos:** Muchos tipos (bug, glitch, syntax-error, infinite-loop, segfault, dependency-hell, bosses, etc.) con comportamientos distintos: persecución, teletransporte, órbita, errático, spawner, invisibilidad, etc.
- **Jefes (bosses):** Aparecen en oleadas fijas (p. ej. Stack Overflow en 20, Null Pointer en 40, Memory Leak Prime en 60, Kernel Panic en 80). Dan mucho XP y suponen un pico de dificultad.
- **Etapas (stages):** El mundo tiene etapas temáticas que cambian el ambiente visual según la oleada (Debug Zone, Memory Banks, Network Layer, Kernel Space, Cloud Cluster, Singularity). No cambian la mecánica; son estéticas y de ambientación.

---

### 1.4 Armas y mejoras

- **Armas:** Empiezas con un disparo básico. Durante la partida puedes recoger armas que caen de enemigos o de cajas: spread, pierce, orbital, rapid, homing, bounce, aoe, freeze, y armas especiales (rmrf, sudo, forkbomb, sword, spear, boomerang, kunai, etc.). Cada arma tiene tasa de ataque, daño, número de proyectiles y efectos especiales.
- **Mejoras (upgrades):** Se compran con BITS en el menú principal (fuera de la partida). Mejoran estadísticas base (vida, daño, velocidad, etc.) y se aplican a todas las partidas siguientes.
- **Rebirth:** Sistema de “reinicio” que permite desbloquear más poder a cambio de reiniciar progreso; opcional y avanzado.

---

### 1.5 Puntuación, muerte y guardado

- **Puntuación = XP total** de la partida. Es el valor que se envía al contrato como `score`.
- **Al morir:**
  - Se actualiza el récord local (oleada máxima, puntuación máxima).
  - Se añade la entrada al leaderboard local.
  - Si hay wallet conectada y contrato configurado, se intenta enviar a chain:
    - **Modo casual:** `submit_result(wave, score)` — el contrato puede comprobar reglas básicas (p. ej. `score >= wave * MIN_SCORE_PER_WAVE`).
    - **Modo ranked (ZK):** Si está configurado el prover (`VITE_ZK_PROVER_URL`) y la partida es **nueva** (tienes `runSeed`), se calcula `run_hash`, se pide la proof al backend y se llama `submit_zk` con proof, VK y señales públicas.
  - Se otorgan BITS según oleada, kills y XP.
- **Guardado:** Puedes guardar la partida y “Continuar” desde el menú; eso restaura posición, oleada, vida, etc. Si **continuas** una partida, no se usa flujo ZK al morir (no hay runSeed de partida nueva), así que esa muerte se envía como casual si se envía.

---

### 1.6 Modos: casual vs ranked

| | Casual | Ranked (ZK) |
|--|--------|-------------|
| **Qué se envía** | `submit_result(wave, score)` | `submit_zk(proof, vk, pub_signals, …)` |
| **Comprobación on-chain** | Reglas básicas (score, wave) | Verificación ZK (zk_verifier) de la proof |
| **Cuándo se usa** | Sin prover ZK o partida “Continuar” | Partida **nueva** + prover configurado + contrato con verifier |
| **Leaderboard** | Legacy (oleada + puntuación) | Por temporada (season_id), solo score |

Para **ranked** necesitas: (1) wallet conectada, (2) contrato (Cosmic Coder) configurado con verifier, (3) backend prover (`VITE_ZK_PROVER_URL`) y (4) empezar una partida **nueva** (no “Continuar”) para que exista `runSeed` y se pueda generar y verificar la proof.

---

## Parte 2 — Cómo funciona ZK (a fondo)

### 2.1 Por qué usamos ZK en el juego

En un juego que corre en el navegador, el servidor/contrato no puede “ver” tu partida. Si solo enviaras “llegué a oleada 50 con 100.000 puntos”, cualquiera podría mentir. Con **zero-knowledge (ZK)**:

- **Demuestras** que conoces unos datos (oleada, puntuación, run_hash, nonce, season_id) que cumplen el circuito **sin revelar** cómo jugaste paso a paso.
- El **contrato** solo recibe una **prueba** (proof) y las **señales públicas** (esos números). Verifica la proof con una **clave de verificación (VK)**. Si la ecuación de pairing se cumple, acepta que esa partida es válida para ese score/oleada/run_hash/nonce/season.
- Así el ranking on-chain no depende de que confíes en el cliente: la prueba matemática garantiza que el resultado es coherente con el circuito (mismo run_hash, score, wave, nonce, season_id).

---

### 2.2 Qué es exactamente la “proof” y el circuito

- **Circuito (Circom):** Es un programa que define un “enunciado”: dados unos **inputs privados** y unos **outputs públicos**, el circuito comprueba relaciones entre ellos. En Cosmic Coder, el circuito `GameRun.circom` expone como **salidas públicas**:
  - `run_hash_hi`, `run_hash_lo` (commitment de la partida),
  - `score`, `wave`, `nonce`, `season_id`.
- **Proof (Groth16):** Es un certificado corto (tres elementos de grupo: a, b, c) que demuestra “yo ejecuté el circuito con estos inputs y obtuve estas salidas públicas”. Quien tiene la **verification key (VK)** puede comprobar en cadena que la proof corresponde a esas señales públicas **sin** re-ejecutar el circuito.
- **Verificación on-chain:** El contrato **zk_verifier** recibe (VK, proof, pub_signals), calcula la combinación lineal `vk_x` con las señales públicas y comprueba la ecuación de pairing. Si todo cuadra, devuelve “válido”; el contrato de política (Cosmic Coder) entonces marca el nonce como usado, actualiza el leaderboard de la temporada y emite el evento.

---

### 2.3 Flujo completo del modo ranked (ZK)

1. **Inicio de partida (nueva):** El cliente genera un **runSeed** aleatorio y lo guarda en memoria para esa partida.
2. **Juegas:** Oleadas, enemigos, XP, etc. (todo off-chain).
3. **Muerte:** Se calcula:
   - `run_hash = H(player || wave || score || runSeed || timestamp)` (SHA-256 en el cliente).
   - Se valida que (wave, score) cumplan las reglas del juego.
4. **Petición de proof (opción B — backend):** El cliente llama al backend con `run_hash_hex`, `score`, `wave`, `nonce`, `season_id`. El backend escribe `input.json`, ejecuta el prover (snarkjs) y devuelve `contract_proof.json` (proof + VK + pub_signals en formato para el contrato).
5. **Envío on-chain:** El cliente firma y llama `submit_zk` al contrato Cosmic Coder con:
   - proof, VK, pub_signals,
   - nonce, run_hash (32 bytes), season_id, score, wave,
   - y se autoriza como `player`.
6. **En el contrato:**
   - Se comprueba que el verifier esté configurado, que la VK tenga la forma correcta (`ic.len() == pub_signals.len() + 1`), que score > 0 y wave > 0.
   - Se comprueba anti-replay: si (player, nonce, season_id) ya se usó, devuelve `Replay`.
   - Se invoca al **zk_verifier** con (VK, proof, pub_signals). Si devuelve `true`, se marca el nonce como usado, se actualiza el leaderboard de la temporada, se llama al Game Hub `end_game` y se emite `zk_run_submitted`.

Así, **todo** el flujo ranked queda atado: mismo run_hash/score/wave/nonce/season en la proof y en el contrato, y la proof solo es válida para esos valores.

---

### 2.4 Run_hash y binding

- **run_hash** es el compromiso de la partida: une jugador, oleada, puntuación, semilla de partida y timestamp. El circuito no “recalcula” el run_hash en detalle; las señales públicas incluyen run_hash_hi y run_hash_lo para que el contrato y la proof estén ligados al mismo commitment.
- En el cliente, `run_hash` se calcula con `computeGameHash(playerAddress, wave, score, runSeed, timestamp)`. El backend genera la proof con ese run_hash (y el resto de inputs); el contrato recibe el mismo run_hash en `submit_zk` para consistencia y opcionalmente para comprobaciones futuras.

---

### 2.5 Anti-replay y nonce

- Cada envío ranked usa un **nonce** (p. ej. timestamp). El contrato guarda `ReplayKey = (player, nonce, season_id)`. Si intentas enviar otra vez con el mismo (player, nonce, season_id), el contrato responde `Replay` y no llama al verifier.
- La proof incluye el nonce como señal pública; no puedes reutilizar la misma proof con otro nonce sin generar otra proof. Así se evita reenviar la misma partida varias veces para inflar el ranking.

---

### 2.6 Resumen técnico rápido

- **Circuito:** 6 salidas públicas (run_hash hi/lo, score, wave, nonce, season_id). VK con `ic` de longitud 7.
- **Proof:** Groth16 (a, b, c); verificación con BN254 en Soroban.
- **Contratos:** `zk_types` (tipos compartidos), `zk_verifier` (solo verifica proof), `cosmic_coder` (política: replay, leaderboard, eventos, Hub).
- **Documentación técnica detallada:** Ver `TECHNICAL_DOCUMENTATION.md` y `ZK_REAL_SETUP.md` (requisitos, compilación del circuito, scripts, opción B, checklist).

---

*Fin de la guía. Para detalles de implementación y referencias de contratos, consulta la documentación técnica y la guía ZK en los enlaces siguientes.*
