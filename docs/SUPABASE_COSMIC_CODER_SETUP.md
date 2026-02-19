# Cosmic Coder — Supabase (usuarios SEP-10)

Proyecto actual: **https://pdfflyvkkgtvsujiafkf.supabase.co**

---

## 1. Crear la tabla en Supabase

1. Entra a [Supabase Dashboard](https://supabase.com/dashboard) → tu proyecto **pdfflyvkkgtvsujiafkf**.
2. Menú **SQL Editor** → **New query**.
3. Pega y ejecuta este SQL:

```sql
-- Cosmic Coder SEP-10: usuarios por public_key + username
CREATE TABLE IF NOT EXISTS public.cosmic_coder_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key VARCHAR(56) NOT NULL UNIQUE,
  username   VARCHAR(64) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cosmic_coder_users_public_key_idx
  ON public.cosmic_coder_users (public_key);

ALTER TABLE public.cosmic_coder_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for backend"
  ON public.cosmic_coder_users
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

4. Pulsa **Run**. Con eso el backend ya puede guardar y leer usuarios (wallets + username).

---

## 2. Variables de entorno (backend)

El servidor usa **SUPABASE_URL** y **SUPABASE_ANON_KEY** (o **SUPABASE_SERVICE_ROLE_KEY**).  
**No subas las keys al repo.** Configúralas en:

- **Local**: archivo `.env` en la raíz del proyecto (y que esté en `.gitignore`).
- **Render**: Dashboard del servicio → **Environment** → Add Variable.

| Variable | Valor | Notas |
|--------|--------|--------|
| `SUPABASE_URL` | `https://pdfflyvkkgtvsujiafkf.supabase.co` | Project URL de tu proyecto. |
| `SUPABASE_ANON_KEY` | *(tu Anon Key)* | En Supabase: **Project Settings → API**. Puedes usar la **Anon key (legacy)** que empieza por `eyJ...` o la **Publishable key** `sb_publishable_...`. Si algo falla, prueba con la legacy. |

Opcional (más seguro en producción): usa **Service Role Key** (solo en el servidor, nunca en el frontend) y ponla en `SUPABASE_SERVICE_ROLE_KEY`; el código la usa en preferencia a la anon.

---

## 3. Comprobar que funciona

1. Arranca el backend con las variables definidas: `node server/index.js` (o tu comando).
2. Haz login SEP-10 desde el juego (Freighter → challenge → token).
3. En Supabase: **Table Editor** → tabla `cosmic_coder_users`. Deberías ver una fila con tu `public_key` y, si guardaste nombre, el `username`.

---

## 4. (Opcional) Conexión directa PostgreSQL

Si en algún momento quieres usar **DATABASE_URL** en lugar del cliente Supabase (por ejemplo para migraciones o scripts), la connection string sería:

- Host: `db.pdfflyvkkgtvsujiafkf.supabase.co`
- Puerto: `5432`
- Base de datos: **`postgres`** (no `postgresm`; el nombre por defecto en Supabase es `postgres`).
- Usuario: `postgres`
- Contraseña: la que te dio Supabase al crear el proyecto.

**Importante:** no pongas la contraseña en el código ni la subas a Git. Solo en variables de entorno (p. ej. en Render como **Secret**). Para Cosmic Coder, con **SUPABASE_URL + SUPABASE_ANON_KEY** basta; no hace falta `DATABASE_URL` si ya usas el cliente Supabase.
