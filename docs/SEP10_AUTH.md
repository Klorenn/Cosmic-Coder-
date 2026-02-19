# SEP-10 Stellar Web Authentication (Cosmic Coder)

This project implements **SEP-10** (Stellar Web Authentication) for server-verified wallet login, aligned with:

- [Stellar SEP-10 guide](https://developers.stellar.org/docs/platforms/anchor-platform/sep-guide/sep10)
- [SEP-0010 specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md)

## Flow (compliant with SEP-10)

1. **Client** requests a challenge: `GET /auth?account=G...` (or `GET /auth/challenge?account=G...`).
2. **Server** builds a SEP-10 challenge transaction (server account, sequence 0, timebounds, Manage Data ops for `home_domain auth` and `web_auth_domain`), signs it with the server key, returns `{ transaction, network_passphrase }`.
3. **Client** has the user sign the challenge with Freighter, then sends the signed XDR: `POST /auth` with body `{ "transaction": "<signed_xdr_base64>" }` (or `POST /auth/token`).
4. **Server** verifies the signed challenge (Stellar SDK `readChallengeTx` + `verifyChallengeTxSigners`), issues a **JWT**, and creates/updates the user row.
5. **Client** stores the JWT and sends `Authorization: Bearer <token>` on protected calls.

## stellar.toml (optional, for wallet discovery)

To advertise SEP-10 so wallets can discover your endpoint, serve a `stellar.toml` with:

```toml
SIGNING_KEY = "<public key from SEP10_SERVER_SECRET_KEY>"
WEB_AUTH_ENDPOINT = "https://cosmic-coder.onrender.com/auth"
```

`WEB_AUTH_ENDPOINT` must support:

- **GET** `<WEB_AUTH_ENDPOINT>?account=G...` → challenge (returns `{ transaction, network_passphrase }`).
- **POST** `<WEB_AUTH_ENDPOINT>` with `{ "transaction": "<signed_xdr>" }` → returns `{ "token": "<jwt>" }`.

## Backend layout

- `server/config/sep10.js` – SEP-10 and JWT config from env; normalizes `SEP10_WEB_AUTH_DOMAIN` to hostname.
- `server/auth/challenge.js` – Build challenge transaction (Manage Data ops, server-signed).
- `server/auth/token.js` – Verify signed challenge (Stellar SDK `readChallengeTx`, `verifyChallengeTxSigners`) and issue JWT.
- `server/middleware/jwtAuth.js` – JWT verification for protected routes.
- `server/routes/auth.js` – **GET /auth** and **POST /auth** (standard SEP-10), plus **GET /auth/challenge**, **POST /auth/token** (backward compatibility), **GET /auth/me**, **PATCH /auth/me/username**.
- `server/db/schema.sql` – `users` table (`public_key`, `username`, `current_jwt`, `jwt_expires_at`, timestamps).
- `server/db/pool.js` + `server/db/users.js` – PostgreSQL (or in-memory fallback when `DATABASE_URL` is unset)

## Environment (backend)

Set these on the server (e.g. Render):

| Variable | Description |
|----------|-------------|
| `SEP10_SERVER_SECRET_KEY` | Server Stellar secret key (S...) — **required** for signing challenges |
| `JWT_SECRET` | Opaque secret for signing JWTs — **required** |
| `SEP10_HOME_DOMAIN` | Home domain (e.g. `cosmiccoder.io`) |
| `SEP10_WEB_AUTH_DOMAIN` | Domain issuing the challenge (e.g. your Render URL) |
| `SEP10_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` or public network |
| `SEP10_CHALLENGE_TIMEOUT` | Challenge validity in seconds (default 300) |
| `JWT_EXPIRY_SEC` | JWT lifetime (default 86400 = 24h) |
| `DATABASE_URL` | PostgreSQL connection string (optional: in-memory store used if unset) |

### Variable aliases (compatible with Stellar Anchor docs naming)

The backend also accepts these aliases so deployment docs map cleanly:

- `SECRET_SEP10_SIGNING_SEED` → same as `SEP10_SERVER_SECRET_KEY`
- `SECRET_SEP10_JWT_SECRET` → same as `JWT_SECRET`
- `SEP10_HOME_DOMAINS` (comma-separated) → first domain is used as `SEP10_HOME_DOMAIN` fallback
- `SEP10_AUTH_TIMEOUT` → same as `SEP10_CHALLENGE_TIMEOUT`
- `SEP10_JWT_TIMEOUT` → same as `JWT_EXPIRY_SEC`
- `SEP10_ENABLED` (`true`/`false`) → can disable SEP-10 endpoints without removing config

Run the schema once: `psql $DATABASE_URL -f server/db/schema.sql`

## Frontend

- **`src/utils/authApi.js`** – `getChallenge(account)`, `postToken(signedXdr)`, `loginWithSep10(publicKey, signTransaction)`, `getMe()`, `updateMeUsername(username)`, token storage.
- **TitleScene** – On wallet connect, calls `authApi.loginWithSep10(addr, signTransaction)`; if `getMe().username` is null, shows “Choose your username” modal. Settings include “Account username” → open same modal to change username.
- **API base URL** – Set `VITE_API_URL` (e.g. in `.env`) to the backend URL; same as ZK prover in most setups.

## Security

- No localStorage-only trust: every protected request sends the JWT and the server verifies it.
- SEP-10 verification includes: server signature, timebounds, sequence 0, home domain, web_auth_domain, and client signature (master key).
- Replay is prevented by challenge nonce and timebounds; JWT has `iat`/`exp`.

## CORS

Auth endpoints send `Access-Control-Allow-Origin: *` and allow `Authorization` and `Content-Type` headers so the GitHub Pages frontend can call the backend on another origin.

## Troubleshooting: POST /auth/token 400 (Bad Request)

The backend returns 400 with a JSON body `{ error: "<message>" }`. Check that message in the Network tab or in the script’s console (the demo logs the full response).

**Common causes:**

1. **`transaction (signed challenge XDR) is required`**  
   - Body must be JSON: `{ "transaction": "<base64_signed_xdr>" }` with header `Content-Type: application/json`.  
   - If using curl: `curl -X POST ... -H "Content-Type: application/json" -d '{"transaction":"'$SIGNED_XDR'"}'`.

2. **`Invalid challenge: ...`**  
   - Challenge XDR is malformed, or it was built with different `SEP10_HOME_DOMAIN` / `SEP10_WEB_AUTH_DOMAIN` / network than the server’s current config.  
   - Ensure the **same** backend that served `GET /auth/challenge` is the one receiving `POST /auth/token` (same Render service, same env).

3. **`Signature verification failed: ...`**  
   - The transaction was not signed by the client key, or was modified.  
   - Ensure you’re sending the **signed** XDR returned by Freighter (not the original challenge XDR).  
   - Use the same Stellar account (public key) for both challenge and sign.

4. **SEP10_WEB_AUTH_DOMAIN mismatch**  
   - On Render, set `SEP10_WEB_AUTH_DOMAIN=https://cosmic-coder.onrender.com` (your service’s public URL, no trailing slash).  
   - The challenge is built with this value; verification will fail if it doesn’t match the domain that serves the auth endpoints.
