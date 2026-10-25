# Self-hosting and configuration

[App showcase](../README.md) · [Documentation](README.md)

Run commands from the repository root. The supplied deployment runs one Node API instance with SQLite and serves the web app from the same origin. For local development, see [Development](development.md).

## Self-host with Docker Compose

The container serves the web app and API on port 3001. A named volume holds the database **including receipts**.

```sh
docker compose up -d --build
```

For LAN access, set `.env` with the actual browser origin, for example:

```dotenv
PORT=3001
CORS_ORIGINS=http://192.168.1.50:3001
COOKIE_SECURE=false
ALLOW_REGISTRATION=true
```

For HTTPS behind your existing reverse proxy:

```dotenv
PORT=3001
CORS_ORIGINS=https://penny.example.com
COOKIE_SECURE=true
ALLOW_REGISTRATION=true
```

Proxy the entire hostname to `penny:3001` (or the host's mapped port). The Docker web build uses the same origin for its API. Mobile users can select that HTTPS hostname on the sign-in screen; optionally set it as the initial build default with `EXPO_PUBLIC_API_URL`. Allow request bodies of at least 20 MB at the proxy for encoded receipt uploads.

After creating your account, set `ALLOW_REGISTRATION=false` and run `docker compose up -d` to disable additional signups. Accounts are separate; sharing a login across your own devices syncs that account's data.

### Automated container builds

The **Build container image** workflow (`.github/workflows/docker-image.yml`) runs on pull requests targeting any branch, pushes to the default branch (`master`), version tags such as `v1.2.3`, and manual runs from the Actions tab. PR creation, reopening, and new commits trigger validation, including Renovate PRs. Lint, type checks, and tests must pass before it builds the image.

It builds both **linux/amd64** and **linux/arm64** from the root Dockerfile. Pull requests build without publishing. Pushes and manual runs publish to `ghcr.io/<owner>/<repository>` using the built-in `GITHUB_TOKEN`; no registry password or Docker Hub account is required. Owner/repository names are lowercased automatically.

Image tags:

- `<package-version>-build.<run-number>.<run-attempt>` on every run, including manual runs and reruns; for example, `1.0.0-build.123.1`, then `1.0.0-build.124.1`, or `1.0.0-build.124.2` when rerunning build 124. No manual version bump or Git tag is needed. Pull requests generate this tag but do not publish it.
- `latest` and `master` for builds on `master`.
- `1.2.3`, `1.2`, and `1` for a matching `v1.2.3` Git release tag. The image version label is `1.2.3`, without the Git tag's `v` prefix. Release tags do not move `latest`.
- `sha-<full-commit-sha>` for identifying the source commit.
- The branch name for manual runs on other branches.

The build version uses `package.json` as its base and GitHub Actions' automatic run number and attempt as its suffix; it does not modify `package.json` or create Git commits or tags. Branch and pull request builds use this build version as the image version label. Tagged releases keep the stable release version label and also receive the unique build tag.

Release tags must match `v` plus the version in `package.json`; shared CI checks reject mismatches before building. Use the full release tag to select a specific release; the minor and major tags move when another release in that series is published. [Release Please](releases.md#automated-release-flow) creates these tags and publishes release notes automatically when its release PR is merged.

To deploy a published image, replace the `build:` block in `compose.yaml` with your image name:

```yaml
    image: ghcr.io/<owner>/<repository>:latest
```

Keep the existing environment variables, ports, and data volume, then run:

```sh
docker compose pull
docker compose up -d
```

For a private GHCR package, authenticate the homelab to GHCR with a token allowed to read that package. Repository/organization policies must permit the workflow to write packages. This workflow builds and publishes images; it does not deploy to your server.

### Backups

Back up the `penny-data` volume. Stop the container during a filesystem backup so SQLite's database and WAL files are consistent; then restart it. Restore the full volume with the service stopped. Alternatively, use SQLite's online backup API. Receipt bytes, password hashes, sessions, and ledgers are all in the database. Keep backups private.

## OpenID Connect (OIDC) sign-in

Penny supports one configurable OIDC provider alongside email/password login on web, iOS, and Android. Configure a client supporting Authorization Code with S256 PKCE and the `openid email profile` scopes. The provider must return a verified email (`email_verified: true`) in the ID token or UserInfo response.

Set these **server-side** variables in `.env` (Compose forwards them automatically):

```dotenv
OIDC_ISSUER=https://identity.example.com/realms/penny
OIDC_CLIENT_ID=penny
OIDC_CLIENT_SECRET=your-server-only-secret
OIDC_REDIRECT_URIS=https://penny.example.com/auth/callback,penny://auth/callback
OIDC_LABEL=Single sign-on
OIDC_ALLOW_REGISTRATION=true
```

Use the exact issuer URL advertised by your provider. Register each exact redirect URI with the provider; wildcards are unsupported. For web development add `http://localhost:8081/auth/callback` (or `http://localhost:3001/auth/callback` when serving the exported app). Web sign-in uses a popup and requires HTTPS or localhost; keep the popup and original window on the same origin. Your reverse proxy must serve the app at `/auth/callback`. Use `CORS_ORIGINS` to allow your web app's origin as usual.

The client secret is optional for public clients. Confidential clients use `client_secret_post` authentication; configure that method at the provider. Never put this secret in an `EXPO_PUBLIC_` variable. Discovery, code exchange, signature/issuer/audience/expiry/nonce validation, and PKCE verification are performed by the server using [openid-client](https://github.com/panva/openid-client). Provider tokens are discarded after sign-in; Penny uses its existing 30-day HttpOnly cookie on web and SecureStore session on native.

For mobile, install a new development or production build containing `expo-web-browser` and the `penny` URL scheme. OIDC cannot be tested in Expo Go. Native sign-in uses the system authentication browser ([Expo WebBrowser SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/)). The app must stay alive during sign-in; after a reload/restart or a 10-minute timeout, start again.

New OIDC accounts are disabled by default. Set `OIDC_ALLOW_REGISTRATION=true` to provision an empty ledger on first sign-in, then set it back to `false` to allow only existing OIDC users. This is independent of password signup's `ALLOW_REGISTRATION`. Restrict who can access the client at your identity provider while provisioning is enabled. Existing users are identified by the stable `(issuer, subject)` pair, including after an email change. An existing account with the same email is **never automatically linked**; account linking/migration is not provided.

Signing out revokes the Penny session; it does not sign out of the identity provider or other Penny devices. Sign-in attempts are single-use and held in server memory, so a server restart requires restarting sign-in. Run one API instance (as in the supplied SQLite/Compose deployment).

## Phone notifications

On iOS and Android, Penny requests notification permission and registers the signed-in device. Other active members receive a push for a new expense, an edited expense, or a recorded reimbursement; a recurring occurrence counts as a new expense. Tapping a notification opens the household and month. Signing out removes that session's device registration. Web does not register for push.

Push requires a new development or production mobile build with `expo-notifications`, the EAS project ID in `app.json`, and platform push credentials configured in EAS. Use `npx eas-cli@latest build --profile development --platform ios` or `--platform android` for a development build, or your production profile for distribution. Follow the [Expo push setup guide](https://docs.expo.dev/push-notifications/push-notifications-setup/) for Apple and Firebase credentials. Android remote push is unavailable in Expo Go. The server sends through the Expo Push Service and retries temporary failures; delivery still depends on device permission, platform credentials, and network access.

## Upgrade an existing server

1. Stop the server and back up the complete SQLite database, including its WAL files, or use SQLite's online backup API. For Compose, stop `penny` and back up the `penny-data` volume before replacing the image.
2. Deploy the updated server first (`docker compose up -d --build` for the supplied setup). It creates the household tables on startup and leaves existing users, private ledgers, and receipts in place. Keep the same database volume.
3. Check `/api/health`, sign in, and confirm an existing private ledger still loads. Then deploy the updated web app and new signed mobile builds. Restore the backed-up database with the server stopped if you need to roll back.

For client-side data upgrades, see [Ledger upgrades](app-guide.md#ledger-upgrades). For signed mobile distribution and release tags, see [Releases](releases.md).
