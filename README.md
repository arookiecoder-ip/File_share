# Groovy YAO — Personal Secure File Transfer

Self-hosted, single-user file transfer system. Runs on a VPS behind Cloudflare Tunnel. No open inbound ports. Cyberpunk UI.

---

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 20 LTS |
| HTTP | Fastify 4 |
| WebSocket | @fastify/websocket |
| Database | SQLite (better-sqlite3) |
| Auth | WebAuthn (passkey) + TOTP + Password |
| Encryption | AES-256-GCM, HKDF key derivation |
| Frontend | Vanilla JS + custom CSS |

---

## Quick Start

### 1. Install dependencies

```bash
cd app
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # 32-byte → 64 hex chars
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"  # 16-byte → 32 hex chars
```

| Variable | Format | Purpose |
|----------|--------|---------|
| `MASTER_SECRET` | 64 hex chars | HKDF root for file encryption |
| `JWT_SECRET` | 64 hex chars | JWT signing |
| `CSRF_SECRET` | 32 hex chars | CSRF double-submit cookie |
| `IP_HMAC_KEY` | 32 hex chars | Audit log IP hashing |
| `DOMAIN` | `https://yourdomain.com` | Used in CSP + WebAuthn origin |
| `STORAGE_PATH` | absolute path | Encrypted file blobs |
| `CHUNKS_PATH` | absolute path | Temp chunk storage |
| `DB_PATH` | absolute path | SQLite database file |
| `PORT` | integer | Default `3000` |
| `MAX_FILE_SIZE_MB` | integer | Default `5120` (5 GB) |

### 3. Run

```bash
# Development
npm run dev

# Production
npm start
```

---

## Architecture

```
[Browser]
    │ HTTPS / WSS
    ▼
[Cloudflare DNS + WAF + DDoS]
    │
[Nginx reverse proxy — subdomain]
    │ proxy_pass 127.0.0.1:3002
    ▼
[Docker container — port 3002:3000]
  [Fastify — 0.0.0.0:3000]
    ├── Auth (WebAuthn + TOTP + Password + JWT)
    ├── File API (upload / download / manage)
    ├── WebSocket /ws (JWT auth on Upgrade)
    └── Middleware: rate-limit → JWT → CSP → file-type

[SQLite]           [Encrypted storage]       [Docker volumes]
  credentials        AES-256-GCM blobs         filetransfer_storage
  sessions           UUID filenames only        filetransfer_chunks
  file metadata      chunks/ (temp, auto-wiped) filetransfer_db
  transfer history
```

---

## Authentication

**Primary — Passkey (WebAuthn / FIDO2)**
- Fingerprint, FaceID, Windows Hello
- Phishing-resistant, domain-bound
- Library: `@simplewebauthn/server`

**Fallback — Password & TOTP**
- Standalone Password login or Password + TOTP combination
- Rate-limited (5 attempts / 10 min), `bcrypt` hashes (12 rounds)
- Auto-login via rotation-bound Device Tokens (30-day)
- TOTP backup codes: SHA-256 hashed, one-time use

**Sessions**
- Access token: JWT, 15-min expiry, `httpOnly` cookie
- Refresh token: 7-day, hashed in DB, rotated on use
- Flags: `httpOnly`, `Secure`, `SameSite=Strict`

---

## Encryption

```
Master key   = HKDF(SHA-256, MASTER_SECRET, salt="filetransfer-v1", info="file-encryption")
Per-file key = HKDF(master key, random_16B_salt, info=file_uuid)
Cipher       = AES-256-GCM, random 12-byte IV, 16-byte GCM tag

Stream format on disk: [12-byte IV][ciphertext][16-byte GCM tag]
```

- Original filenames encrypted (AES-256-GCM), stored in DB only
- TOTP secret encrypted with same scheme
- Plaintext never touches disk

---

## File Visibility & Share Links

Files have two visibility states — **Private** (default) and **Public**.

### Private files
- Downloadable only from the dashboard by an authenticated (logged-in) user
- No shareable URL exists — the internal `/api/files/:id/download` route requires a valid session cookie
- Cannot be accessed from any other browser or device without logging in

