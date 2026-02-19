# SEP-10 Stellar Web Authentication (Cosmic Coder)

This project implements **SEP-10** (Stellar Web Authentication) for server-verified wallet login. The flow follows the [official SEP-10 specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md) exactly: no simulated auth, no custom crypto.

## Flow (compliant with SEP-10)

1. **Frontend** requests a challenge: `GET /auth/challenge?account=G...`
2. **Backend** builds a SEP-10 challenge transaction (server account, sequence 0, timebounds, Manage Data ops for `home_domain auth` and `web_auth_domain`), signs it with the server key, returns `{ transaction, network_passphrase }`.
3. **Frontend** has the user sign the challenge with Freighter (`signTransaction(xdr, networkPassphrase)`), then sends the signed XDR: `POST /auth/token` with `{ transaction: signedXdr }`.
4. **Backend** verifies the signed challenge (via `@stellar/stellar-sdk` WebAuth: `readChallengeTx` + `verifyChallengeTxSigners`), then issues a **JWT** (24h expiry) and creates/updates the user row (`public_key`, optional `username`).
5. **Frontend** stores the JWT (memory + localStorage for reloads) and sends `Authorization: Bearer <token>` on protected calls. Auth is **always server-verified** on each request.

## Backend layout

- `server/config/sep10.js` – SEP-10 and JWT config from env
- `server/auth/challenge.js` – Build challenge (Stellar SDK `WebAuth.buildChallengeTx`)
- `server/auth/token.js` – Verify signed challenge (Stellar SDK `readChallengeTx`, `verifyChallengeTxSigners`) and issue JWT
- `server/middleware/jwtAuth.js` – JWT verification for protected routes
- `server/routes/auth.js` – `GET /auth/challenge`, `POST /auth/token`, `GET /auth/me`, `PATCH /auth/me/username`
- `server/db/schema.sql` – `users` table (id, public_key, username, created_at, updated_at)
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
