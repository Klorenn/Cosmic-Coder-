# Cosmic Coder — Technical Documentation

**Version:** 0.7.x  
**Status:** Technical reference. Formal, precise language. No marketing content.

---

# 1. Executive Summary

Cosmic Coder is a Vampire-Survivors-style survival game with an off-chain Phaser front-end and on-chain ranked mode on Stellar/Soroban. Ranked scores are accepted only when accompanied by a zero-knowledge (ZK) proof that attests to a valid run. The system comprises: (1) an off-chain game engine and ZK proof generation, (2) a ZK verifier contract (zk_verifier, BN254), (3) a policy contract (Cosmic Coder) that enforces replay protection and maintains a per-season leaderboard, and (4) integration with a Stellar Game Hub for session lifecycle. All ZK-related types are shared via a single crate (`zk_types`); the verifier has no game logic; the policy delegates proof verification to the verifier and handles replay, leaderboard updates, and events.

---

**Resumen ejecutivo (ES)**  
Cosmic Coder es un juego de supervivencia al estilo Vampire Survivors con front-end off-chain en Phaser y modo ranked on-chain en Stellar/Soroban. Las puntuaciones ranked solo se aceptan cuando van acompañadas de una prueba de conocimiento cero (ZK) que acredita una partida válida. El sistema consta de: (1) motor de juego off-chain y generación de pruebas ZK, (2) contrato verificador ZK (zk_verifier, BN254), (3) contrato de política (Cosmic Coder) que aplica protección anti-replay y mantiene un leaderboard por temporada, y (4) integración con un Game Hub de Stellar para el ciclo de vida de sesión. Los tipos ZK se comparten en un único crate (`zk_types`); el verificador no contiene lógica de juego; la política delega la verificación en el verificador y gestiona replay, leaderboard y eventos.

---

# 2. System Architecture

## 2.1 Components

- **Off-chain game engine (Phaser)**  
  The game runs in the browser. Phaser handles rendering, input, and game logic. Run outcomes (wave, score, run_hash, nonce, season_id) are committed in the circuit’s public inputs. The client computes or obtains a run_hash (e.g. from `gameProof.computeGameHash`), then requests a ZK proof from a prover (WASM from Circom/snarkjs or similar) and submits proof, verification key (VK), and public signals to the policy contract.

- **ZK proof generation layer**  
  A Circom circuit (`GameRun.circom`) defines the statement. Inputs are private; public inputs (run_hash_hi, run_hash_lo, score, wave, nonce, season_id) are exposed. snarkjs (Groth16) produces the proof and the verification key. A script exports proof and VK into the binary format expected by the Soroban verifier (G1/G2 points and field elements as fixed-size byte arrays).

- **Soroban policy contract (Cosmic Coder)**  
  Single entry point for ranked submission: `submit_zk`. It checks that a verifier is set, validates VK shape (e.g. `ic.len() == pub_signals.len() + 1`), enforces `score > 0` and `wave > 0`, checks anti-replay for `(player, nonce, season_id)`, invokes the ZK verifier contract (zk_verifier), and on success marks the nonce used, updates the per-season leaderboard (by score), notifies the Game Hub (`end_game`), and emits a `zk_run_submitted` event.

- **ZK verifier contract (zk_verifier)**  
  Stateless. Accepts a verification key, a proof, and a list of public signals (each 32 bytes). It checks that `vk.ic.len() == pub_signals.len() + 1`, deserializes points (G1/G2) and scalars (Fr), computes the linear combination `vk_x = ic[0] + sum(pub_signals[i] * ic[i+1])`, and runs the BN254 pairing check. Returns `Ok(true)` if the proof is valid, or an error (e.g. `MalformedVerifyingKey`).

- **Stellar Game Hub**  
  External contract that the policy calls for session lifecycle: `start_game` when a match starts (from `start_match`), `end_game` when a run ends (after `submit_result` or successful `submit_zk`). The policy stores the Hub address at init and does not implement game rules itself; it only orchestrates calls.

- **Leaderboard state storage**  
  Two stores: (1) **Ranked (ZK):** keyed by `LeaderboardKey { season_id }`, value is a vector of `ScoreEntry { player, score }`, sorted descending by score, updated/inserted on each successful `submit_zk`. (2) **Legacy (casual):** a single `Leaderboard` symbol holding a vector of `LeaderboardEntry { player, wave, score }` for non-ZK `submit_result`.

## 2.2 Architecture diagram (ASCII)

