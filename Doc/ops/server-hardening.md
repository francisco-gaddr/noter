# Server & Infrastructure Hardening

**Updated:** 2026-06-13. Based on current (2025–2026) primary-source guidance
(Docker docs, OWASP, Express/Helmet, Electron security docs).

## Applied this pass

### Docker (`docker-compose.yml`)
- **MongoDB & Redis are no longer published to the host.** They were on
  `27017:27017` / `6379:6379` — exposing the (un-authenticated) database to the
  host and potentially the VPS. They now use `expose:` and are reachable **only**
  on the internal Docker network by the backend (`mongodb://mongodb:27017`). This
  is the single highest-impact fix here.
- **Pinned images** `mongo:7.0`, `redis:7.2-alpine` (was `:latest` / `:alpine`).
- **`security_opt: no-new-privileges:true`** on every service.
- **`cap_drop: ALL`** on backend, web, redis; nginx drops all and adds back only
  `NET_BIND_SERVICE`/`CHOWN`/`SETGID`/`SETUID` (needed to bind :80 and drop to its
  worker user).

### nginx (`apps/nginx/nginx.conf`)
- `server_tokens off` (don't leak the version).
- Added baseline security headers alongside the existing CSP:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy: same-origin`.
- **HSTS is deliberately not set here** — TLS terminates at the VPS edge, which is
  where `Strict-Transport-Security` belongs; setting it on this HTTP listener
  could brick plain-HTTP access.

### Host (`infra/pi/harden.sh` — opt-in, run deliberately)
`sudo bash infra/pi/harden.sh`. Idempotent. Covers:
- **SSH**: key-only (`PasswordAuthentication no`), `PermitRootLogin no`,
  `MaxAuthTries 3`, no agent/X11 forwarding. **Guarded**: it refuses to disable
  password auth if no `authorized_keys` exists for the invoking user, so you can't
  lock yourself out. Always open a *new* SSH session to confirm before closing.
- **UFW**: default-deny inbound; allow only 22/80/443. Mongo/Redis stay closed.
- **fail2ban**: sshd jail (4 retries → 1 h ban).
- **unattended-upgrades**: automatic security patches.

## Recommended next (needs deliberate, tested rollout)
- **MongoDB authentication.** Now that Mongo is internal-only the exposure is
  contained, but enabling auth is defence-in-depth. ⚠️ `MONGO_INITDB_ROOT_*` only
  applies to a **fresh** data volume — on the existing volume you must create the
  user manually, then switch `MONGO_URI` to
  `mongodb://user:pass@mongodb:27017/noter?authSource=admin`. Do this in a
  maintenance window with a backup.
- **TLS edge / HSTS** at the VPS nginx proxy (`infra/tailscale/vps-nginx-proxy.sh`).
- **Read-only container filesystems** + `tmpfs` for `/tmp` once write paths are
  audited (backend writes `logs/`; Next.js writes its cache).

## Crypto library note (from research)
Our v3 E2E uses **@noble/ciphers (AES-256-GCM) + @noble/hashes (Argon2id)** — pure
JS, zero native deps, works in RN/web/Node. Per current comparisons, **libsodium**
(XChaCha20-Poly1305, used by Signal/WhatsApp) has stronger audit coverage; Noble's
Argon2 is not yet third-party audited. AES-256-GCM is fully sufficient today; a
future option is XChaCha20-Poly1305 via libsodium-wrappers (web/Node) — but it is
not cross-platform on RN without native modules, so Noble remains the pragmatic
single-codebase choice. Tracked in `Doc/adr/0001-e2e-encryption.md`.
