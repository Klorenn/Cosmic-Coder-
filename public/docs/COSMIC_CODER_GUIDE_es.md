# Cosmic Coder — Guía Completa

**Documentación de referencia y uso. Versión 0.7.x**

---

## 1. Introducción

**Cosmic Coder** es un juego de supervivencia al estilo Vampire Survivors construido sobre Phaser 3 y Stellar/Soroban. Controlas un personaje en una arena vista cenital, eliminas oleadas de enemigos, subes de nivel, desbloqueas armas y mejoras, e intentas sobrevivir el máximo de oleadas posible. Al morir, tu partida se registra localmente y, si la wallet está conectada y el contrato configurado, en blockchain. El juego soporta dos modos on-chain: **casual** (comprobación básica de reglas) y **ranked** (verificación mediante prueba de conocimiento cero).

**Requisitos:** Es obligatorio conectar la wallet [Freighter](https://www.freighterapp.com/) en la pantalla de título para jugar y enviar a chain.

---

## 2. Fundamentos del Gameplay

### 2.1 Controles

| Acción | Entrada |
|--------|---------|
| Movimiento | WASD o flechas |
| Ataque | Automático (sin botón de disparo) |
| Táctil | Soportado en móvil |

### 2.2 Bucle Principal

1. **Iniciar partida** — Conectar Freighter; firmar `start_match`. El contrato registra tu sesión con el Stellar Game Hub.
2. **Jugar** — Las oleadas aparecen; los enemigos dan XP; caen armas y mejoras. Puntuación = XP total acumulado.
3. **Muerte** — La partida termina. Si la wallet y el contrato están configurados, el cliente intenta un envío on-chain (casual o ranked).
4. **Post-partida** — Se otorgan BITS; se actualizan leaderboards local y on-chain.

### 2.3 Oleadas y Dificultad

- Cada oleada aumenta la dificultad: más enemigos base y mayor escalado.
- Los tipos de enemigos entran al pool en umbrales de oleada definidos (`waveMin`).
- Oleadas de jefes (p. ej. 20, 40, 60, 80) hacen aparecer jefes nombrados con más vida y recompensas de XP.

### 2.4 Armas

- **Básica:** Proyectil único; arma inicial.
- **Recogidas:** spread, pierce, orbital, rapid, homing, bounce, aoe, freeze; especiales (rmrf, sudo, forkbomb, sword, spear, boomerang, kunai).
- **Evolución:** Ciertas combinaciones de armas pueden evolucionar en variantes más fuertes.
- Cada arma tiene tasa de ataque, daño, número de proyectiles y efectos.

### 2.5 Mejoras (Permanentes)

Compradas con BITS en el menú principal. Mejoran estadísticas base (vida, daño, velocidad, tasa de ataque, ganancia de XP, probabilidad de crítico, duración). Se aplican a todas las partidas futuras.

### 2.6 Rebirth

Sistema de prestigio opcional. Reinicia progreso a cambio de multiplicadores permanentes. Función avanzada.

---

## 3. Puntuación y Envío On-Chain

### 3.1 Definición de Puntuación

**Puntuación = XP total** acumulado en la partida. Es el valor enviado al contrato como `score`. El contrato lo usa para el ranking del leaderboard y la validación.

### 3.2 Regla de Validación

Tanto el cliente como el contrato exigen:

**score ≥ wave × MIN_SCORE_PER_WAVE** (por defecto 10 por oleada)

Esto evita envíos con puntuación desproporcionadamente baja para la oleada alcanzada. Ejemplo: oleada 5 requiere al menos 50 de puntuación; oleada 10 al menos 100.

### 3.3 Casual vs Ranked

| Modo | Cuándo se usa | Qué se envía | Verificación on-chain |
|------|---------------|--------------|------------------------|
| **Casual** | Sin prover ZK, o partida "Continuar" | `submit_result(wave, score)` | Regla: score ≥ wave × 10 |
| **Ranked** | Partida nueva + prover configurado + contrato verifier | `submit_zk(proof, vk, pub_signals, …)` | Verificación de prueba Groth16 |

**Para ranked:** Inicia una partida **nueva** (no "Continuar"). La partida necesita un `runSeed` generado al inicio; las partidas "Continuar" no tienen runSeed fresco y por tanto no pueden producir prueba ZK.

---

## 4. Conocimiento Cero (ZK) en Cosmic Coder

### 4.1 ¿Por Qué ZK?

El juego se ejecuta en el navegador. El contrato no puede observar tu partida. Si el cliente solo enviara "llegué a oleada 50 con 100.000 puntos", cualquiera podría enviar datos falsos. Las **pruebas de conocimiento cero** permiten al cliente demostrar que conoce inputs que satisfacen un circuito (run_hash, score, wave válidos) **sin** revelar la ejecución privada.

**Propiedad de seguridad:** El contrato no confía en el cliente. La aceptación depende únicamente de la verificación criptográfica de la prueba.

### 4.2 Groth16 y BN254

- **Groth16:** zk-SNARK con pruebas y claves de verificación de tamaño constante. Ampliamente usado (p. ej. Ethereum); herramientas maduras (Circom, snarkjs).
- **BN254:** Curva elíptica usada para Groth16 en Cosmic Coder. Stellar/Soroban soporta BN254 vía [CAP-0074](https://stellar.github.io/stellar-protocol/master/core/cap-0074.html).

### 4.3 Circuito y Prueba

- **Circuito (Circom):** Define el enunciado. Salidas públicas: `run_hash_hi`, `run_hash_lo`, `score`, `wave`, `nonce`, `season_id`.
- **Prueba (Groth16):** Certificado corto (tres elementos de grupo) que demuestra "ejecuté el circuito con estos inputs y obtuve estos outputs".
- **Verificación:** El contrato verificador Groth16 comprueba la ecuación de pairing. Si se cumple, el contrato de política acepta y actualiza el leaderboard.

### 4.4 Run Hash

`run_hash = H(player || wave || score || runSeed || timestamp)` (SHA-256)

- **runSeed:** Valor aleatorio generado al iniciar la partida; se mantiene en memoria solo para esa partida.
- **Binding:** La prueba se liga a este run_hash; manipular score o wave invalida la prueba.

### 4.5 Anti-Replay

- Cada envío ranked usa un **nonce** único (p. ej. timestamp).
- El contrato guarda **ReplayKey = (player, nonce, season_id)**.
- Envíos duplicados con el mismo triple devuelven `Replay`; el verificador no se invoca.
- El nonce es señal pública del circuito; la prueba no puede reutilizarse con otro nonce sin generar otra prueba.

### 4.6 Flujo Ranked Completo

1. Inicio de partida nueva → Cliente genera `runSeed`; lo guarda en memoria.
2. Jugar → Oleadas, enemigos, XP (todo off-chain).
3. Muerte → Cliente calcula `run_hash`; valida (wave, score).
4. Petición de prueba → Cliente llama al backend `POST /zk/prove` con run_hash_hex, score, wave, nonce, season_id.
5. Backend → Ejecuta prover Groth16 snarkjs; devuelve contract_proof.json.
6. Envío → Cliente firma y llama `submit_zk` en Shadow Ascension con proof, VK, pub_signals, nonce, run_hash, season_id, score, wave.
7. Contrato → Comprueba anti-replay; invoca verificador Groth16; si correcto, actualiza leaderboard, llama Game Hub `end_game`, emite `zk_run_submitted`.

---

## 5. Stellar y Soroban

### 5.1 Red Stellar

[Stellar](https://stellar.org) es una blockchain pública para pagos rápidos y de bajo coste. [Soroban](https://soroban.stellar.org) es la plataforma de contratos inteligentes de Stellar.

### 5.2 Wallet Freighter

[Freighter](https://www.freighterapp.com/) es una extensión de wallet para Stellar. Usada para conexión, firma de `start_match` y `submit_zk`/`submit_result`, y autorización de todas las acciones on-chain.

### 5.3 Integración con Game Hub

El Stellar Game Hub gestiona el ciclo de vida de sesiones. Shadow Ascension llama `start_game` al iniciar la partida y `end_game` al terminar, asegurando cumplimiento con el estándar Stellar Game Studio.

### 5.4 Testnet

El juego apunta a Stellar Testnet para desarrollo y evaluación.

---

## 6. Resumen de Contratos

| Contrato | Rol |
|----------|-----|
| **shadow_ascension** | Política: start_match, submit_result, submit_zk, get_leaderboard. Replay, leaderboard, llamadas al Hub. |
| **groth16_verifier** | Verificación de pruebas BN254 sin estado. |
| **zk_types** | Tipos y errores ZK compartidos. |

**Funciones principales:**

- **start_match(player)** — Registra sesión; llama Hub start_game.
- **submit_result(player, wave, score)** — Envío casual; comprobación de regla; llama Hub end_game.
- **submit_zk(...)** — Envío ranked; anti-replay; invoca verificador; actualiza leaderboard; llama Hub end_game.
- **get_leaderboard(season_id)** — Devuelve entradas ranked de esa temporada.

---

## 7. Documentación Adicional

- **HOW_IT_WORKS.md** — Documentación técnica completa.
- **TECHNICAL_DOCUMENTATION.md** — Referencia formal (circuito, VK, pairing, seguridad).
- **ZK_AND_BALANCE.md** — Flujo ZK, anti-replay, reglas de validación.
- **ZK_REAL_SETUP.md** — Requisitos, compilación del circuito, scripts, checklist.

---

*Cosmic Coder — Guía Completa · Versión 0.7.x*
