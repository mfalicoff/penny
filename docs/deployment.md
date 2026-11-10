# Self-hosting and configuration

[App showcase](../README.md) · [Documentation](README.md) · [Operations runbook](operations.md)

Penny v2 runs as a .NET API with PostgreSQL 18, behind an nginx front end that serves the web app and forwards `/api/` on the same origin. This page covers installing, configuring, upgrading and rolling back that stack. Day-to-day monitoring, backups, PostgreSQL maintenance and incident runbooks are in [Operations](operations.md). The legacy Node/SQLite server remains available until the cutover; see [Legacy Node/SQLite deployment](#legacy-nodesqlite-deployment). For local development, see [Development](development.md).

Run commands from the repository root of a checkout of the release you deploy (the Compose file mounts `apps/backend/development/init-roles.sh` from it).

## Topology

| Service | Image | Role | Network |
| --- | --- | --- | --- |
| `web` | `ghcr.io/<owner>/penny-web` | Unprivileged nginx: the Expo web export, SPA fallback, and a same-origin proxy for `/api/` | The only published port (default `127.0.0.1:8080`) |
| `api` | `ghcr.io/<owner>/penny-api` | ASP.NET Core API plus the background workers (shared recurrence, push delivery, search embeddings) | Internal network only |
| `migrate` | `penny-api` | One-shot `migrate --grant-runtime`: applies EF migrations under the migration lock, then the runtime grants, and exits | Internal |
| `postgres` | `pgvector/pgvector:0.8.7-pg18-trixie` (digest pinned) | PostgreSQL 18.6 with `pg_trgm` and pgvector 0.8.7; profile `bundled-postgres` | Internal |

Persistent data lives in two named volumes: `penny-postgres` (the database) and `penny-receipts` (encrypted receipt files at `/var/lib/penny/receipts`). The receipt master key lives in `deploy/.env` and **must be backed up separately**; without it, receipts can't be decrypted.

Startup order is enforced by Compose: PostgreSQL healthy → `migrate` completed successfully → `api` healthy (`/api/ready`) → `web`. The API never migrates on its own. Its readiness check fails (503) until the schema, grants, extensions, receipt storage and import state are all correct.

Containers run as non-root users (API uid 1654, nginx uid 101), with read-only root filesystems, all capabilities dropped and `no-new-privileges`. Images are built for **linux/amd64** and **linux/arm64**; every base image is pinned to a multi-platform digest.

### Background workers

One `api` container runs every worker. Each worker claims rows with PostgreSQL leases, so running more than one API process is safe: no work is done twice, and an expired lease is taken over after a crash.

| Worker | Setting (default `true`) | Work |
| --- | --- | --- |
| Shared recurrence | `Recurrence__Worker` | Records due recurring household expenses ([shared recurrence](migration/shared-recurrence.md)) |
| Push delivery | `Push__Worker` | Drains the notification outbox to APNs/Expo ([push](migration/push.md)) |
| Search embeddings | `Search__EmbeddingWorker` | Embeds new search documents ([search](migration/search.md)) |

Supported topologies:

- **One API container** (the default): the API serves HTTP and runs all workers.
- **Several API containers** behind `web`, all with workers on, or a dedicated worker container (same image and settings, workers on, no traffic) with the HTTP containers set to `false`. Rate limits (sign-in, invites, search) are kept in memory per process, so each process allows the configured number. Keep the total pool size within PostgreSQL's `max_connections` ([pool sizing](operations.md#connections-and-pool-sizing)).

Run exactly one `migrate` at a time. A second one waits for the advisory lock or fails with "Another database migration or import holds the lock."

## Quick start

Requirements: Docker Engine with Compose v2.24+ or Podman with a Compose provider, and a TLS reverse proxy in front for anything beyond `localhost`.

```sh
sh deploy/init-env.sh https://penny.example.com     # writes deploy/.env, mode 0600; refuses to overwrite
docker compose -f deploy/compose.yaml up -d --wait
```

`init-env.sh` generates separate random passwords for the PostgreSQL administrator, the migration role and the runtime role, plus a random 32-byte receipt master key. It records the public origin users will open. To build the images from the checkout instead of pulling them, run `docker compose -f deploy/compose.yaml build` first, or set `PENNY_API_IMAGE`/`PENNY_WEB_IMAGE` to your own tags.

Then open the origin, create your account, and turn off open registration:

```sh
echo 'Auth__AllowRegistration=false' >> deploy/api.env   # create from deploy/api.env.example, mode 0600
docker compose -f deploy/compose.yaml up -d --wait
```

Check `https://penny.example.com/api/ready` returns `{"ok":true}`. Mobile users choose that HTTPS origin on the sign-in screen.

## Reverse proxy and TLS

Terminate TLS in your existing proxy and forward the whole hostname to the `web` port (`PENNY_BIND:PENNY_PORT`, default `127.0.0.1:8080`). The API is never published.

- **Origin and cookies.** `PENNY_PUBLIC_ORIGIN` must be exactly the origin in the browser's address bar (scheme, host and non-default port, no path); the API rejects mutating requests from other origins with 403 and answers CORS preflights only for it. To serve more than one origin, set `PENNY_PUBLIC_ORIGIN` to a comma-separated list (the Compose `environment` value wins over `api.env`). With an `https://` origin, `init-env.sh` sets `PENNY_SECURE_COOKIES=true`, so session cookies are `Secure; HttpOnly; SameSite=Lax`. Use `http://` only for `localhost` testing.
- **Client addresses.** nginx replaces `X-Forwarded-For` with the address of its peer, and the API trusts exactly that one hop (`Auth__TrustedProxies` = the Compose subnet, default `172.31.63.0/24`; change `PENNY_SUBNET` if it collides with a local network). When your TLS proxy runs elsewhere, set `PENNY_REAL_IP_FROM` to its address or CIDR so nginx takes the real client from that proxy's `X-Forwarded-For`; otherwise every client shares the proxy's rate-limit bucket.
- **Body size and timeouts.** nginx allows 21 MB (`PENNY_MAX_BODY`), just above the API's 20 MiB limit for encoded receipts. Allow at least that in your proxy, and a read timeout of at least the API's 30-second request timeout.
- **Request ids.** nginx sends `X-Request-Id` (its `$request_id`) to the API, which echoes it and logs it with every line ([logging](operations.md#logs)). If your proxy sets its own `X-Request-Id`, nginx replaces it; use nginx's access log or the response header to correlate.

Example Caddyfile:

```text
penny.example.com {
    reverse_proxy 127.0.0.1:8080
    request_body {
        max_size 21MB
    }
}
```

Example nginx server block (outer proxy on the same host):

```nginx
server {
    listen 443 ssl;
    server_name penny.example.com;
    client_max_body_size 21m;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 60s;
    }
}
```

With a same-host proxy, nginx in `web` sees the Compose gateway as the client. Set `PENNY_REAL_IP_FROM` to that gateway (the `.1` address of `PENNY_SUBNET`, for example `172.31.63.1/32`) so per-client rate limits use your proxy's `X-Forwarded-For`.

## Configuration

### `deploy/.env` (Compose interpolation, secrets)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PENNY_PUBLIC_ORIGIN` | (required) | Browser origin; becomes `Auth__AllowedOrigins` |
| `PENNY_SECURE_COOKIES` | `true` | `Auth__SecureCookies`; `false` only for `http://localhost` |
| `PENNY_ADMIN_PASSWORD` | generated | Bundled PostgreSQL superuser `postgres`; only the `postgres` service receives it |
| `PENNY_MIGRATION_PASSWORD` | generated | Role `penny_migrator` (schema owner); only `migrate` receives it |
| `PENNY_RUNTIME_PASSWORD` | generated | Role `penny_runtime` (DML only); only `api` receives it |
| `PENNY_RECEIPT_KEY` | generated | `Receipts__MasterKey`, base64 of 32 bytes; never rotated, never logged |
| `COMPOSE_PROFILES` | `bundled-postgres` | Empty for an [external PostgreSQL](#external-postgresql) |
| `PENNY_DB_HOST` / `PENNY_DB_PORT` / `PENNY_DB_NAME` | `postgres` / `5432` / `penny` | Database location |
| `PENNY_DB_SSL_MODE` | `Disable` | Npgsql `SSL Mode`; use `VerifyFull` for any remote server |
| `PENNY_DB_OPTIONS` | empty | Appended to both connection strings, starting with `;`, for example `;Root Certificate=/run/penny/ca.pem` |
| `PENNY_MIGRATION_USER` / `PENNY_RUNTIME_USER` | `penny_migrator` / `penny_runtime` | Role names (the grant script grants to `penny_runtime`) |
| `PENNY_API_IMAGE` / `PENNY_WEB_IMAGE` | `ghcr.io/mfalicoff/penny-*:latest` | Pin exact release tags in production |
| `PENNY_BIND` / `PENNY_PORT` | `127.0.0.1` / `8080` | Published address of `web` |
| `PENNY_SUBNET` | `172.31.63.0/24` | Compose network; also the API's trusted proxy range |
| `PENNY_REAL_IP_FROM` | `127.0.0.1/32` | Outer proxy trusted by nginx for `X-Forwarded-For` |

Passwords must not contain `;` (they are embedded in connection strings); the generator uses hex. Changing a password in `.env` does **not** change it in an existing database: alter the role first (`ALTER ROLE penny_runtime PASSWORD '…'` as administrator), then update `.env` and recreate the service.

### `deploy/api.env` (optional API settings)

Copy `deploy/api.env.example` to `deploy/api.env` (mode 0600, git-ignored). It is passed only to `api`. Everything the API reads uses ASP.NET's double-underscore names:

| Setting | Default | Notes |
| --- | --- | --- |
| `Auth__AllowRegistration` | `true` | Password sign-up |
| `Auth__RateLimitPermits` / `Auth__InviteRateLimitPermits` | 40 / 20 | Sign-in attempts per client per 15 minutes / invite joins per client per 10 minutes, per process |
| `Auth__PasswordResetHours` | 24 | Lifetime of operator-issued reset codes ([password reset](migration/authentication.md#password-reset-maz-123)) |
| `Oidc__Issuer`, `Oidc__ClientId`, `Oidc__ClientSecret`, `Oidc__RedirectUris`, `Oidc__Label`, `Oidc__AllowRegistration` | off | See [OIDC](#openid-connect-oidc-sign-in) |
| `Push__Apns__TeamId`, `Push__Apns__KeyId`, `Push__Apns__Topic`, `Push__Apns__PrivateKey` | off | All four or none ([push](migration/push.md#configuration)); `Push__Expo__Enabled` (default `true`) keeps legacy Expo delivery until retired |
| `Recurrence__Worker`, `Push__Worker`, `Search__EmbeddingWorker` | `true` | [Workers](#background-workers) |
| `Database__MaxPoolSize` | 20 | 1–100 connections per process |
| `Database__ConnectTimeoutSeconds` / `Database__CommandTimeoutSeconds` | 5 / 5 | 1–30 |
| `Backend__MaxRequestBodyBytes` | 20 MiB | Keep `PENNY_MAX_BODY` slightly above it |
| `Backend__RequestTimeoutSeconds` | 30 | Requests past it get 503 with `Retry-After` |
| `Receipts__MinFreeMegabytes` | 100 | Readiness fails (`disk-space`) below this much free space on the receipt volume |
| `Search__RateLimitPermits` | 30 | Searches per session per minute |
| `Logging__LogLevel__Default` | `Information` | `Warning` drops the per-request access line |

The image already sets `ASPNETCORE_ENVIRONMENT=Production`, `ASPNETCORE_HTTP_PORTS=8080`, `Search__ModelDirectory=/opt/penny/model` (the pinned, SHA-256-verified embedding model), `Receipts__Root=/var/lib/penny/receipts`, JSON console logs and `DOTNET_EnableDiagnostics=0`. Production serves no OpenAPI or Scalar routes and never enables the test controls.

Keep secrets out of the image, the repository and command lines. If your platform has a secret manager, inject the same variable names into the services instead of using `.env` files.

### External PostgreSQL

Requirements: PostgreSQL **18** (readiness rejects other majors), `pg_trgm` and pgvector **0.8 or later** created in the `public` schema by an administrator, and the two roles. As an administrator of the target database (replace the passwords and database name):

```sql
CREATE ROLE penny_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '…';
CREATE ROLE penny_runtime  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '…';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE penny TO penny_migrator;
GRANT CREATE ON SCHEMA public TO penny_migrator;
GRANT CONNECT ON DATABASE penny TO penny_runtime;
CREATE SCHEMA penny AUTHORIZATION penny_migrator;
GRANT USAGE ON SCHEMA penny TO penny_runtime;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;
```

This is `apps/backend/development/init-roles.sh`, which the bundled container runs on first start. On managed services where the administrator is not a superuser, use the provider's extension mechanism (for example an allow-list parameter) and confirm availability first: `SELECT name, default_version FROM pg_available_extensions WHERE name IN ('pg_trgm', 'vector');`. See [managed hosts](operations.md#managed-postgresql-hosts).

Then in `deploy/.env`: `COMPOSE_PROFILES=` (empty), `PENNY_DB_HOST`, `PENNY_DB_PORT`, `PENNY_DB_NAME`, `PENNY_DB_SSL_MODE=VerifyFull`, and the role passwords. For a private CA, mount the certificate read-only into `migrate` and `api` with a `compose.override.yaml` and point `PENNY_DB_OPTIONS=;Root Certificate=/run/penny/ca.pem` at it. `PENNY_ADMIN_PASSWORD` is unused. A connection pooler in front of PostgreSQL must run in **session** mode: `migrate` holds a session advisory lock.

## Upgrade

Every release is forward-only and migrates from any earlier v2 release. Read the release notes first: they state whether the release contains a database migration.

1. Take a backup ([backup](operations.md#back-up)) and note the current image tags.
2. Set `PENNY_API_IMAGE` and `PENNY_WEB_IMAGE` to the new **exact** version tags in `deploy/.env`, and check out the same release tag of the repository.
3. `docker compose -f deploy/compose.yaml pull && docker compose -f deploy/compose.yaml up -d --wait`. Compose recreates `migrate` (applies new migrations and grants), then `api`, then `web`. The old API keeps serving until the new one is ready only if you run more than one replica; otherwise expect a short gap.
4. Check `/api/ready`, sign in, open a ledger and a household, and download a receipt. Watch the logs for errors ([monitoring](operations.md#monitoring)).

A failed `migrate` leaves the previous schema in place (each migration runs in its own transaction) and the API is not started; fix the cause and run `up` again.

## Roll back

- **Release without a migration:** set the previous image tags and run `up -d --wait` again.
- **Release with a migration:** the previous build refuses the newer schema. Its readiness reports `schema` and its `migrate` refuses "Database schema is newer than this build". Prefer rolling forward with a fixed release. If you must go back, restore the pre-upgrade backup ([restore](operations.md#restore)) with the previous images, then reconcile the writes accepted since the backup ([write reconciliation](operations.md#write-reconciliation-after-a-rollback)).

## Container images and releases

`.github/workflows/backend-images.yml` builds `penny-api` and `penny-web` natively on amd64 and arm64 runners. It runs the production-container smoke test on each architecture (`node scripts/deploy-smoke.mjs`), then publishes multi-platform images with provenance and SBOM attestations to `ghcr.io/<owner>/penny-api` and `ghcr.io/<owner>/penny-web`. Pull requests build and test without publishing.

| Event | Tags |
| --- | --- |
| Push to `v2` | `v2`, `sha-<commit>` (version label `0.0.0-v2.<run>`) |
| Tag `v2.3.4` | `2.3.4`, `2.3`, `2`, `latest`, `sha-<commit>` |

Deploy exact version tags; `latest` and `2` move. Run the smoke test locally against your own builds before a release:

```sh
docker build -t penny-api:dev apps/backend
docker build -t penny-web:dev -f deploy/web/Dockerfile .
PENNY_SMOKE_API_IMAGE=penny-api:dev PENNY_SMOKE_WEB_IMAGE=penny-web:dev node scripts/deploy-smoke.mjs
```

It uses a throwaway Compose project and synthetic data, and removes everything afterwards (`PENNY_SMOKE_KEEP=1` keeps a failed run for inspection; `PENNY_COMPOSE` overrides the compose command). For Podman, set `DOCKER_HOST` to the Podman socket.

## OpenID Connect (OIDC) sign-in

Penny supports one configurable OIDC provider alongside email/password login on web, iOS, and Android. Configure a client supporting Authorization Code with S256 PKCE and the `openid email profile` scopes. The provider must return a verified email (`email_verified: true`) in the ID token or UserInfo response.

Set these server-side values in `deploy/api.env`:

```dotenv
Oidc__Issuer=https://identity.example.com/realms/penny
Oidc__ClientId=penny
Oidc__ClientSecret=your-server-only-secret
Oidc__RedirectUris=https://penny.example.com/auth/callback,penny://auth/callback
Oidc__Label=Single sign-on
Oidc__AllowRegistration=true
```

Use the exact issuer URL advertised by your provider. Register each exact redirect URI with the provider; wildcards are unsupported. Web sign-in uses a popup and requires HTTPS or localhost; keep the popup and original window on the same origin (the `web` container serves `/auth/callback`). The client secret is optional for public clients; confidential clients use `client_secret_post`. Never put it in an `EXPO_PUBLIC_` variable. Pending sign-in attempts are stored in PostgreSQL, so they survive restarts and work with several API containers.

New OIDC accounts are disabled by default. Set `Oidc__AllowRegistration=true` to provision an empty ledger on first sign-in, then set it back to `false`. This is independent of password sign-up. Existing users are identified by the stable `(issuer, subject)` pair; an existing account with the same email is **never automatically linked**. For mobile, a development or production build with `expo-web-browser` and the `penny` URL scheme is required (not Expo Go). Details and troubleshooting: [OIDC on the .NET backend](migration/authentication.md#openid-connect-maz-54).

## Phone notifications

On iOS and Android, Penny requests notification permission and registers the signed-in device. Other active members receive a push for a new expense, an edited expense, or a recorded reimbursement; a recurring occurrence counts as a new expense. Web does not register for push.

The .NET API delivers native iOS notifications through APNs (`Push__Apns__*`) and keeps legacy Expo tokens working through the Expo Push Service while `Push__Expo__Enabled=true`. Provider calls go out from the `api` container; allow outbound HTTPS to `api.push.apple.com` (`api.sandbox.push.apple.com` for development builds) and `exp.host` for Expo. Credentials, the `push-smoke-apns` check and delivery diagnostics: [push](migration/push.md).

## Legacy Node/SQLite deployment

Until the cutover, the legacy server keeps its own image (`ghcr.io/<owner>/<repository>`, built by `.github/workflows/docker-image.yml` from the root `Dockerfile`) and `compose.yaml`. It runs one Node process with SQLite (receipts inside the database) and serves the web app on port 3001. Keep it as the rollback target until the [cutover](migration/postgresql.md#cutover-and-forward-only-recovery) observation window ends.

```sh
docker compose up -d --build
```

Configure it in the root `.env` (`PORT`, `CORS_ORIGINS`, `COOKIE_SECURE`, `ALLOW_REGISTRATION`, `OIDC_*`). Proxy the whole hostname to port 3001, and allow request bodies of at least 20 MB. Back up the `penny-data` volume with the container stopped (SQLite database and WAL files together), or use SQLite's online backup API. To move its data to v2, follow the [cutover checklist](cutover.md): `snapshot-sqlite` seals the final SQLite file, and `import-sqlite` loads it into PostgreSQL, both through the `cutover` service of `deploy/compose.cutover.yaml`. **Retain the sealed SQLite snapshot, its SHA-256 and the original volume through the observation window.** Before writes reopen on v2, rolling back means discarding the PostgreSQL target and receipt volume and restarting Node on the untouched source. After that, recovery is forward-only.

For client-side data upgrades, see [Ledger upgrades](app-guide.md#ledger-upgrades). For signed mobile distribution and release tags, see [Releases](releases.md).
