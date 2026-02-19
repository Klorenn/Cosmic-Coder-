# Despliegue SEP-10 en Render (Cosmic Coder)

## ✅ PASO 1 — Estructura del backend

La carpeta `server/` debe tener:

```
server/
  config/     → sep10.js
  auth/       → challenge.js, token.js
  middleware/ → jwtAuth.js
  routes/     → auth.js
  db/         → schema.sql, pool.js, users.js
  index.js
```

Si falta algo, usa el código que generó Cursor para SEP-10.

---

## 🗄 PASO 2 — Base de datos (CRÍTICO)

### En Render

1. **New → PostgreSQL** (si aún no tienes).
2. Copia el **External Database URL** (o Internal si el backend está en Render).
3. En tu **servicio backend** (Web Service) añade la variable de entorno:
   - `DATABASE_URL` = esa URL (Internal para mismo Render, External para local/otros).

### Ejecutar el schema (obligatorio)

Si no ejecutas el schema, la tabla `users` no existe y nada se guarda.

Desde tu máquina (con `psql` instalado):

```bash
# Sustituye por tu External Database URL de Render (o usa la variable si la tienes)
psql "postgresql://cosmic_coder_user:TU_PASSWORD@dpg-XXXXX.oregon-postgres.render.com/cosmic_coder" -f server/db/schema.sql
```

O si ya tienes `DATABASE_URL` en tu entorno:

```bash
psql "$DATABASE_URL" -f server/db/schema.sql
```

**Alternativa sin `psql`** (desde el repo, con Node):

```bash
DATABASE_URL="postgresql://usuario:password@host:5432/cosmic_coder" node scripts/run_db_schema.js
```

Usa tu **External Database URL** de Render (solo para ejecutar este script una vez; no subas la URL con contraseña al repo). En Render (Dashboard → PostgreSQL → Info) tienes el **PSQL Command**; también puedes pegar el contenido de `server/db/schema.sql` en la consola SQL de Render.

---

## 🔐 PASO 3 — Variables de entorno (backend en Render)

En el **Web Service** del backend, en **Environment** añade:

| Variable | Valor | Notas |
|----------|--------|--------|
| `DATABASE_URL` | *(Internal Database URL de tu PostgreSQL en Render)* | Ej: `postgresql://...@dpg-XXX-a/cosmic_coder` |
| `SEP10_SERVER_SECRET_KEY` | `S...` | Cuenta Stellar **nueva** solo para el servidor. No la del contrato ni tu wallet personal. |
| `JWT_SECRET` | Cadena larga y aleatoria | Ej: `openssl rand -hex 32` |
| `SEP10_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Testnet. Para mainnet usa el de Public Network. |
| `SEP10_HOME_DOMAIN` | `cosmiccoder.app` | Tu dominio. |
| `SEP10_WEB_AUTH_DOMAIN` | URL pública del backend | Ej: `https://cosmic-coder-api.onrender.com` (debe ser la URL desde la que sirves `/auth/challenge`). |

Importante: `SEP10_SERVER_SECRET_KEY` debe ser una cuenta Stellar real generada para el servidor (crear par de llaves nuevo y usar la secret `S...`).

---

## 🧪 PASO 4 — Probar antes del frontend

### 1. Challenge

```http
GET https://tu-backend.onrender.com/auth/challenge?account=GXXXXXXXX...
```

Respuesta esperada:

```json
{
  "transaction": "...XDR base64...",
  "network_passphrase": "Test SDF Network ; September 2015"
}
```

Si no ves eso, revisa `server/config/sep10.js` y que `SEP10_SERVER_SECRET_KEY` esté definida.

### 2. Token

1. Firma en Freighter la `transaction` que te devolvió el challenge (usando el `network_passphrase` indicado).
2. Envía la XDR firmada:

```http
POST https://tu-backend.onrender.com/auth/token
Content-Type: application/json

{"transaction": "LA_XDR_FIRMADA_EN_BASE64"}
```

Respuesta esperada:

```json
{
  "token": "eyJ...",
  "public_key": "G..."
}
```

Si recibes eso, SEP-10 está funcionando en el backend.

---

## 🎮 PASO 5 — Frontend

1. En el proyecto (o en el build de Render/GitHub Pages) configura:
   - `VITE_API_URL=https://tu-backend.onrender.com`  
   (sin barra final; sin `/auth`).

2. El login debe usar la wallet para firmar, no el SDK manual:
   - En el código ya está: `stellarWallet.signTransaction(xdr, networkPassphrase)`.
   - El `network_passphrase` viene en la respuesta del challenge y se pasa a Freighter.

Con eso, el flujo Connect wallet → Challenge → Sign in Freighter → Token → JWT y usuario en DB debería funcionar de punta a punta.
