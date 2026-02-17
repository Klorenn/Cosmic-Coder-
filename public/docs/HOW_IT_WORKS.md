# Cosmic Coder — Documentación Técnica

**Referencia completa de mecánicas de juego, pruebas de conocimiento cero, integración con Stellar y contratos inteligentes.**

---

## Resumen Ejecutivo

**Cosmic Coder** es un juego de supervivencia al estilo Vampire Survivors construido sobre Phaser 3, con modo ranked on-chain en **Stellar/Soroban**. El gameplay se ejecuta íntegramente off-chain en el navegador; solo los resultados de partida (oleada, puntuación) se envían a los contratos inteligentes al morir. Las partidas ranked requieren una **prueba de conocimiento cero Groth16** que certifica criptográficamente la validez de la partida. El sistema se integra con el Stellar Game Hub para el ciclo de vida de sesión y mantiene un leaderboard probadamente justo.

**Stack principal:** Phaser 3 (frontend) · Soroban/Rust (contratos) · Circom/snarkjs (ZK) · Freighter (wallet Stellar)

---

## Parte 1 — Mecánicas de Juego

### 1.1 Diseño del Juego

Cosmic Coder es un **juego de supervivencia por oleadas** en el que el jugador controla un único personaje en una arena vista cenital. El objetivo es sobrevivir el máximo de oleadas posible derrotando enemigos, subiendo de nivel y recogiendo armas. Toda la lógica de juego se ejecuta en el cliente; la blockchain se usa exclusivamente para verificación de puntuaciones y persistencia del leaderboard.

**Principios de diseño:**