```
                    +------------------+
                    |   Browser / App  |
                    +--------+---------+
                             |
         +-------------------+-------------------+
         |                   |                   |
         v                   v                   v
  +-------------+   +----------------+   +------------------+
  |   Phaser    |   |  ZK Prover     |   |  Stellar SDK /    |
  |   Engine    |   |  (WASM/snarkjs)|   |  Wallet (sign)   |
  +-------------+   +----------------+   +------------------+
         |                   |                   |
         |  run_hash,        |  proof, vk,        |  submit_zk(...)
         |  score, wave,     |  pub_signals       |
         |  nonce, season_id |                   |
         +-------------------+-------------------+
                             |
                             v
              +------------------------------+
              |  Soroban (Stellar Network)   |
              +------------------------------+
                             |
         +-------------------+-------------------+
         |                   |                   |
         v                   v                   v
  +-------------+   +----------------+   +------------------+
  | Shadow      |   | Groth16        |   | Stellar Game     |
  | Ascension   |   | Verifier       |   | Hub              |
  | (policy)    |   | (BN254)        |   | (start/end game) |
  +-------------+   +----------------+   +------------------+
         |                   ^                   ^
         | submit_zk         | verify_proof       | start_game
         |------------------>|                    | end_game
         |                   |                    |
         |  Replay store     |  (no state)        |
         |  Leaderboard      |                    |
         |  Events           |                    |
         v                   |                    |
  +-------------+             +--------------------+
  | Persistent |             | zk_types (shared)   |
  | Storage    |             | ZkProof, ZkVk, Error |
  +-------------+             +--------------------+
```

---

**Arquitectura del sistema (ES)**  
Los mismos componentes: motor Phaser off-chain, capa de generación de pruebas ZK (Circom/snarkjs), contrato de política Cosmic Coder, contrato verificador ZK (zk_verifier), Game Hub de Stellar y almacenamiento del leaderboard. El diagrama ASCII muestra el flujo desde el navegador hasta los contratos Soroban y el uso compartido de `zk_types`.

---

# 3. Zero-Knowledge Design

## 3.1 Choice of Groth16

Groth16 is a pairing-based zk-SNARK with constant-size proofs (three group elements: two G1, one G2) and a constant-size verification key. Verification cost is dominated by a small number of pairings and group operations, which maps well to bounded gas and predictable cost on-chain. It is widely used in production (e.g. Ethereum) and has mature tooling (Circom, snarkjs) and a well-understood security story.

---

**Por qué Groth16 (ES)**  
Groth16 ofrece pruebas de tamaño constante y coste de verificación acotado, adecuado para gas on-chain y herramientas maduras (Circom, snarkjs).

---

## 3.2 Choice of BN254

BN254 (alt_bn128) is the curve used in the Groth16 setup and in the Soroban verifier. Stellar/Soroban supports BN254 via CAP-0074, so the verifier contract can use the host’s `env.crypto().bn254()` for pairing and group operations. Byte layout (G1 = 64 bytes, G2 = 128 bytes, Fr = 32 bytes) is chosen to match common serialization (e.g. Ethereum-compatible uncompressed) and the Soroban SDK types.

---

**Por qué BN254 (ES)**  
BN254 está soportada en Soroban (CAP-0074) y permite usar el host para pairings y operaciones de grupo; el tamaño de serialización coincide con el SDK y con convenciones habituales.

---

## 3.3 Trusted setup

Groth16 requires a trusted setup (Powers of Tau and circuit-specific phase) to generate the proving key and verification key. If the setup is compromised, fake proofs can be created. Cosmic Coder uses a public or locally generated `.ptau` and a single contribution for development; for production, a multi-party ceremony is recommended so that the result is secure as long as one participant is honest.

---

**Implicaciones del trusted setup (ES)**  
El setup debe ser confiable; en producción se recomienda una ceremonia multi-participante para reducir la confianza en un único actor.

---

## 3.4 Public input structure

The circuit exposes six public signals (field elements in the BN254 scalar field), serialized as 32-byte big-endian values:

| Index | Name        | Meaning                          |
|-------|-------------|-----------------------------------|
| 0     | run_hash_hi | High 128 bits of run commitment   |
| 1     | run_hash_lo | Low 128 bits of run commitment    |
| 2     | score       | Final score (u32)                 |
| 3     | wave        | Final wave (u32)                  |
| 4     | nonce       | Replay token (u64)                |
| 5     | season_id   | Season for leaderboard (u32)      |

The contract receives `pub_signals` as `Vec<BytesN<32>>`. The verifier requires `vk.ic.len() == pub_signals.len() + 1` (here 7 entries in `ic`).

