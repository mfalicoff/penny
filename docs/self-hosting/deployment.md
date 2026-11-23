# Self-hosting and configuration

[App showcase](../../README.md) · [Documentation](../README.md) · [Operations runbook](operations.md)

Penny v2 runs as a .NET API with PostgreSQL 18, behind an nginx front end that serves the web app and forwards `/api/` on the same origin. This page covers installing, configuring, upgrading and rolling back that stack. Day-to-day monitoring, backups, PostgreSQL maintenance and incident runbooks are in [Operations](operations.md). For local development, see [Development](../development/setup.md). On NixOS, use the flake's module instead: [Self-hosting on NixOS](nixos.md).

`deploy/compose.yaml` is self-contained: a server needs only that file, `deploy/.env` (from `deploy/.env.example`) and the optional `deploy/api.env`, in one directory. No checkout or script is required. The commands below run from a checkout's root, where `-f deploy/compose.yaml` points at it. From a directory holding just those files, plain `docker compose` works.

## Topology

| Service | Image | Role | Network |
| --- | --- | --- | --- |
| `web` | `ghcr.io/<owner>/penny-web` | Unprivileged nginx: the v2 web app (`apps/web`), SPA fallback, and a same-origin proxy for `/api/` ([web app](#the-web-app)) | The only published port (default `127.0.0.1:8080`) |
| `api` | `ghcr.io/<owner>/penny-api` | ASP.NET Core API plus the background workers (shared recurrence, push delivery, search embeddings). Applies pending database migrations on startup, before it serves | Internal network only |
| `postgres` | `pgvector/pgvector:0.8.7-pg18-trixie` (digest pinned) | PostgreSQL 18.6 with `pg_trgm` and pgvector 0.8.7; profile `bundled-postgres` | Internal |

Persistent data lives in two named volumes: `penny-postgres` (the database) and `penny-receipts` (encrypted receipt files at `/var/lib/penny/receipts`). The receipt master key lives in `deploy/.env` and **must be backed up separately**; without it, receipts can't be decrypted.

Startup order is enforced by Compose: PostgreSQL healthy → `api` healthy (`/api/ready`) → `web`. On startup the API migrates the database before it starts its workers and listener: it creates the `penny` schema and the `pg_trgm` and `vector` extensions when missing and applies pending EF migrations under an advisory lock. While PostgreSQL is unreachable or another process is migrating, it retries for up to 5 minutes; any other migration failure is logged (without credentials or SQL) and the container exits, so it restarts and `up --wait` reports it. Its readiness check fails (503) until the schema, extensions and receipt storage are all correct. The healthcheck allows 120 seconds for a first start or an upgrade that migrates.

Containers run as non-root users (API uid 1654, nginx uid 101), with read-only root filesystems, all capabilities dropped and `no-new-privileges`. Images are built for **linux/amd64** and **linux/arm64**; every base image is pinned to a multi-platform digest.

### Background workers

One `api` container runs every worker. Each worker claims rows with PostgreSQL leases, so running more than one API process is safe: no work is done twice, and an expired lease is taken over after a crash.

| Worker | Setting (default `true`) | Work |
| --- | --- | --- |
| Shared recurrence | `Recurrence__Worker` | Records due recurring household expenses ([shared recurrence](../reference/shared-recurrence.md)) |
| Push delivery | `Push__Worker` | Drains the notification outbox to APNs ([push](../reference/push.md)) |
| Search embeddings | `Search__EmbeddingWorker` | Embeds new search documents and receipt text chunks ([search](../reference/search.md)) |
| Mail delivery | `Email__Worker` | Sends queued password reset and invitation emails, when email is configured ([email delivery](email.md)) |
| Receipt text | `Ocr__Worker` | Extracts the text of uploaded receipts on this server with Tesseract, poppler and libvips ([receipt OCR](operations.md#receipt-text-ocr)) |

Supported topologies:

- **One API container** (the default): the API serves HTTP and runs all workers.
- **Several API containers** behind `web`, all with workers on, or a dedicated worker container (same image and settings, workers on, no traffic) with the HTTP containers set to `false`. Rate limits (sign-in, invites, search) are kept in memory per process, so each process allows the configured number. Keep the total pool size within PostgreSQL's `max_connections` ([pool sizing](operations.md#connections-and-pool-sizing)).

API replicas that start together migrate one at a time: the others wait for the advisory lock and then find nothing to apply. To migrate separately instead (for example before rolling out several replicas), set `Database__MigrateOnStartup=false` in `deploy/api.env` and run `docker compose -f deploy/compose.yaml run --rm api migrate` before `up`.

## Quick start

Requirements: Docker Engine with Compose v2.24+ or Podman with a Compose provider, and a TLS reverse proxy in front for anything beyond `localhost`.

```sh
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
# set PENNY_PUBLIC_ORIGIN, then fill in the two secrets:
#   openssl rand -hex 24      (PENNY_DB_PASSWORD)
#   openssl rand -base64 32   (PENNY_RECEIPT_KEY)
docker compose -f deploy/compose.yaml up -d --wait
```

`deploy/.env` holds the password of the API's PostgreSQL login, a 32-byte receipt master key (base64) and the public origin users will open. Compose refuses to start while any of them is empty. Back the file up: without the receipt key, receipts cannot be decrypted. To build the images from a checkout instead of pulling them, run `docker compose -f deploy/compose.yaml -f deploy/compose.build.yaml build` first, or set `PENNY_API_IMAGE`/`PENNY_WEB_IMAGE` to your own tags.

Then open the origin, create your account, and turn off open registration:

```sh
echo 'Auth__AllowRegistration=false' >> deploy/api.env   # create from deploy/api.env.example, mode 0600
docker compose -f deploy/compose.yaml up -d --wait
```

Check `https://penny.example.com/api/ready` returns `{"ok":true}`. Mobile users choose that HTTPS origin on the sign-in screen.

## Reverse proxy and TLS

Terminate TLS in your existing proxy and forward the whole hostname to the `web` port (`PENNY_BIND:PENNY_PORT`, default `127.0.0.1:8080`). The API is never published.

- **Origin and cookies.** `PENNY_PUBLIC_ORIGIN` must be exactly the origin in the browser's address bar (scheme, host and non-default port, no path); the API rejects mutating requests from other origins with 403 and answers CORS preflights only for it. To serve more than one origin, set `PENNY_PUBLIC_ORIGIN` to a comma-separated list (the Compose `environment` value wins over `api.env`). With `PENNY_SECURE_COOKIES=true` (the default, required for an `https://` origin) session cookies are `Secure; HttpOnly; SameSite=Lax`. Use `http://` only for `localhost` testing.
- **Keep the browser origin stable.** Browsers keep Penny's offline changes per origin. Serving Penny from a new host, port or scheme starts every browser with an empty offline store, so ask users to let their tabs finish syncing ("changes waiting" gone) before such a move. See [browser offline sync](../web/offline-sync.md#deployment-origin-continuity).
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
| `PENNY_DB_USER` | `penny` | The API's PostgreSQL login; it owns the `penny` schema. The bundled `postgres` creates it on first initialization. `penny_migrator` for installs from before the [single database user](#single-database-user) |
| `PENNY_DB_PASSWORD` | (required) | Its password; only `postgres` (first initialization) and `api` receive it |
| `PENNY_RECEIPT_KEY` | (required) | `Receipts__MasterKey`, base64 of 32 bytes; never rotated, never logged |
| `COMPOSE_PROFILES` | `bundled-postgres` | Empty for an [external PostgreSQL](#external-postgresql) |
| `PENNY_DB_HOST` / `PENNY_DB_PORT` / `PENNY_DB_NAME` | `postgres` / `5432` / `penny` | Database location |
| `PENNY_DB_SSL_MODE` | `Disable` | Npgsql `SSL Mode`; use `VerifyFull` for any remote server |
| `PENNY_DB_OPTIONS` | empty | Appended to the connection string, starting with `;`, for example `;Root Certificate=/run/penny/ca.pem` |
| `PENNY_API_IMAGE` / `PENNY_WEB_IMAGE` | `ghcr.io/mfalicoff/penny-*:latest` | Pin exact release tags in production |
| `PENNY_BIND` / `PENNY_PORT` | `127.0.0.1` / `8080` | Published address of `web` |
| `PENNY_SUBNET` | `172.31.63.0/24` | Compose network; also the API's trusted proxy range |
| `PENNY_REAL_IP_FROM` | `127.0.0.1/32` | Outer proxy trusted by nginx for `X-Forwarded-For` |
| `PENNY_WEB_TELEMETRY_URL` | empty (off) | Opt-in browser telemetry: a Faro collector URL (`https://`, no query), such as Grafana Cloud Frontend Observability's. Published as `/telemetry.json` and allowed in the page's `connect-src`; `web` refuses to start with anything else ([web app telemetry](observability.md#web-app-telemetry)) |

The password must not contain `;` (it is embedded in the connection string); use hex, as `openssl rand -hex 24` produces. The bundled `postgres` image reads `PENNY_DB_USER` and `PENNY_DB_PASSWORD` only when it initializes an empty volume; changing them later in `.env` does not change the database. To rotate the password, change it in PostgreSQL first, then in `.env` ([secret rotation](operations.md#secret-rotation)).

### Single database user

The API uses one PostgreSQL login: it creates and migrates the schema on startup and serves with the same login. Releases before this change used a one-shot `migrate` service with three logins: an administrator (`PENNY_ADMIN_PASSWORD`), `penny_migrator` (the schema owner, `PENNY_MIGRATION_PASSWORD`) and a restricted `penny_runtime` (`PENNY_RUNTIME_PASSWORD`). To upgrade an existing install:

1. Take a backup ([backup](operations.md#back-up)).
2. In `deploy/.env`, set `PENNY_DB_USER=penny_migrator` and `PENNY_DB_PASSWORD` to the old `PENNY_MIGRATION_PASSWORD` value, and delete `PENNY_ADMIN_PASSWORD`, `PENNY_ADMIN_USER`, `PENNY_MIGRATION_PASSWORD` and `PENNY_RUNTIME_PASSWORD`. Use `deploy/compose.yaml` and `deploy/.env.example` from the new release.
3. `docker compose -f deploy/compose.yaml pull && docker compose -f deploy/compose.yaml up -d --wait --remove-orphans`. `--remove-orphans` removes the old `migrate` container.

`penny_migrator` already owns the `penny` schema, and the extensions already exist, so it needs no superuser privileges. Do not set `PENNY_DB_USER=penny` on an existing volume: `POSTGRES_USER` only applies when a volume is first initialized, so that login does not exist there. The bundled database's `postgres` superuser keeps its old password (the former `PENNY_ADMIN_PASSWORD`); keep that in your secret manager for administration. Once the upgrade is verified, an administrator can drop the unused runtime role:

```sh
docker compose -f deploy/compose.yaml exec postgres psql -U postgres -d penny -c 'DROP OWNED BY penny_runtime; DROP ROLE penny_runtime;'
```

`DROP OWNED BY` removes only that role's grants; it owns no objects. Use `-d` with your `PENNY_DB_NAME` if it is not `penny`.

### `deploy/api.env` (optional API settings)

Copy `deploy/api.env.example` to `deploy/api.env` (mode 0600, git-ignored). It is passed only to `api`. Everything the API reads uses ASP.NET's double-underscore names:

| Setting | Default | Notes |
| --- | --- | --- |
| `Auth__AllowRegistration` | `true` | Password sign-up |
| `Legal__PrivacyPolicyUrl` | unset | Your privacy policy, an absolute `https://` (or `http://`) URL without credentials. `GET /api/info` publishes it and the apps link it on sign-in, create account and Settings › Profile, opening it in the browser. Unset, they show no link. Set it before you open registration to anyone else |
| `Auth__RateLimitPermits` / `Auth__InviteRateLimitPermits` | 40 / 20 | Sign-in attempts per client per 15 minutes / invite joins per client per 10 minutes, per process |
| `Auth__PasswordResetHours` | 24 | Lifetime of operator-issued reset codes ([password reset](../reference/authentication.md#password-reset-maz-123)) |
| `Oidc__Issuer`, `Oidc__ClientId`, `Oidc__ClientSecret`, `Oidc__RedirectUris`, `Oidc__Label`, `Oidc__AllowRegistration` | off | See [OIDC](#openid-connect-oidc-sign-in) |
| `Push__Apns__TeamId`, `Push__Apns__KeyId`, `Push__Apns__Topic`, `Push__Apns__PrivateKey` | off | All four or none ([push](../reference/push.md)) |
| `Email__Smtp__Host`, `Email__Smtp__Security`, `Email__Smtp__Port`, `Email__Smtp__Username`, `Email__Smtp__Password`, `Email__From`, `Email__AppUrl` | off | Password reset and invitation emails through your SMTP provider ([email delivery](email.md)). The password is a secret |
| `Recurrence__Worker`, `Push__Worker`, `Search__EmbeddingWorker`, `Ocr__Worker`, `Email__Worker` | `true` | [Workers](#background-workers) |
| `Ocr__Languages` | `eng+fra` | Tesseract languages for receipt text; each needs its language data, checked at startup ([receipt OCR](operations.md#receipt-text-ocr)) |
| `Ocr__Concurrency` / `Ocr__TimeoutSeconds` / `Ocr__MaxPages` / `Ocr__MaxFileMegabytes` / `Ocr__MaxAttempts` | 1 / 120 / 10 / 10 / 4 | Receipt text bounds per process |
| `Ocr__EngineMemoryMegabytes` | 1024 | Memory (address space) of each OCR engine process, enforced with `prlimit` ([receipt OCR](operations.md#receipt-text-ocr)) |
| `PENNY_API_MEMORY` (Compose) | `3g` | Memory limit of the `api` container (API, search model and OCR engines); raise it by about `Ocr__EngineMemoryMegabytes` per extra `Ocr__Concurrency` |
| `Database__MaxPoolSize` | 20 | 1–100 connections per process |
| `Database__ConnectTimeoutSeconds` / `Database__CommandTimeoutSeconds` | 5 / 5 | 1–30 |
| `Backend__MaxRequestBodyBytes` | 20 MiB | Keep `PENNY_MAX_BODY` slightly above it |
| `Backend__RequestTimeoutSeconds` | 30 | Requests past it get 503 with `Retry-After` |
| `Receipts__MinFreeMegabytes` | 100 | Readiness fails (`disk-space`) below this much free space on the receipt volume |
| `Receipts__UnlinkedRetentionDays` | 30 | Receipts nothing links to (discarded drafts, removed or replaced receipts) are deleted once this old, 1–3650; keep it longer than devices stay offline ([unlinked receipts](../reference/receipts.md#unlinked-receipts)) |
| `Receipts__CleanupWorker` | true | `false` stops this process from deleting unlinked receipts (every six hours); `receipts-sweep` still does |
| `Search__RateLimitPermits` | 30 | Searches per session per minute |
| `Logging__LogLevel__Default` | `Information` | `Warning` drops the per-request access line |
| `OTEL_EXPORTER_OTLP_ENDPOINT` and the other standard `OTEL_*` variables | off | Traces, metrics and logs over OTLP to an OpenTelemetry Collector or Grafana Alloy ([telemetry](operations.md#telemetry-opentelemetry)); a ready-made Grafana stack: [observability](observability.md) |

The image already sets `ASPNETCORE_ENVIRONMENT=Production`, `ASPNETCORE_HTTP_PORTS=8080`, `Search__ModelDirectory=/opt/penny/model` (the pinned, SHA-256-verified embedding model), `Receipts__Root=/var/lib/penny/receipts`, JSON console logs and `DOTNET_EnableDiagnostics=0`, and contains Tesseract (English and French language data) and poppler-utils for receipt text extraction. Production serves no OpenAPI or Scalar routes and never enables the test controls.

Keep secrets out of the image, the repository and command lines. If your platform has a secret manager, inject the same variable names into the services instead of using `.env` files.

### External PostgreSQL

Requirements: PostgreSQL **18** (the API refuses other majors), with `pg_trgm` and pgvector **0.8 or later** available. The API needs one login that can create the `penny` schema; it never needs an administrator. Once, as an administrator:

```sql
CREATE ROLE penny LOGIN PASSWORD '…';           -- or let your provider create the user
GRANT CREATE ON DATABASE penny TO penny;        -- or: CREATE SCHEMA penny AUTHORIZATION penny;
\c penny
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;
```

The API creates missing extensions itself when its login may, but `vector` is not a trusted extension and needs a superuser, so on most servers the administrator creates both. Without them the API stops on startup with "extensions are missing and the database user cannot create them. Create them as an administrator". On managed services where the administrator is not a superuser, use the provider's extension mechanism (for example an allow-list parameter) and confirm availability first: `SELECT name, default_version FROM pg_available_extensions WHERE name IN ('pg_trgm', 'vector');`. See [managed hosts](operations.md#managed-postgresql-hosts).

Then in `deploy/.env`: `COMPOSE_PROFILES=` (empty), `PENNY_DB_HOST`, `PENNY_DB_PORT`, `PENNY_DB_NAME`, `PENNY_DB_SSL_MODE=VerifyFull`, `PENNY_DB_USER` and `PENNY_DB_PASSWORD`. For a private CA, mount the certificate read-only into `api` with a `compose.override.yaml` and point `PENNY_DB_OPTIONS=;Root Certificate=/run/penny/ca.pem` at it. A connection pooler in front of PostgreSQL must run in **session** mode: the migration holds a session advisory lock.

### Client connection checks

Set `client_connection_check_interval = 1s` on the server. When a database command times out (`Database__CommandTimeoutSeconds`) and PostgreSQL doesn't acknowledge the cancellation within a second, the API closes the connection. Without this setting, PostgreSQL notices that only once the statement finishes, so the statement keeps running and holding its locks, and one timed-out request can block other users' writes for as long as it runs. With it, PostgreSQL checks the connection every second while a statement runs and stops the statement when the client is gone.

The bundled `postgres` service, the [NixOS module](nixos.md) and the development stacks set it already. For an external server, set it in `postgresql.conf` (or your provider's parameter group), or for Penny's database only, as an administrator or the database owner: `ALTER DATABASE penny SET client_connection_check_interval = '1s';` (applies to new connections). On startup the API logs a warning, "PostgreSQL has client_connection_check_interval off", while its connections see the setting off. PostgreSQL supports the check only on Linux and a few other systems.

## Upgrade

Every release is forward-only. Read the release notes first: they state whether the release contains a database migration. A database created before the EF migrations were squashed into `InitialSchema` is moved onto the squashed history by the migration itself, with no extra step ([backend README](../../apps/backend/README.md#upgrading-a-database-from-before-the-squash)).

1. Take a backup ([backup](operations.md#back-up)) and note the current image tags.
2. Set `PENNY_API_IMAGE` and `PENNY_WEB_IMAGE` to the new **exact** version tags in `deploy/.env`, and use `deploy/compose.yaml` from the same release.
3. `docker compose -f deploy/compose.yaml pull && docker compose -f deploy/compose.yaml up -d --wait`. Compose recreates `api`, which applies new migrations before it serves, then `web`. The old API keeps serving until the new one is ready only if you run more than one replica; otherwise expect a short gap.
4. Check `/api/ready`, sign in, open a ledger and a household, and download a receipt. Watch the logs for errors ([monitoring](operations.md#monitoring)).

### Upgrading to 3.0

3.0 changes how the API logs in to PostgreSQL. The API now migrates the database itself on startup with one login, so the separate one-shot `migrate` service and the three logins (administrator, `penny_migrator`, `penny_runtime`) are gone. Compose reads `PENNY_DB_USER` and `PENNY_DB_PASSWORD` instead.

- **Docker Compose:** follow [Single database user](#single-database-user) before you run `up`. Set `PENNY_DB_USER=penny_migrator` and `PENNY_DB_PASSWORD` to the old migration password, remove the old password variables, and run `up -d --wait --remove-orphans`.
- **NixOS:** the module renames `migrationUser` and `migrationPasswordFile` and removes the runtime options ([NixOS](nixos.md)). On a local database it reassigns `penny_migrator`'s objects by itself.
- **External PostgreSQL:** give the one login the API uses ownership of the `penny` schema, or keep using the old migration login as `PENNY_DB_USER`.

A failed migration leaves the previous schema in place (each migration runs in its own transaction), and the API exits without serving; its log names the reason. Fix the cause and run `up` again.

### The web app

The `web` image serves the browser app (`apps/web`: React, Vite, TanStack). It talks to the API on the same origin with the `penny_session` cookie, so the web and API images can be upgraded or rolled back separately within the API's compatibility window.

- **Caching.** `index.html` is `no-cache`, so a new release takes effect on the next page load. Files under `/assets/` are fingerprinted and `immutable`; a missing asset is a plain 404 and is not cached. `/version.json` (no-store) reports the image's `version` and `revision`: check it after an upgrade or rollback. A tab left open from before the upgrade recovers when it is reloaded.
- **URLs and sign-in.** Every app route (`contracts/design-baseline.json` `navigation.routes`), including the OIDC callback `/auth/callback`, opens the app's page, so `Oidc__RedirectUris` and bookmarks keep working across releases.
- **Offline changes carry over.** Unsynced changes stay in the browser's offline store across releases ([browser offline sync](../web/offline-sync.md)). Keep the same origin, or the browser starts with an empty store.
- **Supported browsers:** current and previous major versions of Chrome, Edge, Firefox and Safari (macOS and iOS), which are tested in CI on Chromium, Firefox and WebKit. The app needs ES2022, IndexedDB, Web Locks and module workers. Older browsers aren't supported.

## Roll back

- **Release without a migration:** set the previous image tags and run `up -d --wait` again. The web image can be rolled back on its own ([web app](#the-web-app)).
- **Release with a migration:** the previous build refuses the newer schema. On startup its migration refuses "Database schema is newer than this build" and the API exits. Prefer rolling forward with a fixed release. If you must go back, restore the pre-upgrade backup ([restore](operations.md#restore)) with the previous images, then reconcile the writes accepted since the backup ([write reconciliation](operations.md#write-reconciliation-after-a-rollback)).

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

Penny supports one configurable OIDC provider alongside email/password login on web and iOS. Configure a client supporting Authorization Code with S256 PKCE and the `openid email profile` scopes. The provider must return a verified email (`email_verified: true`) in the ID token or UserInfo response.

Set these server-side values in `deploy/api.env`:

```dotenv
Oidc__Issuer=https://identity.example.com/realms/penny
Oidc__ClientId=penny
Oidc__ClientSecret=your-server-only-secret
Oidc__RedirectUris=https://penny.example.com/auth/callback,penny://auth/callback
Oidc__Label=Single sign-on
Oidc__AllowRegistration=true
```

Use the exact issuer URL advertised by your provider. Register each exact redirect URI with the provider; wildcards are unsupported. Web sign-in uses a popup and requires HTTPS or localhost; keep the popup and original window on the same origin (the `web` container serves `/auth/callback`). The client secret is optional for public clients; confidential clients use `client_secret_post`. Never put it in client configuration. Pending sign-in attempts are stored in PostgreSQL, so they survive restarts and work with several API containers.

New OIDC accounts are disabled by default. Set `Oidc__AllowRegistration=true` to provision an empty ledger on first sign-in, then set it back to `false`. This is independent of password sign-up. Existing users are identified by the stable `(issuer, subject)` pair; an existing account with the same email is **never automatically linked**. The native iOS app uses the same `penny://auth/callback` redirect in an ephemeral system sign-in sheet ([native sign-in](../ios/authentication.md#provider-and-callback-setup)). Details and troubleshooting: [OIDC on the .NET backend](../reference/authentication.md#openid-connect-maz-54).

## Phone notifications

On iOS, Penny requests notification permission and registers the signed-in device. Other active members receive a push for a new expense, an edited expense, or a recorded reimbursement; a recurring occurrence counts as a new expense. Web does not register for push.

The .NET API delivers notifications through APNs (`Push__Apns__*`). Provider calls go out from the `api` container; allow outbound HTTPS to `api.push.apple.com` (`api.sandbox.push.apple.com` for development builds). Credentials, the `push-smoke-apns` check and delivery diagnostics: [push](../reference/push.md).

For signed mobile distribution and release tags, see [Releases](../development/releases.md).

## Emailed receipts

Off by default. Each user can get a private address such as `r-7kq2m9xh4tdw3pzc8vbn@receipts.example.com`; mail sent there becomes a PDF of the email plus each receipt attachment, in the user's receipt inbox ([design](../plans/email-receipts.md)). Penny never sends mail.

1. **A receipts-only subdomain on Cloudflare** with Email Routing enabled (it creates the MX records). Nothing else should receive mail there.
2. **The Email Worker** in [`apps/email-worker`](../../apps/email-worker/README.md), deployed with Wrangler, with a catch-all Email Routing rule to it. It refuses unknown recipients and forwards signed raw mail.
3. **A private path from the Worker to the API.** The public `web` proxy answers 404 for `/api/inbound-mail`. Recommended: a Cloudflare Tunnel (`cloudflared`) to a separate internal hostname that routes to `api:8080`. Alternatively, a hostname behind Cloudflare Access with a service token (the Worker's `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`).
4. **The renderer and settings.** Add `email-receipts` to `COMPOSE_PROFILES` (for example `COMPOSE_PROFILES=bundled-postgres,email-receipts`) to start `penny-render`: Gotenberg with JavaScript off, read-only, without capabilities, on the internal-only `render` network. Then set in `deploy/api.env`:

   ```sh
   InboundMail__Enabled=true
   InboundMail__Domain=receipts.example.com
   InboundMail__WebhookSecret=<openssl rand -base64 32>   # also the Worker's PENNY_WEBHOOK_SECRET
   ```

| Setting | Default | Notes |
| --- | --- | --- |
| `InboundMail__Enabled` | `false` | Off: the routes answer 404 (GET `/api/receipt-email` reports `enabled: false`) and no worker runs |
| `InboundMail__Domain` | | The receipts subdomain |
| `InboundMail__WebhookSecret` | | Base64 of at least 32 bytes, shared with the Worker |
| `InboundMail__Worker` | `true` | Converts received mail in this process (leased, like OCR) |
| `InboundMail__RendererUrl` | `http://penny-render:3000` | Internal network only |
| `InboundMail__AuthServId` | `mx.cloudflare.net` | Whose `ARC-Authentication-Results` decide "sender verified" |
| `InboundMail__MaxMessageBytes` | `26214400` | 25 MiB |
| `InboundMail__AddressLifetimeDays` | `90` | Users can extend |
| `InboundMail__InboxRetentionDays` | `30` | Unhandled inbox items are then discarded |
| `InboundMail__HourlyLimit`, `__DailyLimit` | `20`, `100` | Per address |
| `InboundMail__MaxPendingPerUser`, `__MaxPendingTotal` | `200`, `10000` | Over a limit, mail is refused during the SMTP session |

The worker uses the OCR engine's libvips and poppler, so the API image needs no extra packages.

**NixOS:** `services.penny.inboundMail = { enable = true; domain = "receipts.example.com"; webhookSecretFile = "/run/secrets/penny-inbound-mail-secret"; };` runs `penny-render` as a hardened systemd unit (`DynamicUser`, loopback-only `IPAddressAllow`, syscall filter, `MemoryMax`) and keeps `/api/inbound-mail` out of nginx. Point the tunnel at the API's `listenAddress:port`.
