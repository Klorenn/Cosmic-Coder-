# Pasos para desplegar ZK (Stellar Testnet)

Ejecuta estos comandos **desde la raíz del repo** una vez tengas Stellar CLI configurado y una cuenta con XLM en testnet.

## Contratos desplegados (referencia)

> **Deploy actual (2026-11-11):** `cosmic_coder` = `CAEE26RL4PQ3SDRRDRWY2DUWUELG7YNTXYJUQTM2QFDY6BEU5TUX3F6F`,
> `groth16_verifier` = `CAU6UVGUBSPQPVYV6ZGDVMJJLQJ364YKKEU7O2XM2CYPNISVR5D7E5JY`, VK GameRunV3. Detalle, hashes y
> re-deploy tras reset de testnet: [`TESTNET_DEPLOYMENT.md`](TESTNET_DEPLOYMENT.md).
>
> **OBSOLETO:** los IDs anteriores (`CC73YP4H...` cosmic_coder, `CCQQDZBS...` zk_verifier) corresponden a la version
> v0.2.0 (con `init` y `submit_proof`) y **ya no son compatibles** con el cliente actual. No los uses.
> Despliega de nuevo (ver abajo) y usa el nuevo ID de `cosmic_coder` en `VITE_COSMIC_CODER_CONTRACT_ID`.

Game Hub en Testnet (sin cambios): `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`.

---

## 1. Compilar WASM de los contratos

Usa **rustup** (no Homebrew). Para Soroban testnet hace falta el target **wasm32v1-none** (con `wasm32-unknown-unknown` puede fallar "reference-types not enabled"):

```bash
export PATH="$HOME/.cargo/bin:$PATH"
rustup target add wasm32v1-none
cd contracts
cargo build --target wasm32v1-none --release -p groth16_verifier -p ultrahonk_verifier -p cosmic_coder
cd ..
```

## 2. Desplegar verifier