---

**Estructura de las entradas públicas (ES)**  
Seis señales públicas: run_hash (hi/lo), score, wave, nonce, season_id; el contrato las recibe como vectores de 32 bytes y exige que `ic` tenga longitud 7.

---

## 3.5 Proof format (a, b, c)

A Groth16 proof consists of three group elements:

- **a** — G1 (64 bytes: x ∥ y, 32 bytes each, big-endian).
- **b** — G2 (128 bytes: x₁ ∥ x₀ ∥ y₁ ∥ y₀ in common snarkjs/Ethereum order).
- **c** — G1 (64 bytes, same as a).

The contract type is `ZkProof { a: BytesN<64>, b: BytesN<128>, c: BytesN<64> }`. Deserialization uses the BN254 host: `Bn254G1Affine::from_bytes`, `Bn254G2Affine::from_bytes`. Invalid encodings can cause verification to fail or host errors.

---

**Formato de la prueba (a, b, c) (ES)**  
La prueba tiene tres elementos: a y c en G1 (64 bytes cada uno), b en G2 (128 bytes); el contrato los deserializa con las APIs BN254 del host.

---

## 3.6 Verification key structure (alpha, beta, gamma, delta, ic)

The verification key is:

- **alpha** — G1 (64 bytes).
- **beta** — G2 (128 bytes).
- **gamma** — G2 (128 bytes).
- **delta** — G2 (128 bytes).
- **ic** — vector of G1 points; length must be `num_public_inputs + 1`. For six public inputs, `ic` has 7 elements. Used to compute the public-input linear combination.

Contract type: `ZkVerificationKey { alpha, beta, gamma, delta, ic }`. Malformed lengths (e.g. `ic.len() != pub_signals.len() + 1`) are rejected with `MalformedVerifyingKey` / `MalformedVk`.

---

**Estructura de la clave de verificación (ES)**  
VK contiene alpha (G1), beta, gamma, delta (G2) e ic (vector de G1 de longitud 7); la longitud de ic se valida frente a pub_signals.

---

## 3.7 Pairing equation (conceptual)

Verification checks:

`e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1`

where:

- **A, B, C** are the proof elements (a, b, c).
- **α, β, γ, δ** come from the verification key.
- **vk_x** = ic[0] + ∑ᵢ (pub_signals[i] · ic[i+1]) (linear combination of public inputs in G1).

The verifier computes vk_x, then runs the host’s pairing check on the two lists of points (G1 and G2). The equation holds if and only if the proof was generated for the same circuit, VK, and public inputs.

---

**Ecuación de pairing (ES)**  
Se comprueba que el producto de los pairings indicados sea la identidad; vk_x es la combinación lineal de las entradas públicas con ic; la verificación la realiza el host BN254.

---

## 3.8 Constraint: score ≥ wave × MIN_SCORE_PER_WAVE

The policy enforces **score > 0** and **wave > 0** for `submit_zk`. The rule that score must be at least `wave * MIN_SCORE_PER_WAVE` (e.g. 5 per wave) is enforced in the **legacy** path (`submit_result`) with an explicit check. For the ZK path, the same rule can be encoded as a circuit constraint so that only runs satisfying it produce valid proofs; the current Circom circuit binds the public inputs and can be extended with that inequality. The on-chain policy does not re-check that inequality for `submit_zk`; it relies on the verifier and the circuit design.

---

**Restricción score ≥ wave × MIN_SCORE_PER_WAVE (ES)**  
En modo legacy se comprueba en contrato; en modo ZK puede imponerse en el circuito; el contrato solo exige score > 0 y wave > 0 en submit_zk.

---

## 3.9 Nonce and replay prevention

Each ranked submit is tied to a **nonce** chosen by the client (e.g. incrementing or timestamp-based). The policy stores a **ReplayKey (player, nonce, season_id)**. Before calling the verifier, it checks whether this key is already marked as used; if so, it returns `Replay`. After a successful verification, it sets that key to used. Thus the same (player, nonce, season_id) cannot be used twice. The nonce is also a public input of the circuit, so the proof binds to that nonce and the contract can reject re-submission of the same proof for the same triple.

---

**Nonce y prevención de replay (ES)**  
ReplayKey = (player, nonce, season_id) se almacena como usado tras un submit_zk exitoso; un segundo intento con el mismo triple devuelve Replay; el nonce también está ligado a la prueba.

---

# 4. Contract-Level Design

## 4.1 zk_types crate