- **Gameplay off-chain:** Sin latencia ni gas durante la partida. Combate, movimiento y progresión son locales.
- **Verificación on-chain:** Los resultados de partida solo se envían al morir. El contrato verifica la legitimidad mediante prueba ZK (ranked) o reglas básicas (casual).
- **Juego vinculado a wallet:** Se requiere una wallet [Freighter](https://www.freighterapp.com/) conectada para iniciar una partida y enviar a chain.

### 1.2 Controles y Bucle Principal

| Acción | Entrada |
|--------|---------|
| Movimiento | WASD o flechas |
| Ataque | Automático (sin botón de disparo) |
| Táctil | Soportado en móvil |

**Bucle principal:**

1. **Inicio de partida** → La wallet firma `start_match` → El contrato registra la sesión con el Game Hub.
2. **Jugar** → Oleadas aparecen; los enemigos dan XP; caen armas y mejoras.
3. **Muerte** → Puntuación = XP total. El cliente envía `submit_result` (casual) o `submit_zk` (ranked).
4. **Post-partida** → Se otorgan BITS; se actualizan leaderboards local y on-chain.

### 1.3 Sistema de Oleadas

- **Número de oleada** (`wave`) aumenta con cada oleada completada (1, 2, 3, …).
- **Escalado de dificultad:** La cantidad y fuerza base de enemigos escala con la oleada. Nuevos tipos de enemigos entran al pool según umbrales (p. ej. `waveMin` por tipo).
- **Oleadas de jefes:** Oleadas fijas (p. ej. 20, 40, 60, 80) hacen aparecer jefes con más vida y recompensas de XP.

### 1.4 Enemigos y Etapas

**Tipos de enemigos:** bug, glitch, syntax-error, infinite-loop, segfault, dependency-hell, más jefes nombrados (Stack Overflow, Null Pointer, Memory Leak Prime, Kernel Panic, etc.).

**Comportamientos:** Persecución, teletransporte, órbita, movimiento errático, spawner, fases invisibles.

**Etapas:** Zonas temáticas (Debug Zone, Memory Banks, Network Layer, Kernel Space, Cloud Cluster, Singularity) cambian la apariencia visual según la oleada. Solo cosmético; sin efecto en gameplay.

### 1.5 Armas y Mejoras

**Armas (en partida):** Recogidas de enemigos y cajas. Tipos: spread, pierce, orbital, rapid, homing, bounce, aoe, freeze, más especiales (rmrf, sudo, forkbomb, sword, spear, boomerang, kunai). Cada arma tiene tasa de ataque, daño, número de proyectiles y efectos. Las armas pueden **evolucionar** al combinar ciertos tipos.

**Mejoras (permanentes):** Compradas con BITS en el menú. Mejoran estadísticas base (vida, daño, velocidad, tasa de ataque, ganancia de XP, probabilidad de crítico, duración). Se aplican a todas las partidas futuras.

**Rebirth:** Sistema de prestigio opcional; reinicia progreso a cambio de multiplicadores permanentes.

### 1.6 Puntuación, Muerte y Validación

- **Puntuación = XP total** acumulado en la partida. Es el valor enviado al contrato.
- **Regla de validación:** `score ≥ wave × MIN_SCORE_PER_WAVE` (p. ej. 10 por oleada). Se aplica en cliente antes de enviar y on-chain en el contrato.
- **Al morir:** Se actualizan récords locales; se otorgan BITS; se intenta envío on-chain si hay wallet conectada y contrato configurado.

### 1.7 Modos: Casual vs Ranked

| | Casual | Ranked (ZK) |
|--|--------|-------------|
| **Envío** | `submit_result(wave, score)` | `submit_zk(proof, vk, pub_signals, …)` |
| **Verificación** | Regla: `score ≥ wave × 10` | Verificación de prueba Groth16 |
| **Cuándo** | Sin prover o partida "Continuar" | Partida nueva + prover + contrato con verifier |
| **Leaderboard** | Legacy (oleada + puntuación) | Por temporada (solo puntuación) |

---

## Parte 2 — Pruebas de Conocimiento Cero

### 2.1 Motivación

El juego se ejecuta en el navegador. El contrato no puede observar el gameplay. Un cliente podría afirmar "llegué a oleada 50 con 100.000 puntos" sin prueba. Las **pruebas de conocimiento cero** permiten al cliente demostrar que conoce inputs que satisfacen un circuito (p. ej. `run_hash`, `score`, `wave` válidos) **sin** revelar la ejecución privada.

**Propiedad de seguridad:** El leaderboard on-chain no confía en el cliente. La aceptación depende únicamente de la verificación criptográfica de la prueba.

### 2.2 Groth16 y BN254

**Groth16** es un zk-SNARK con pruebas de tamaño constante (tres elementos de grupo) y claves de verificación de tamaño constante. El coste de verificación es acotado y predecible, adecuado para ejecución on-chain. Ver [Groth, 2016](https://eprint.iacr.org/2016/260).

**BN254** (alt_bn128) es la curva elíptica usada para Groth16 en Cosmic Coder. Stellar/Soroban soporta BN254 vía [CAP-0074](https://stellar.github.io/stellar-protocol/master/core/cap-0074.html), permitiendo operaciones nativas de pairing y grupo en el host.

### 2.3 Diseño del Circuito

El circuito (`GameRun.circom`) define un enunciado sobre **inputs privados** y **outputs públicos**. Outputs públicos expuestos al contrato:

| Índice | Nombre | Descripción |
|--------|--------|-------------|
| 0 | `run_hash_hi` | Bits altos (128) del commitment de partida |
| 1 | `run_hash_lo` | Bits bajos (128) del commitment de partida |
| 2 | `score` | Puntuación final (u32) |
| 3 | `wave` | Oleada final (u32) |
| 4 | `nonce` | Token anti-replay (u64) |
| 5 | `season_id` | Temporada del leaderboard (u32) |

El circuito liga estos valores; la prueba certifica que el prover ejecutó el circuito con inputs coherentes y obtuvo estos outputs.

### 2.4 Formato de la Prueba

Una prueba Groth16 consta de tres elementos:

- **a** — G1 (64 bytes)
- **b** — G2 (128 bytes)
- **c** — G1 (64 bytes)

La clave de verificación (VK) contiene `alpha` (G1), `beta`, `gamma`, `delta` (G2) e `ic` (vector de puntos G1). El verificador calcula `vk_x = ic[0] + Σ(pub_signals[i] × ic[i+1])` y comprueba la ecuación de pairing. Ver `zk_types` y `groth16_verifier` en el código.

### 2.5 Run Hash y Binding

`run_hash = H(player || wave || score || runSeed || timestamp)` (SHA-256)

- **runSeed:** Valor aleatorio generado al iniciar la partida; se mantiene en memoria solo para esa partida.
- **Binding:** La prueba se liga a `run_hash` mediante señales públicas. El contrato recibe el mismo `run_hash` en `submit_zk`; el verificador asegura que la prueba cuadra.
- **Integridad:** Manipular `score` o `wave` invalida la prueba; el pairing check falla.

### 2.6 Anti-Replay

- **ReplayKey = (player, nonce, season_id)**. Cada `submit_zk` exitoso marca esta clave como usada.
- Un segundo envío con el mismo triple devuelve `Replay`; el verificador no se invoca.
- El nonce es señal pública del circuito; la prueba no puede reutilizarse con otro nonce sin recomputar.

### 2.7 Flujo Ranked Completo

1. **Inicio de partida nueva** → Cliente genera `runSeed`; lo guarda en memoria.
2. **Jugar** → Oleadas, enemigos, XP (todo off-chain).
3. **Muerte** → Cliente calcula `run_hash`; valida `(wave, score)` según reglas.
4. **Petición de prueba** → Cliente llama al backend `POST /zk/prove` con `{ run_hash_hex, score, wave, nonce, season_id }`.
5. **Backend** → Construye `input.json`; ejecuta prover Groth16 snarkjs; devuelve `contract_proof.json`.
6. **Envío** → Cliente firma y llama `submit_zk` en Shadow Ascension con proof, VK, pub_signals, nonce, run_hash, season_id, score, wave.
7. **Contrato** → Comprueba anti-replay; invoca verificador Groth16; si correcto, actualiza leaderboard, llama Hub `end_game`, emite `zk_run_submitted`.

---

## Parte 3 — Stellar y Soroban

### 3.1 Red Stellar

[Stellar](https://stellar.org) es una blockchain pública para pagos y activos rápidos y de bajo coste. [Soroban](https://soroban.stellar.org) es la plataforma de contratos inteligentes de Stellar, con contratos en Rust y un runtime determinista.

### 3.2 Integración de Wallet (Freighter)

[Freighter](https://www.freighterapp.com/) es una extensión de wallet para Stellar. Cosmic Coder la usa para:

- **Conexión:** El jugador conecta la wallet en la pantalla de título.
- **Firma:** `start_match` y `submit_zk` / `submit_result` requieren la firma del jugador.
- **Autorización:** Todas las acciones on-chain están autorizadas por la wallet; el contrato aplica `player.require_auth()`.

### 3.3 Integración con Game Hub

El **Stellar Game Hub** (`CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` en Testnet) es el contrato de referencia para el ciclo de vida de sesiones:

- **start_game(game_id, session, player, system_player, x, y)** — Llamado por Shadow Ascension en `start_match`.
- **end_game(session, success)** — Llamado tras `submit_result` o `submit_zk` exitoso.

Esta integración asegura cumplimiento con el estándar Stellar Game Studio.

### 3.4 Testnet

El juego apunta a **Stellar Testnet** para desarrollo y evaluación. RPC e IDs de red están configurados para Testnet; el despliegue en mainnet requeriría configuración actualizada.

---

## Parte 4 — Contratos Inteligentes

### 4.1 Arquitectura

| Componente | Rol |
|------------|-----|
| **shadow_ascension** | Contrato de política. Puntos de entrada: `start_match`, `submit_result`, `submit_zk`, `get_leaderboard`. Gestiona almacenamiento anti-replay, actualizaciones del leaderboard y llamadas al Game Hub. |
| **groth16_verifier** | Verificador sin estado. Acepta (VK, proof, pub_signals); ejecuta pairing check BN254; devuelve `Ok(true)` o `Err`. |
| **zk_types** | Crate compartido. Tipos: `ZkProof`, `ZkVerificationKey`; errores: `Groth16Error`, etc. |

### 4.2 Shadow Ascension — Funciones Principales

- **init(game_hub)** — Guarda dirección del Game Hub. El verificador se configura aparte vía `set_verifier`.
- **start_match(player)** — Requiere auth. Incrementa sesión; llama Hub `start_game`.
- **submit_result(player, wave, score)** — Requiere auth. Comprueba `score ≥ wave × MIN_SCORE_PER_WAVE`; llama Hub `end_game`; actualiza leaderboard legacy.
- **submit_zk(player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave)** — Requiere auth. Valida forma de VK, score > 0, wave > 0; comprueba anti-replay; invoca verificador; si correcto, actualiza leaderboard por temporada, llama Hub `end_game`, emite `zk_run_submitted`.
- **get_leaderboard(season_id)** — Devuelve entradas ranked de esa temporada, ordenadas por puntuación descendente.

### 4.3 Groth16 Verifier

- Valida `vk.ic.len() == pub_signals.len() + 1`.
- Deserializa proof (a, b, c) y VK (alpha, beta, gamma, delta, ic).
- Calcula `vk_x`; ejecuta `env.crypto().bn254().pairing_check(...)`.
- Devuelve `Ok(true)` si la ecuación de pairing se cumple; si no, `Ok(false)` o `Err`.

### 4.4 Modelo de Almacenamiento

- **Replay:** Una entrada persistente por `(player, nonce, season_id)`.
- **Leaderboard (ranked):** Clave `LeaderboardKey { season_id }`; valor es vector ordenado de `ScoreEntry { player, score }`.
- **Leaderboard (casual):** Símbolo único `Leaderboard` con `LeaderboardEntry { player, wave, score }`.

---

## Parte 5 — Referencias

- **Stellar Protocol — CAP-0074 (BN254):** https://stellar.github.io/stellar-protocol/master/core/cap-0074.html
- **Circom:** https://docs.circom.io
- **snarkjs:** https://github.com/iden3/snarkjs
- **Freighter:** https://www.freighterapp.com/
- **Soroban:** https://soroban.stellar.org

---

*Cosmic Coder — Documentación Técnica · Versión 0.7.x*
