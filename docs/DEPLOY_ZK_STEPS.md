# Pasos para desplegar ZK (Stellar Testnet)

Ejecuta estos comandos **desde la raíz del repo** una vez tengas Stellar CLI configurado y una cuenta con XLM en testnet.

## Contratos desplegados (referencia)

Si ya están desplegados en testnet, puedes usar estos IDs en el frontend (`.env` y GitHub Secrets):

| Contrato | ID (Testnet) | Stellar Expert |
|----------|--------------|----------------|
| **Policy (cosmic_coder)** | `CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO` | [Ver policy](https://stellar.expert/explorer/testnet/contract/CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO) |
| **Verifier (zk_verifier)** | `CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA` | [Ver verifier](https://stellar.expert/explorer/testnet/contract/CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA) |
| **Game Hub** | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` | [Ver Game Hub](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG) |

Para jugar con este despliegue: `VITE_COSMIC_CODER_CONTRACT_ID=CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO`.

---

## 1. Compilar WASM de los contratos

Usa **rustup** (no Homebrew). Para Soroban testnet hace falta el target **wasm32v1-none** (con `wasm32-unknown-unknown` puede fallar "reference-types not enabled"):

```bash
export PATH="$HOME/.cargo/bin:$PATH"
rustup target add wasm32v1-none
cd contracts
cargo build -p zk_types
cargo build -p zk_verifier --target wasm32v1-none --release
cargo build -p cosmic_coder --target wasm32v1-none --release
cd ..
```

## 2. Desplegar verifier

Necesitas una cuenta en testnet con XLM (p. ej. desde [Friendbot](https://laboratory.stellar.org/#explorer?resource=friendbot&endpoint=create)). Sustituye `<SOURCE>` por tu clave pública (G...) o por un identity de `stellar keys list`.

```bash
cd contracts
stellar contract deploy --source-account <SOURCE> --network testnet --wasm target/wasm32v1-none/release/zk_verifier.wasm
```

**Guarda el ID que devuelve** como `VERIFIER_ID`.

## 3. Desplegar política (cosmic_coder)

```bash
stellar contract deploy --source-account <SOURCE> --network testnet --wasm target/wasm32v1-none/release/cosmic_coder.wasm
```

**Guarda el ID** como `POLICY_ID`.

## 4. Inicializar política con Game Hub y verifier

El contrato `cosmic_coder` tiene `init(env, game_hub: Address)` y `set_verifier(env, verifier: Address)`.

**Game Hub (verificado):** La policy llama `start_game(game_id, session, player, system_player, x, y)` y `end_game(session, success)`. Esto coincide con el mock en `contracts/cosmic_coder/src/tests.rs` y con el Game Hub de Stellar Game Studio.

Game Hub en Testnet: `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`

```bash
# Init: pasar la dirección del Game Hub como --game_hub
stellar contract invoke --id <POLICY_ID> --source-account <SOURCE> --network testnet -- \
  init --game_hub CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG

# Registrar el verifier (necesario para submit_zk)
stellar contract invoke --id <POLICY_ID> --source-account <SOURCE> --network testnet -- \
  set_verifier --verifier <VERIFIER_ID>
```

## 5. Configurar el frontend

En el `.env` de la raíz del proyecto:

```env
VITE_COSMIC_CODER_CONTRACT_ID=<POLICY_ID>
VITE_ZK_PROVER_URL=http://localhost:3333
```

Reinicia el frontend (`npm run dev`) para que cargue el nuevo contrato.

## Checklist

- [ ] Circuito compilado (`circuits/build/GameRun_final.zkey` existe)
- [ ] Servidor corriendo (`npm run server` → http://localhost:3333)
- [ ] `circom` 2.x y `snarkjs` instalados (para recompilar circuito si hace falta)
- [ ] Contratos WASM compilados y desplegados en testnet
- [ ] Policy inicializada con Game Hub y `set_verifier(VERIFIER_ID)`
- [ ] `.env` con `VITE_COSMIC_CODER_CONTRACT_ID` y `VITE_ZK_PROVER_URL`
- [ ] Partida **nueva** (no "Continuar") y wallet conectada para usar ZK al morir
