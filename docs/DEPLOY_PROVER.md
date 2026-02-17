# Desplegar el servidor ZK Prover (producción)

Para que el juego online (GitHub Pages) pueda enviar partidas en modo **ranked (ZK)**, el frontend debe llamar a `POST /zk/prove` desde el navegador. Eso requiere un servidor accesible públicamente.

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

## Variable de entorno en el frontend

Una vez tengas la URL del prover (ej. `https://zk-prover-xxx.railway.app`):

- **Local:** en `.env`: `VITE_ZK_PROVER_URL=https://zk-prover-xxx.railway.app`
- **GitHub Pages:** añade el secret `VITE_ZK_PROVER_URL` en el repo y pásalo al build (ver plan: configurar deploy.yml).

## CORS

El `server/index.js` ya envía `Access-Control-Allow-Origin: *` para peticiones al API. Si el frontend está en otro dominio (p. ej. GitHub Pages), las peticiones a `/zk/prove` deberían funcionar.