### Public files
- Every time a file is toggled **→ Public**, a fresh cryptographically random share token is generated (`crypto.randomBytes(24).base64url`)
- The public download URL is: `https://yourdomain.com/api/files/s/<token>/download`
- Toggling **→ Private** clears the token — the old URL immediately returns **Access Denied**
- Toggling **→ Public** again generates a **new** token — all previous public links are invalidated
- QR codes and Copy Link always use the token URL, never the internal file ID

This means sharing a file is opt-in per toggle cycle. Old links can never be reused or guessed.

---

## API Reference

### Auth
```
POST /api/auth/webauthn/register/begin
POST /api/auth/webauthn/register/complete
POST /api/auth/webauthn/authenticate/begin
POST /api/auth/webauthn/authenticate/complete
POST /api/auth/totp/setup
POST /api/auth/totp/verify
POST /api/auth/password/set
POST /api/auth/password/login
POST /api/auth/combo/login              # password + TOTP together
POST /api/auth/logout
GET  /api/auth/session
GET  /api/auth/first-run
```

### Upload
```
POST /api/upload/simple                           # < 10 MB, sync
POST /api/upload/chunked/init                     # begin chunked upload
PUT  /api/upload/chunked/:uploadId/chunk/:index   # upload one chunk (idempotent, SHA-256 verified)
POST /api/upload/chunked/:uploadId/finalize       # assemble + verify + encrypt to disk
DELETE /api/upload/chunked/:uploadId              # abort + cleanup
GET  /api/upload/chunked/:uploadId/status         # resume: get received chunk indices
```

### Files (authenticated)
```
GET    /api/files                        # list all files
GET    /api/files/:id/download           # download — requires auth session
GET    /api/files/:id/qr                 # QR code for public share URL (403 if private)
PATCH  /api/files/:id/visibility         # toggle public/private, returns new shareToken
PATCH  /api/files/:id/expiry             # extend expiry
DELETE /api/files/:id
POST   /api/files/zip                    # stream ZIP of multiple files
```

### Public download (no auth required)
```
GET /api/files/s/:token/download         # token-gated public download
                                         # ?dl=1 skips download page, streams file directly
```

### Other
```
GET    /api/history
DELETE /api/history
GET    /api/stats
GET    /api/health                       # no auth — health check
GET    /ws                               # WebSocket (JWT cookie required)
```

### WebSocket events
```
UPLOAD_PROGRESS  — { uploadId, percent, bytesLoaded, totalSize }
UPLOAD_COMPLETE  — { uploadId, fileId, filename, size, downloadUrl }
FILE_UPDATED     — { fileId }
FILE_DELETED     — { fileId }
```

---

## Project Structure

```
app/
  server.js               entry point
  src/
    config.js             env validation + config accessors
    app.js                Fastify instance + plugin registration
    routes/
      auth.js             WebAuthn, TOTP, password, session, device tokens
      files.js            upload, download, visibility, expiry, QR, ZIP
      chunks.js           chunked upload state machine
      health.js           /api/health
      ws.js               WebSocket broadcast
    middleware/
      jwt.js              JWT verification + refresh rotation hook
      fileType.js         magic-byte MIME validation
    services/
      encryption.js       AES-256-GCM streams + HKDF key derivation
      auth.js             JWT issue/verify, session CRUD, device tokens
      expiry.js           background watcher — deletes expired files
    db/
      db.js               SQLite singleton
      migrate.js          additive schema migrations (safe to re-run)
      schema.sql          base schema
  frontend/
    index.html
    css/                  main.css, animations.css, components.css
    js/
      app.js              boot, routing, session check
      auth.js             login UI (passkey, TOTP, password)
      upload.js           drag-drop, chunked upload, resume
      fileManager.js      file list/grid, visibility toggle, copy link
      qr.js               QR overlay with copy link button
      websocket.js        WS client + reconnect backoff
      progress.js         upload progress bar
      history.js          transfer history panel
      stats.js            storage stats panel
      notifications.js    toast system
      utils.js            shared helpers
      hashWorker.js       SHA-256 Web Worker (off main thread)
  package.json
  .env.example
  Dockerfile
```