- **Purpose:** Single source of truth for ZK-related types and errors used by the verifier and the policy. Avoids duplication and ensures consistent serialization (e.g. G1_SIZE, G2_SIZE, FR_SIZE).
- **`#[contracttype]`:** Applied to `ZkProof` and `ZkVerificationKey` so they are (de)serialized correctly when passed between contracts or from the host. Ensures ABI compatibility with the Soroban tooling.
- **`no_std`:** The crate is `#![no_std]` so it can be used in Soroban contracts, which do not link the standard library.
- **Type definitions:**  
  - `ZkProof { a: BytesN<64>, b: BytesN<128>, c: BytesN<64> }`.  
  - `ZkVerificationKey { alpha: BytesN<64>, beta: BytesN<128>, gamma: BytesN<128>, delta: BytesN<128>, ic: Vec<BytesN<64>> }`.
- **Error enum:** `Groth16Error`: `InvalidProof`, `InvalidVerificationKey`, `InvalidPublicInputs`, `MalformedVerifyingKey` (with the note that `vk.ic.len()` must equal `pub_signals.len() + 1`). Used by the verifier; the policy maps these to `CosmicCoderError::VerifierError` or `InvalidProof` as appropriate.

---

**Crate zk_types (ES)**  
Define los tipos y errores ZK compartidos; `#[contracttype]` para ABI; `no_std` para uso en contratos; constantes de tamaño para G1/G2/Fr.

---

## 4.2 zk_verifier

- **Input validation:** The only explicit check is `pub_signals.len() + 1 != vk.ic.len()` → `Err(MalformedVerifyingKey)`. Invalid point or scalar encodings are not validated byte-by-byte; bad data can lead to failed deserialization or an incorrect pairing result (verification fails).
- **ic length check:** Ensures the VK matches the number of public inputs; without it, the linear combination vk_x would be ill-defined or out-of-bounds.
- **Pairing verification:** vk_x is computed as ic[0] + ∑ pub_signals[i] * ic[i+1]. Then the two lists (G1 and G2) are passed to `env.crypto().bn254().pairing_check(vp1, vp2)`. Result is `Ok(true)` if the equation holds, `Ok(false)` otherwise; errors from the host surface as contract failure.
- **Return semantics:** `Result<bool, Groth16Error>`. `Ok(true)` = proof valid for the given VK and public inputs; `Ok(false)` = pairing check failed (invalid or mismatched proof). Any `Err` is due to `MalformedVerifyingKey`.
- **Gas:** Cost is dominated by BN254 operations (pairings, scalar multiplications, additions). Use `stellar contract invoke --sim-only` to measure; the verifier is stateless and does not perform storage or cross-contract calls beyond the host crypto.

---

**Contrato zk_verifier (ES)**  
Valida longitud de ic; calcula vk_x y ejecuta el pairing check; devuelve Ok(true)/Err; el coste en gas viene de las operaciones criptográficas BN254.

---

## 4.3 cosmic_coder policy

- **`set_verifier(verifier: Address)`:** Stores the verifier contract address in persistent storage under the symbol `"Verifier"`. Required before any successful `submit_zk`; if not set, `submit_zk` returns `VerifierNotSet`.
- **`submit_zk(...)`:**  
  - Requires `player` auth.  
  - Reads verifier address; returns `VerifierNotSet` if missing.  
  - Checks `vk.ic.len() == pub_signals.len() + 1` → else `MalformedVk`.  
  - Checks `score > 0` and `wave > 0` → else `InvalidInput`.  
  - Builds `ReplayKey { player, nonce, season_id }`; if already used → `Replay`.  
  - Invokes verifier’s `verify_proof`; on `Err` from verifier or `Ok(false)` → `VerifierError` or `InvalidProof`.  
  - On success: sets replay key to used, calls Hub’s `end_game`, updates per-season leaderboard (insert or update player’s score, sort descending), publishes `zk_run_submitted` event, returns `Ok(())`.
- **Anti-replay storage:** One persistent entry per (player, nonce, season_id), value `true` once the submit has succeeded.
- **Leaderboard updates:** Leaderboard is keyed by `LeaderboardKey { season_id }`. Each entry is `ScoreEntry { player, score }`. On submit, the list is loaded, the player’s existing entry (if any) is updated only if the new score is higher, or a new entry is appended; then the list is sorted by score descending and stored.
- **Event emission:** On successful `submit_zk`, an event is published with topic `zk_run_submitted` and payload including player, season_id, score, wave, run_hash (and empty data in the current implementation). Indexers can use this for off-chain analytics.

---

