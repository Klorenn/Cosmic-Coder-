# Desplegar el servidor ZK Prover (producción)

Para que el juego online (GitHub Pages) pueda enviar partidas en modo **ranked (ZK)**, el frontend debe llamar a `POST /zk/prove` desde el navegador. Eso requiere un servidor accesible públicamente.

## Desplegar el prover en Render (recomendado)

1. Entra en [render.com](https://render.com) e inicia sesión con GitHub.
2. **New** → **Blueprint** → conecta el repo **Klorenn/Cosmic-Coder-** (o el que tengas).
3. Render leerá `render.yaml`: se creará el servicio **cosmic-coder-zk-prover** con `Dockerfile.prover`. No cambies el nombre si quieres usar la URL que ya está en `config.json`.
4. **Apply** y espera al primer deploy. La URL será `https://cosmic-coder-zk-prover.onrender.com`.
5. En la app [https://klorenn.github.io/Cosmic-Coder-/](https://klorenn.github.io/Cosmic-Coder-/) ya está configurada esa URL en `public/config.json`; al cargar la página se usará para la prueba ZK al morir.

**Nota:** En el plan gratuito de Render el servicio puede dormir tras inactividad; la primera petición ZK puede tardar unos segundos en responder.

## Si ves "Could not submit to chain" o "ZK prover unavailable"

- **Prover no alcanzable:** La URL en `public/config.json` (`VITE_ZK_PROVER_URL`) debe apuntar a un servidor desplegado (Render, Railway, etc.). Si el prover no está desplegado o la URL es incorrecta, la prueba ZK no se hará y se enviará como CASUAL (o fallará si además falla el contrato).
- **Para que la prueba ZK se realice:** Despliega el prover siguiendo esta guía, copia la URL pública y actualiza `public/config.json` con esa URL. Haz commit y push para que el deploy use la nueva config.

## Opción 1: Docker (Railway, Fly.io, etc.)

El repositorio incluye `Dockerfile.prover`. Requisito: la carpeta `circuits/build/` debe existir (con `GameRun_final.zkey`, `GameRun_js/`). Ya está en el repo.

### Railway

1. Conecta el repo en [railway.app](https://railway.app).
2. New Project → Deploy from GitHub → selecciona el repo.
3. Settings → Root Directory: deja vacío. Build: **Dockerfile** → Dockerfile path: `Dockerfile.prover`.
4. Variables: no obligatorias. Puerto 3333 (Railway asigna PORT; el server usa `process.env.PORT || 3333`).
5. Deploy. Usa la URL pública como `VITE_ZK_PROVER_URL` (ej. `https://xxx.up.railway.app`).

**Importante:** El server actual escucha en el puerto 3333. Railway inyecta `PORT`; hay que hacer que `server/index.js` use `process.env.PORT || 3333`.

### Render

1. [render.com](https://render.com) → New → Web Service.
2. Conecta el repo. Environment: **Docker**; Dockerfile path: `Dockerfile.prover`.
3. Deploy. Usa la URL asignada como `VITE_ZK_PROVER_URL`.

### Fly.io

```bash
fly launch --dockerfile Dockerfile.prover --name cosmic-coder-zk-prover
fly deploy
```

Luego `fly info` para la URL.

## Opción 2: Sin Docker (Railway / Render con Node)

Si usas "Native" en Railway/Render:

- Build command: `npm ci`
- Start command: `node server/index.js`
- Asegúrate de que `circuits/build/` esté en el repo (ya incluido).
- En el host debe estar disponible `snarkjs` (añadir en package.json como dependencia o `npm install -g snarkjs` en el build).

## URLs de este proyecto

- **App (juego):** [https://klorenn.github.io/Cosmic-Coder-/](https://klorenn.github.io/Cosmic-Coder-/)
- **Prover (Render):** Tras desplegar el Blueprint, la URL será algo como `https://cosmic-coder-zk-prover.onrender.com`. Esa URL ya está en `public/config.json` como `VITE_ZK_PROVER_URL`.

## Configurar la URL del prover en el frontend

- **App desplegada:** `public/config.json` ya tiene `VITE_ZK_PROVER_URL` apuntando al servicio de Render. Si usas otro nombre de servicio, actualiza esa URL en `config.json` y haz commit.
- **Local:** Puedes usar `.env` con `VITE_ZK_PROVER_URL=...` o `public/config.json`.

## CORS

El `server/index.js` ya envía `Access-Control-Allow-Origin: *` para peticiones al API. Si el frontend está en otro dominio (p. ej. GitHub Pages), las peticiones a `/zk/prove` deberían funcionar.