---

## Chunked Upload

Files ≥ 10 MB use chunked upload with resume support.

```
1. POST /api/upload/chunked/init       → uploadId, receivedChunks[]
2. PUT  /api/upload/chunked/:id/chunk/:i  (repeat per chunk, idempotent)
3. POST /api/upload/chunked/:id/finalize  → fileId, downloadUrl
```

- Chunk size: 5 MB
- Per-chunk SHA-256 verified server-side (`x-chunk-sha256` header)
- Full-file SHA-256 verified on finalize
- Resume: init returns already-received indices; client skips them
- `window.online` event triggers auto-resume of interrupted uploads
- SHA-256 computed off-main-thread via `hashWorker.js` (Web Worker)
- 3-retry exponential backoff per chunk

---

## Database Schema

Key tables:

| Table | Purpose |
|-------|---------|
| `files` | File metadata, encryption keys, expiry, visibility, `share_token` |
| `sessions` | JWT session records, refresh tokens (hashed) |
| `webauthn_credentials` | Registered passkeys |
| `totp_config` | Encrypted TOTP secret + backup codes |
| `password_config` | bcrypt password hash |
| `device_tokens` | 30-day auto-login tokens |
| `transfer_history` | Audit log (upload, download, delete, expire events) |
| `uploads` / `upload_chunks` | In-progress chunked upload state |

Migrations run automatically at startup (`migrate.js`) — safe to re-run, additive only.

---

## VPS Deployment (Docker + Nginx)

### 1. Clone & configure

```bash
cd /opt
git clone https://github.com/YOUR_USER/YOUR_REPO.git filetransfer
cd filetransfer
cp app/.env.example app/.env
nano app/.env   # fill in all secrets + DOMAIN
```

### 2. Start Docker

```bash
docker compose up -d --build
docker compose logs -f
```

Docker volumes: `filetransfer_storage`, `filetransfer_chunks`, `filetransfer_db`, `filetransfer_logs`

### 3. Nginx config

```nginx
server {
    listen 80;
    server_name files.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        client_max_body_size 5120m;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/filetransfer /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d files.yourdomain.com
```

### 4. Update

```bash
git pull
docker compose down && docker compose up -d --build
```

No manual DB migration needed — runs automatically on startup.

---

## Security Checklist

- [x] AES-256-GCM encryption at rest, per-file random IV + salt
- [x] HKDF key derivation — raw master secret never used directly
- [x] UUID-only filenames on disk — original names encrypted in DB
- [x] Magic-byte MIME validation (`file-type` library)
- [x] Executable type blocking (exe, sh, dll, bat, ps1…)
- [x] Rate limiting: 100 req/min global, 5–10 req/min on auth routes
- [x] Strict CSP headers (production)
- [x] HSTS (production)
- [x] `httpOnly` + `Secure` + `SameSite=Strict` cookies
- [x] Private files inaccessible without authenticated session — no guessable public URL
- [x] Public share tokens: 192-bit random, invalidated on every visibility toggle
- [x] JWT access tokens: 15-min TTL, rotated refresh tokens (7-day, hashed in DB)
- [x] WebAuthn domain-bound — phishing-resistant
- [x] bcrypt password hashing (12 rounds)
- [x] TOTP secrets encrypted at rest (AES-256-GCM)
- [x] Docker non-root user + host port bound to `127.0.0.1` only
- [x] Auth failure + traffic anomaly structured logging via Pino
- [x] Internal errors return generic 500 — no stack traces to client

---

## Changelog

### Latest patches

**Share token system**
- Public files now use a random token URL: `/api/files/s/:token/download`
- Token regenerated on every `→ Public` toggle — old links immediately invalidated
- Private files have no public URL; `/api/files/:id/download` requires an auth session
- QR codes and Copy Link always use the token URL

**DB migration**
- `share_token` column added to `files` table (auto-migrated on startup)
- `db/*.db` added to `.gitignore` (was missing from coverage)

**Download page**
- Extracted `accessDeniedPage()` and `downloadPage()` as reusable helpers
- Access denied page shown for invalid/expired tokens in browser context