Necesitas una cuenta en testnet con XLM (p. ej. desde [Friendbot](https://laboratory.stellar.org/#explorer?resource=friendbot&endpoint=create)). Sustituye `<SOURCE>` por tu clave pública (G...) o por un identity de `stellar keys list`.

```bash
cd contracts
stellar contract deploy --source-account <SOURCE> --network testnet --wasm target/wasm32v1-none/release/groth16_verifier.wasm
```

**Guarda el ID que devuelve** como `VERIFIER_ID`.

## 3. Desplegar politica (cosmic_coder) con constructor

`init` ya no existe: el contrato se configura en el deploy con `__constructor(admin, game_hub)` (no hay ventana de
front-running). `<ADMIN>` es la cuenta que luego firma los `set_*`.

```bash
stellar contract deploy --source-account <SOURCE> --network testnet \
  --wasm target/wasm32v1-none/release/cosmic_coder.wasm \
  -- --admin <ADMIN> --game_hub CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
```

**Guarda el ID** como `POLICY_ID`. (`scripts/deploy_contracts_testnet.sh` automatiza los pasos 2-4.)

## 4. Configuracion de admin (todo requiere firma de `<ADMIN>`)

Game Hub: la policy llama `start_game(...)` / `end_game(session, success)` (ver mock en `contracts/cosmic_coder/src/tests.rs`).

```bash
INV="stellar contract invoke --id <POLICY_ID> --source-account <ADMIN> --network testnet --"

# Orden: deploy -> constructor (paso 3) -> set_verifier -> set_run_vk (-> set_unlock_vk)
# Verifier Groth16 (submit_zk, unlock_weapon). El ranked del frontend usa esta ruta.
$INV set_verifier --verifier <VERIFIER_ID>
# VK fijada del circuito GameRun (ic.len() == 8), tomada de circuits/build/contract_proof_v3.json (campo "vk",
# hex sin 0x). submit_zk rechaza cualquier otra VK (error 8 VkMismatch). Sin esto: error 7 VkNotSet.
$INV set_run_vk --vk '<GAMERUN_VK_JSON>'
# VK fijada del circuito SkillProof / unlock (ic.len() == 3). Sin esto unlock_weapon falla con error 7 VkNotSet
$INV set_unlock_vk --vk '<SKILLPROOF_VK_JSON>'
# Solo backend legacy VITE_ZK_BACKEND=noir (submit_zk_noir): requiere un verificador UltraHonk REAL; el
# ultrahonk_verifier del repo es un stub (ranked forjable). deploy_contracts_testnet.sh lo omite salvo ENABLE_NOIR_STUB=1.
# $INV set_noir_verifier --verifier <NOIR_VERIFIER_ID>'
```

Lecturas de comprobacion: `get_admin`, `get_pending_admin`, `get_game_hub`. Rotacion: `set_game_hub`; admin en dos pasos `propose_admin` (admin actual) + `accept_admin` (nuevo admin firma). `set_admin` queda como alias deprecado de `propose_admin`.

### Errores del contrato (el cliente los expone como `ContractError` con `.code`)

| Codigo | Nombre | Cuando |
|--------|--------|--------|
| 1 / 16 | VerifierNotSet / NoirVerifierNotSet | falta `set_verifier` / `set_noir_verifier` |
| 2 | Replay | `(player, season, nonce)` o prueba de unlock ya usados |
| 3, 4 | InvalidProof, VerifierError | el verifier rechazo / fallo (incluye senal publica >= r: `Groth16Error::NonCanonicalPublicInput`) |
| 5 | InvalidInput | argumento mal formado, score o wave = 0 en ranked |
| 6, 7, 8 | MalformedVk, VkNotSet, VkMismatch | VK mal formada / no fijada / distinta a la fijada por admin |
| 9 | SignalMismatch | score/wave/nonce/season o run_hash no coinciden con las senales publicas |
| 10 | ScoreBelowMinimum | `score < wave * 5` (antes `submit_result` devolvia `false`; ahora falla la tx) |
| 11 | NegativeScore | score casual negativo |
| 12, 13, 14 | InvalidWeapon, ThresholdMismatch, AlreadyUnlocked | `unlock_weapon` |
| 15 | Overflow | aritmetica |
| 17 | NoPendingAdmin | `accept_admin` sin `propose_admin` previo (solo admin; el cliente lo muestra como error generico) |
| 100, 101, 102 | VerifierCrash, GameHubCrash, InvalidZkProof | fallo del verifier / Game Hub / senal fuera de dominio |

`submit_zk` exige que `run_hash` sean los bytes 16..32 (hi/lo) de las senales publicas.

## 5. Configurar el frontend

En el `.env` de la raíz del proyecto:

```env
VITE_COSMIC_CODER_CONTRACT_ID=<POLICY_ID>
VITE_ZK_PROVER_URL=http://localhost:3333
VITE_ZK_BACKEND=groth16
VITE_ZK_CIRCUIT=v3
```

`VITE_ZK_BACKEND` (default `groth16`, tambien en `public/config.json`): el ranked prueba en el navegador con snarkjs
(`public/circuits/build/GameRun_final.zkey`); si falla o tarda mas de 20 s cae al prover (`POST /zk/prove`) y envia
`submit_zk`. `noir` reactiva la ruta legacy `submit_zk_noir` (verificador stub). `isRankedVerified()` es true con
groth16 y un `VITE_COSMIC_CODER_CONTRACT_ID` configurado: la verificacion real solo existe si ese deploy ejecuto `set_run_vk`.

Reinicia el frontend (`npm run dev`) para que cargue el nuevo contrato.

## Checklist

- [ ] Circuito compilado (`circuits/build/GameRun_final.zkey` existe)
- [ ] Servidor corriendo (`npm run server` → http://localhost:3333)
- [ ] `circom` 2.x y `snarkjs` instalados (para recompilar circuito si hace falta)
- [ ] Contratos WASM compilados y desplegados en testnet
- [ ] Policy desplegada con `__constructor(admin, game_hub)` y configurada: `set_verifier`, `set_run_vk` (con `circuits/build/contract_proof.json`), `set_unlock_vk` (`set_noir_verifier` solo con `VITE_ZK_BACKEND=noir` y un verificador UltraHonk real)
- [ ] `.env` con `VITE_COSMIC_CODER_CONTRACT_ID` y `VITE_ZK_PROVER_URL`
- [ ] Partida **nueva** (no "Continuar") y wallet conectada para usar ZK al morir