**Contrato cosmic_coder (ES)**  
set_verifier guarda el verificador; submit_zk valida verifier, VK, score/wave, replay, invoca el verificador, actualiza replay y leaderboard por temporada y emite el evento zk_run_submitted.

---

# 5. Replay Protection Model

- **ReplayKey:** `(player, nonce, season_id)`. Stored in persistent storage; value is `true` after a successful `submit_zk` for that triple.
- **Uniqueness:** For a given player and season_id, the client must use a distinct nonce for each accepted run. If the same (player, nonce, season_id) is submitted again, the policy returns `Replay` without calling the verifier. Thus each proof is accepted at most once per (player, season_id) for that nonce.
- **Why this is sufficient:** The proof binds (among other things) the nonce as a public input. So the proof cannot be reused with a different nonce without recomputing a new proof. And the same nonce cannot be reused because the key is marked used. Cross-season replay is avoided by including season_id in the key; cross-player replay is avoided because the key includes player and the submitter must authorize as that player.

---

**Modelo de protección anti-replay (ES)**  
ReplayKey = (player, nonce, season_id) garantiza unicidad por partida aceptada; el nonce está ligado a la prueba y no puede reutilizarse; season_id y player evitan replay entre temporadas y entre jugadores.

---

# 6. Gas & Resource Simulation

- **Simulation command:** Use the Stellar CLI to simulate without sending a transaction:

  `stellar contract invoke --sim-only --id <CONTRACT_ID> --network testnet -- <METHOD> <ARGS>`

  For `submit_zk`, pass the policy contract ID and all arguments (player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave). For `verify_proof`, pass the verifier contract ID and (vk, proof, pub_signals).

- **Output:** The CLI reports estimated CPU instructions, memory, and other resources. This gives a cost envelope for the transaction before deployment or mainnet use.
- **ZK verifier cost envelope:** Verification is dominated by BN254 pairing and group operations. The number of pairings and multiplications is fixed for a given circuit (six public inputs, so a fixed vk_x computation and one pairing check). Run simulation with a real-sized proof and VK to obtain numbers for the target network and fee model.

---

**Gas y simulación de recursos (ES)**  
`stellar contract invoke --sim-only` permite medir CPU/memoria sin enviar la transacción; el coste del verifier ZK es fijo por verificación y debe comprobarse con una prueba y VK reales.

---

# 7. Security Considerations

- **Malformed VK:** If `ic.len() != pub_signals.len() + 1`, the verifier returns `MalformedVerifyingKey` and the policy returns `MalformedVk`. Supplying a VK with wrong structure does not lead to acceptance of invalid proofs; it causes a clean error.
- **Tampered public inputs:** The proof is valid only for the exact public inputs used during proving. If the client or an intermediary changes pub_signals (e.g. score or wave), the pairing equation fails and the verifier returns false; the policy then returns `InvalidProof`. The contract does not trust the client for the numeric values; it trusts the ZK proof.
- **Cross-statement replay:** Replay is scoped by (player, nonce, season_id). Reusing the same proof with the same nonce for the same player and season is rejected. Using the same proof for a different player would require forging auth for that player. Using the same proof with a different nonce would require a new proof (nonce is a public input). So replay across statements is prevented by both the replay key and the binding of the proof to (nonce, …).
- **Denial-of-service protection:** The policy does not impose rate limiting or resource caps beyond what the network and fee model provide. A user can submit many valid runs (each with a new nonce), which is intended. Invalid submissions (bad proof, replay, etc.) fail and consume the submitter’s resources. Storage growth is bounded by the number of distinct (player, nonce, season_id) and the size of leaderboard vectors; operators can design season duration and limits as needed.
- **Upgrade safety:** The verifier and policy are immutable once deployed. Changing the circuit (e.g. adding constraints) requires a new trusted setup, a new VK, and a new verifier deployment; the policy can then be pointed to the new verifier via `set_verifier` if the policy supports that and the deployer controls the policy. Key point: anyone with the ability to call `set_verifier` can change which verifier is used; that role should be restricted (e.g. admin or DAO) in production.

---

**Consideraciones de seguridad (ES)**  
VK mal formada → error explícito. Entradas públicas manipuladas → la verificación falla. Replay entre enunciados evitado por ReplayKey y por el binding del proof al nonce. DoS mitigado por coste de la tx y por el diseño del almacenamiento. Actualizaciones: nuevos circuitos requieren nuevo verifier y posiblemente nueva política; quien pueda llamar set_verifier debe estar restringido en producción.

---

*End of technical documentation.*
