# Qué hacer para dejar todo listo (Hackathon)

Sigue estos pasos en orden. Necesitas: una cuenta Stellar en testnet con XLM, y acceso al repo en GitHub.

**Requisito para jugar:** Los jugadores **tienen que vincular sí o sí** su cuenta de [Freighter](https://www.freighterapp.com/) en la pantalla de título para poder jugar (extensión en el navegador).

**Contratos ya desplegados en Testnet (referencia):** Policy `CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO`, Verifier `CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA`. Si usas este despliegue, el paso 1 solo es configurar el frontend con ese POLICY_ID; si quieres desplegar los tuyos, sigue 1.2.

---

## 1. Desplegar contratos en Stellar Testnet (o usar los ya desplegados)

### 1.1 Cuenta testnet

Si no tienes cuenta en testnet:

- Crea una en [Stellar Laboratory (testnet)](https://laboratory.stellar.org/#account-creator?network=test) o con Freighter.
- Consigue XLM de testnet desde el [Friendbot](https://laboratory.stellar.org/#explorer?resource=friendbot&endpoint=create) (introduce tu dirección pública).

### 1.2 Desplegar e inicializar

Desde la raíz del repo, con WASM ya compilado:

```bash
# Usa tu clave pública Stellar (G...) o un identity configurado con stellar keys add
export SOURCE_ACCOUNT=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
./scripts/deploy_contracts_testnet.sh
```

El script desplegará verifier y policy, hará `init` con el Game Hub y `set_verifier`, y al final imprimirá algo como:

- `VITE_SHADOW_ASCENSION_CONTRACT_ID=...` (POLICY_ID)

**Si no quieres usar el script**, en [DEPLOY_ZK_STEPS.md](DEPLOY_ZK_STEPS.md) tienes los comandos uno a uno. En todos debes añadir `--source-account <TU_CUENTA>`.

### 1.3 Configurar local

En el `.env` de la raíz del proyecto (usa el POLICY_ID del script o el ya desplegado):

```env
VITE_SHADOW_ASCENSION_CONTRACT_ID=CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO
VITE_ZK_PROVER_URL=http://localhost:3333
```

Si desplegaste tus propios contratos, sustituye por tu POLICY_ID.

Para probar en local con ZK, deja el prover en `http://localhost:3333` y arranca el servidor con `npm run server`.

---

## 2. Desplegar el prover (producción)

Para que el juego en GitHub Pages use ZK, el frontend tiene que llamar a un prover público.

### Opción A: Render (recomendado)

1. Entra en [render.com](https://render.com) e inicia sesión (p. ej. con GitHub).
2. **New → Blueprint**. Conecta el repo de vibe-coder.
3. Render detectará `render.yaml` y creará el servicio `cosmic-coder-zk-prover`.
4. **Deploy**. Cuando termine, copia la URL del servicio (ej. `https://cosmic-coder-zk-prover.onrender.com`).

### Opción B: Sin Blueprint en Render

1. **New → Web Service**. Conecta el repo.
2. **Environment**: Docker.
3. **Dockerfile path**: `Dockerfile.prover`.
4. **Deploy** y copia la URL.

### Opción C: Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub.
2. En el servicio: Settings → Build → Dockerfile path: `Dockerfile.prover`.
3. Deploy y copia la URL pública.

Guarda esa URL como **prover URL** (la usarás en el paso 3).

---

## 3. Añadir secrets en GitHub (build de GitHub Pages)

Para que el build de GitHub Pages incluya contrato y prover:

1. Abre el repo en GitHub → **Settings → Secrets and variables → Actions**.
2. **New repository secret**:
   - **Name:** `VITE_SHADOW_ASCENSION_CONTRACT_ID`  
     **Value:** el POLICY_ID (si usas el despliegue actual: `CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO`; si desplegaste los tuyos, el que imprimió el script).
3. **New repository secret**:
   - **Name:** `VITE_ZK_PROVER_URL`  
     **Value:** la URL del prover del paso 2 (ej. `https://cosmic-coder-zk-prover.onrender.com`).

No hace falta poner `http://` ni `https://` en el nombre del secret; el valor es la URL completa del prover.

Tras el siguiente push a `main`, el workflow de deploy usará estos secrets y el juego en GitHub Pages quedará configurado con contrato y ZK.

---

## 4. Comprobar que todo funciona

1. **Local:** `npm run server` y `npm run dev`. **Conecta Freighter** (obligatorio para jugar), partida nueva, juega hasta morir. Deberías ver "Submitted to ZK leaderboard" o "Submitted to casual leaderboard".
2. **Online:** Abre la URL de GitHub Pages. **Vincula Freighter** (obligatorio), partida nueva, juega hasta morir. Debería pasar lo mismo si los secrets están bien y el prover está en marcha.
3. **Stellar Expert:** En el [Game Hub (testnet)](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG) puedes revisar invocaciones a `start_game` y `end_game` tras empezar partida y al morir.

---

## Resumen

| Paso | Dónde | Qué |
|------|--------|-----|
| 1 | Terminal (con SOURCE_ACCOUNT) | `./scripts/deploy_contracts_testnet.sh` |
| 2 | Render o Railway | Deploy con `Dockerfile.prover`, copiar URL del prover |
| 3 | GitHub → Settings → Secrets | Añadir `VITE_SHADOW_ASCENSION_CONTRACT_ID` y `VITE_ZK_PROVER_URL` |
| 4 | Navegador + Stellar Expert | Jugar y comprobar envíos on-chain |
