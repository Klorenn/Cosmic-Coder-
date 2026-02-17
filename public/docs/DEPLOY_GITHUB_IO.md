# Deploy completo en GitHub Pages (game + contratos ZK)

Para tener el juego funcionando en `https://<user>.github.io/vibe-coder/` con contratos ZK:

---

## Resumen

| Componente | Dónde | Estado |
|------------|-------|--------|
| Frontend | GitHub Pages (deploy en push a main) | ✅ Ya configurado |
| Contratos | Stellar Testnet (Policy + Verifier) | ✅ Ya desplegados |
| ZK Prover | Render / Railway (genera proofs) | Pendiente deploy |
| Secrets | GitHub → Settings → Secrets | Pendiente configurar |

---

## 1. GitHub Pages (frontend)

El workflow `.github/workflows/deploy.yml` ya despliega en cada push a `main`.

**URL final:** `https://<usuario>.github.io/vibe-coder/` (o `https://<org>.github.io/vibe-coder/`)

**Comprobar:** GitHub → Settings → Pages → Source: GitHub Actions debe estar activo.

---

## 2. Contratos en Stellar Testnet (ya desplegados)

Contratos actuales en Testnet:

| Contrato | ID |
|----------|-----|
| Policy (shadow_ascension) | `CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO` |
| Verifier (groth16) | `CCQQDZBSOREFGWRX7BJKG4S42CPYASWVOUFLTFNKV5IQ3STOJ7ROSOBA` |
| Game Hub | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` |

Si quieres desplegar los tuyos: [DEPLOY_ZK_STEPS.md](DEPLOY_ZK_STEPS.md) o [HACKATHON_DO_THIS.md](HACKATHON_DO_THIS.md).

---

## 3. ZK Prover (Render)

El prover genera la proof cuando mueres. Debe estar en un servidor público.

### 3.1 Generar y commitear circuits/build

El Dockerfile del prover usa `circuits/build/`. Haz build local y commitea:

```bash
# Desde repo root
npm run zk:build
git add circuits/build/
git commit -m "Add circuits/build for prover"
git push
```

### 3.2 Deploy en Render

1. [render.com](https://render.com) → Iniciar sesión (ej. con GitHub)
2. **New → Blueprint** → Conecta el repo `vibe-coder`
3. Render detecta `render.yaml` y crea `cosmic-coder-zk-prover`
4. **Deploy**
5. Cuando termine, copia la URL (ej. `https://cosmic-coder-zk-prover.onrender.com`)

**Alternativa sin Blueprint:** New → Web Service → Repo → Environment: Docker → Dockerfile path: `Dockerfile.prover`

---

## 4. GitHub Secrets

Para que el build de GitHub Pages incluya contrato y prover:

1. GitHub → Repo → **Settings → Secrets and variables → Actions**
2. **New repository secret:**
   - **Name:** `VITE_SHADOW_ASCENSION_CONTRACT_ID`
   - **Value:** `CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO`
3. **New repository secret:**
   - **Name:** `VITE_ZK_PROVER_URL`
   - **Value:** `https://cosmic-coder-zk-prover.onrender.com` (tu URL del paso 3)

---

## 5. Push y verificación

```bash
git push origin main
```

El workflow se ejecutará y desplegará. En 1–2 minutos la app estará en:

`https://<usuario>.github.io/vibe-coder/`

**Comprobar:**

1. Abre la URL
2. Conecta Freighter (obligatorio)
3. Start Game (ZK Ranked)
4. Juega hasta morir
5. Deberías ver "✓ ZK RANKED — Submitted to on-chain leaderboard"
6. En [Stellar Expert (Policy)](https://stellar.expert/explorer/testnet/contract/CC73YP4HYHXG42QQDYQGLG3HAQ3VQC2GF4E5Z7ILUOGZNR4M7EUIZBUO) verás `submit_zk` tras morir

---

## Fallback

Si el prover falla o está caído, el juego hace fallback a `submit_result` (casual leaderboard). Los jugadores pueden seguir jugando y enviando scores, pero sin ZK ranked.

---

## Checklist

- [ ] `npm run zk:build` y `git add circuits/build/` + commit
- [ ] Deploy prover en Render, copiar URL
- [ ] Añadir secrets `VITE_SHADOW_ASCENSION_CONTRACT_ID` y `VITE_ZK_PROVER_URL`
- [ ] `git push origin main`
- [ ] Verificar en la URL de GitHub Pages
