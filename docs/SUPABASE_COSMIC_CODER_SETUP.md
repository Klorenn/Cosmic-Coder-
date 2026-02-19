# Cosmic Coder — tabla en tu Supabase

Proyecto: **https://qrdmytxxcwouipwxfnvf.supabase.co**

## 1. Crear la tabla en tu proyecto

En el **Dashboard de Supabase** → tu proyecto → **SQL Editor** → New query. Pega y ejecuta:

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

## 2. Variables para el backend

En Render (o tu `.env` local) usa:

- `SUPABASE_URL=https://qrdmytxxcwouipwxfnvf.supabase.co`
- `SUPABASE_ANON_KEY=` la **anon key** de tu proyecto (Project Settings → API → anon public). Usa el **JWT largo** (empieza por `eyJ...`) si el formato `sb_publishable_...` no funciona con el cliente.

Si el backend va a hacer solo operaciones de backend (sin usuario de Supabase Auth), con la **anon key** y la política de arriba basta. Para más seguridad puedes usar la **service_role** key (solo en el servidor, nunca en el frontend) y quitar la política pública.
