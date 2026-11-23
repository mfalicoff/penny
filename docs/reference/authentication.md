# Password, OIDC authentication and sessions (.NET)

The .NET API serves password registration, login, `me` and logout (MAZ-53), OIDC sign-in (`/api/auth/oidc*`, MAZ-54, see [OpenID Connect](#openid-connect-maz-54)) and an [operator-issued password reset](#password-reset-maz-123) (MAZ-123). The wire contract is in `contracts/openapi.json`.

## Behavior

| Area | Behavior |
| --- | --- |
| Password hash | ASP.NET Core Identity `PasswordHasher` v3 (PBKDF2-HMAC-SHA512, 100,000 iterations, 128-bit salt embedded in the hash, base64), stored in `users.password`. |
| Hash verification | Identity compares hashes in constant time. Missing users, empty OIDC-only passwords and hashes Identity can't read are checked against a dummy hash, so they cost the same as a wrong password and all return the same `401`. When Identity reports that a hash uses outdated parameters, a successful login rewrites it, but only if the stored hash has not changed in the meantime. |
| Email | Trimmed with JavaScript's whitespace set, ASCII-lowercased (plus U+212A → `k`), checked against zod 4's email pattern and limited to 254 UTF-16 units. Lookup and uniqueness are bytewise (`C` collation), so a stored email with uppercase letters never matches a password login. |
| Password | 10–256 UTF-16 code units, not trimmed. |
| Register | Rate limit → JSON parse → policy (`403 Account registration is disabled on this server.`) → validation (`400 Enter a valid email and a password of 10–256 characters.`) → duplicate check (`409`). The user, ledger (revision 0, CAD) and the 12 default categories are inserted in one transaction. A concurrent registration for the same email waits on the unique index and gets the same `409`. Any other failure rolls back all rows and returns the generic 500. |
| Login | Invalid input, unknown email and wrong password all return `401 Email or password is incorrect.` |
| Tokens | 32 random bytes as lowercase hex (64 characters). Only SHA-256(token text) is stored in `sessions.token_hash`. |
| Lifetime | 30 days from issue, with no sliding renewal. Valid while `expires_at > now`; time is truncated to whole milliseconds (integer expiry). Issuing a session first deletes sessions with `expires_at < now`; their push devices are removed by the database cascade. |
| Transport | Register/login return `{token,email}` and set `penny_session=<token>; HttpOnly; SameSite=Lax; Path=/api; Max-Age=2592000` (plus `Expires`), with `Secure` when configured. Logout deletes only the current session, expires the cookie and returns `{ok:true}`. ASP.NET writes cookie attribute names in lowercase; browsers treat them case-insensitively. |
| Precedence | A well-formed `Authorization: Bearer <64 lowercase hex>` header always wins, even when the token is unknown or expired. A malformed header falls back to the first `penny_session` cookie. |
| Protection | Every endpoint, and every unknown route, requires a session unless it is marked `[AllowAnonymous]` (health, info, ready, register, login, OIDC, password reset and development docs). Anonymous requests get `401 Please sign in to continue.`; authenticated requests to unknown routes get `404 API route not found.` Public routes never read session storage, so liveness does not depend on PostgreSQL. |
| Origin/CSRF | Any non-GET request whose `Origin` header is not in the allowed list gets `403 This origin is not allowed.` This includes preflights. Requests without an Origin header, such as native clients, are not checked. |
| CORS | Allowed origins are reflected with `Access-Control-Allow-Credentials: true`. Preflight allows GET/HEAD/PUT/PATCH/POST/DELETE and any request header. |
| Rate limit | Register, login, OIDC start, OIDC complete and password reset (MAZ-123) share one fixed 15-minute window of 40 requests per client in each process. IPv6 clients are grouped by /56, and IPv4-mapped addresses count as IPv4. A blocked request gets `429 Too many attempts. Please try again in 15 minutes.` with `Retry-After`. The draft-8 `RateLimit`/`RateLimit-Policy` headers are not sent. Counters are in memory and are lost on restart. `POST /api/households/join` has its own 10-minute window of 20 attempts (`Auth__InviteRateLimitPermits`, see [households](households.md#validation-and-errors)). |

## Configuration

| Setting | Default / behavior |
| --- | --- |
| `Auth__AllowRegistration` | `true`. Must be `true` or `false`. |
| `Auth__SecureCookies` | `false`. Set `true` whenever clients reach the API over HTTPS. |
| `Auth__AllowedOrigins` | `http://localhost:8081,http://localhost:3001` (development origins; always set it in production). A comma-separated list of exact browser origins (`scheme://host[:port]`). The host must be lowercase, with no path and no default port. Startup fails on any other form, so the CORS and origin checks cannot disagree. |
| `Auth__TrustedProxies` | Empty. A comma-separated list of IPs or CIDR ranges. |
| `Auth__RateLimitPermits` | `40` per 15 minutes; bounded 1–10,000. Tests use their own hosts. |
| `Auth__PasswordResetHours` | `24`. Lifetime of an operator-issued [reset code](#password-reset-maz-123), in whole hours; bounded 1–168 (7 days). Read by the `reset-password` command when it issues a code; changing it does not affect codes already issued. |

Invalid values fail before the server listens, naming the setting.

### Reverse proxies

The backend trusts **no** forwarding headers by default, not even from loopback. Behind a reverse proxy, every client then shares the proxy's rate-limit bucket. Set `Auth__TrustedProxies` to the proxy's address, for example `Auth__TrustedProxies=10.0.0.2` or `172.18.0.0/16`. `X-Forwarded-For` is then honored for one hop from those addresses only. Never list networks that untrusted clients can connect from, because they could then pick their own rate-limit key. `X-Forwarded-Proto` is not used: cookie security is explicit through `Auth__SecureCookies`. The proxy must pass the browser's `Origin` header through unchanged.

## Password reset (MAZ-123)

Without [email delivery](../self-hosting/email.md), resets are **operator-issued**: someone with access to the server's configuration runs a maintenance command for the user's email, then delivers the printed code to the user over a channel they already trust (in person, a message, a phone call). The user enters the code and a new password in the app. It is in the [contract](api-reference.md) as `POST /api/auth/password-reset`.

### Flow and checks

| Step | Behavior |
| --- | --- |
| Issue | `reset-password EMAIL` (see [runbook](#operator-runbook)) normalizes the email with the sign-in rule (JavaScript trim, ASCII lowercasing, zod pattern, 254 units) and finds the account bytewise, exactly as login does. It works for password accounts and OIDC-only accounts. A malformed email or one no account uses fails with a clear message and exit code 1; this answer exists only on the operator's console, never over HTTP. |
| Code | 32 random bytes from `RandomNumberGenerator` as 64 lowercase hex characters (the session token format). Only SHA-256 of the code is stored, in `penny.password_resets` (`token_hash` primary key, `user_id`, `created_at`, `expires_at`). It is printed once, on stdout, and never logged. |
| Lifetime | Valid while `expires_at > now`, `Auth__PasswordResetHours` (default 24) after issue, with millisecond precision like sessions. Issuing any code first deletes every expired code; presenting an expired code deletes it and is rejected. |
| Superseded | A user has at most one code (unique `user_id`). Issuing a new one deletes the previous one in the same transaction, so only the latest code works. Two simultaneous issues for the same user cannot both succeed: one fails and can simply be re-run. |
| Redeem | `POST /api/auth/password-reset` with `{token, password}`, anonymous. Checks run in this order: rate limit, origin policy, JSON parsing (`400 Invalid JSON.`), code format, password rule, then the database. A missing, malformed, unknown, used, superseded or expired code is always `400 This reset code is invalid or has expired.` A password outside 10–256 UTF-16 units (not trimmed, as at registration) is `400 Enter a password of 10–256 characters.` and **does not consume the code**. |
| Effect | In one transaction: the code row is deleted (the delete is the claim, as for OIDC attempts, so concurrent redemptions of one code yield exactly one `200`), `users.password` is set to a new Identity v3 hash, and **every session of the account is deleted** (cookie and bearer alike); their push devices go with them through the existing cascade. OIDC identities are kept. |
| Response | `200 {ok:true}`. No session or cookie is issued; the user signs in with the new password on each device. The request carries no email, so no response reveals whether an account exists. |
| Abuse | The endpoint shares the sign-in rate limit (40 per 15 minutes per client by default). Guessing a 256-bit code is not feasible; the generic error does not distinguish expired from unknown codes. Rejected origins (`403`) leave the code usable. |

**OIDC-only accounts.** A reset is allowed and adds a password to an account that had none; single sign-on keeps working. The command says so when it issues such a code. Operators should only do this at the user's request.

**Changing the password while signed in: deferred.** There is no in-session "change password" endpoint; the operator reset covers recovery for everyone. A signed-in user who wants a new password asks the operator for a code. Revisit this if Penny gains email delivery or a re-authentication step. *(Product decision pending confirmation.)*

**Known limit.** A login that verified the *old* password just before a reset commits can still create a session just after it; the reset cannot see that session. This needs the old password and a race of a few milliseconds; signing out other devices again (another reset) removes it.

### Password reset by email (MAZ-124)

When the server sends email (`emailEnabled` on `GET /api/info`), a signed-out user can ask for a reset themselves. The operator command keeps working alongside it.

| Step | Behavior |
| --- | --- |
| Request | `POST /api/auth/password-reset/request` with `{email}`, anonymous, sharing the sign-in rate limit and origin policy. The email is normalized with the sign-in rule. The answer is always `202 {ok:true}`, whether or not the address has an account, whether an email for it is still waiting and whether a daily limit is reached; only a malformed address (`400 Enter a valid email address.`) or email being off (`404 This server doesn't send email.`) differ, and neither depends on accounts. |
| Queue | For an account, one transaction holding its user row queues a `mail_outbox` row (account id, SHA-256 of the address, language; no address or code), unless one for the account is still unsent or `Email__AccountMessagesPerDay` / `Email__RecipientMessagesPerDay` is reached in the last 24 hours. Nothing is sent inside the request. |
| Send | The mail worker issues the code when it sends: the same code as the operator command (32 random bytes as hex, SHA-256 stored, `Auth__PasswordResetHours`, one per account, replacing any earlier one, operator-issued included), to the account's current address. The email links to `<Email__AppUrl>/reset-password#code=<code>`; the fragment never reaches a server. A retry issues a new code, so only the latest email's link works. |
| Redeem | Unchanged: `POST /api/auth/password-reset` with `{token, password}`, single use, revoking every session. |

The request does a little less work for an unknown address (no outbox insert), so its timing is not perfectly constant; its body, status and headers are identical.

### Operator runbook

Run the command with the same configuration as the API: it uses the API's database login `ConnectionStrings__Postgres` and `Auth__PasswordResetHours`. It never starts HTTP and needs the database to be migrated (the API does that on startup).

```sh
# From a source checkout (loads the development .env):
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- reset-password person@example.com

# From a published build, with the API's environment (secrets from the secret manager):
dotnet Penny.Backend.Api.dll reset-password person@example.com
# In a running API container, the same entry point:
docker exec <api-container> dotnet Penny.Backend.Api.dll reset-password person@example.com
```

- **stdout** is exactly one line: the code. **stderr** says when it expires, that it replaces any earlier code, and whether the account had no password before. Pipe or copy stdout only; do not paste the code into tickets, chat channels or shell history files shared with others.
- **Exit codes:** `0` issued; `1` for usage errors, an invalid or unknown email, a missing or invalid setting (named, never its value) or a database failure (sanitized message).
- **Deliver** the code privately and promptly. Tell the user to open Penny, choose the password reset option, paste the code and choose a new password of 10–256 characters, then sign in again on every device.
- **Lost or leaked code:** run the command again; the new code supersedes the old one. An unused code expires on its own.

Clients: the web app's "Forgot password?" opens `/forgot-password` (asks for an email) when the server sends email and `/reset-password` (enter the code and a new password) when it doesn't; the emailed link opens `/reset-password` with the code filled in (MAZ-124). The native app's screens are MAZ-68's. The endpoint can also be called directly, for example `curl -X POST https://penny.example.com/api/auth/password-reset -H 'Content-Type: application/json' -d @reset.json` with `{"token":"…","password":"…"}` in a private file, by the user or with the user present choosing the password.

## Email verification (MAZ-172)

Verification records that an account's email address is proven: `users.email_verified_at`, shown as `emailVerified` and `emailVerifiedAt` on `GET /api/profile`. **Nothing waits for it**: an unverified account can do everything a verified one can, including inviting people and being invited (owner decision, 2026-11-23). It matters later for linking a password account to a sign-in provider and for abuse controls.

| Account | Verified |
| --- | --- |
| Existed before this change | Yes: the migration `AddEmailVerification` marks every existing row verified |
| Signs in with a provider (OIDC) | Yes, at creation: the provider must say the email is verified (`email_verified: true`) |
| New password account | Not until its emailed link is opened, or an operator runs `verify-email` |
| Changed its email | No: an email change clears it and sends a new link |

| Step | Behavior |
| --- | --- |
| Send | While the server sends email, registration and an email change queue a `mail_outbox` row (`email-verification`, account id, SHA-256 of the address, language; no address or code). The mail worker issues the code when it sends: 32 random bytes as hex, SHA-256 stored in `email_verifications` with the address it was sent to, valid for 48 hours, one per account, replacing any earlier one. The email links to `<Email__AppUrl>/verify-email#code=<code>`. A row whose account is verified by then is dropped unsent. |
| Verify | `POST /api/auth/email-verification` with `{token}`, anonymous (the link may be opened on any device), sharing the sign-in rate limit and origin policy. The code is consumed in one transaction; it verifies only while unexpired and while the account still has the address it was sent to, and keeps an earlier verification time. Missing, malformed, unknown, used, superseded, expired and changed-address codes all get `400 This verification link is invalid or has expired.` Success answers `200 {email}`. It works while email is off too, for links sent before. |
| Resend | `POST /api/auth/email-verification/resend`, signed in, no body. Always `202 {ok:true}`: nothing is queued for a verified account, while an earlier email is unsent, within 60 seconds of the last one, or past `Email__RecipientMessagesPerDay` / `Email__AccountMessagesPerDay`. `404 This server doesn't send email.` while email is off. |
| Change email | `POST /api/auth/email` with `{email, password}`, signed in, sharing the sign-in rate limit. Password accounts only (`403 Your sign-in provider manages your email. Change it with your provider.`). The address follows the sign-up rule (`400 Enter a valid email address.`); a wrong password is `400 Your current password is incorrect.` and the session stays; an address another account uses is `409 Another account already uses this email.`, as at registration. One transaction replaces the email (only if the password hash is unchanged), clears the verification and deletes the pending code, so a code sent to the earlier address never verifies the new one. Then a new link is queued. Sessions stay. Answers the updated profile. |

**Without email.** When `Email__Smtp__Host` is unset, verification is off: nothing is queued, resend answers 404, and the apps show no unverified state or Resend (they read `emailEnabled` on `/api/info`). New password accounts stay unverified until an operator marks them:

```sh
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- verify-email person@example.com
dotnet Penny.Backend.Api.dll verify-email person@example.com
docker exec <api-container> dotnet Penny.Backend.Api.dll verify-email person@example.com
```

It uses `ConnectionStrings__Postgres` only, prints nothing on stdout and a confirmation on stderr ("Marked…" or "already verified"), and exits `1` for usage errors, an invalid or unknown email (named on the console only) or a database failure. Nothing it prints contains the address.

**Clients.** After creating a password account on a server that sends email, the web app opens `/verify-email` ("Check your email": the address, Continue to Penny, Resend after a minute, Change email). The emailed link opens `/verify-email#code=…`; the code is kept in memory and dropped from the address bar, then redeemed once ("Your email is verified", or a refused-link message with Send a new link when signed in). Settings › Profile shows **Verified** beside the email, or, while the server sends email, **Not verified** with **Resend link**.

## OpenID Connect (MAZ-54)

`GET /api/auth/oidc`, `POST /api/auth/oidc/start` and `POST /api/auth/oidc/complete` keep the status codes, messages and shapes of the contract. Clients start an attempt, open `authorizationUrl` in the system browser or a popup, and post the `transaction` they kept plus the full `callbackUrl` they received.

### Flow and checks

| Step | Behavior |
| --- | --- |
| Availability | `GET` returns `{enabled:true,label}` when configured and `{enabled:false}` otherwise. Start and complete return `404 Single sign-on is not configured.` when OIDC is off, after the usual rate limit and JSON parsing. |
| Start | The `redirectUri` must equal one configured URI exactly, otherwise `400 This sign-in redirect is not configured on the server.` The server creates a 64-hex `transaction` (returned once, stored only as SHA-256), plus a random state, nonce and PKCE verifier (32 bytes each, hex). The authorization URL uses the discovered `authorization_endpoint` with `response_type=code`, `scope=openid email profile`, `state`, `nonce`, `code_challenge` and `code_challenge_method=S256`; the transaction, verifier and client secret never appear in it. `expiresAt` is Unix milliseconds, 10 minutes ahead. A discovery failure deletes the attempt and returns `400 The sign-in provider is unavailable. Please try again.` |
| Complete | The body needs a 64-lowercase-hex `transaction` and a `callbackUrl` of at most 8,192 characters (`400 Invalid sign-in response.`). The attempt is **consumed before** any provider call; a missing, already used or expired attempt is `401 Sign-in expired. Please try again.` Every later failure is `401 Sign-in could not be verified. Please try again and allow access to your verified email.` and the attempt stays consumed. |
| Callback | The part before `?` must equal the attempt's redirect URI byte for byte, with no fragment. `state` must match. Any `error` parameter (for example, the user cancelled) fails. A returned `iss` parameter must equal the issuer, and is required when discovery advertises `authorization_response_iss_parameter_supported` (RFC 9207). `state`, `code`, `iss` and `error` must not repeat. |
| Code exchange | Server to server, at the discovered `token_endpoint` (HTTPS only), with `code`, the exact `redirect_uri`, `code_verifier` and `client_id`. Confidential clients also send `client_secret` in the body (`client_secret_post`); public clients send no secret. The response must be JSON with `access_token`, `id_token` and `token_type`. Provider tokens are never returned to clients or stored. |
| ID token | Validated by `Microsoft.IdentityModel` (`JsonWebTokenHandler` and `OpenIdConnectProtocolValidator`): RS256 signature with a key from the discovered JWKS, `iss` equal to `Oidc__Issuer`, `aud` containing `Oidc__ClientId` (and `azp` when present), `exp` (30-second clock tolerance) and required `iat`/`sub`, the attempt's nonce, and `at_hash` when present. An unknown key ID triggers a JWKS refresh. |
| Email | Taken from the ID token, or from UserInfo (HTTPS, JSON, `sub` must match) only when the ID token has no `email` claim. It must be a valid email (the zod rule, at most 254 characters, not trimmed), and `email_verified` must be JSON `true`. It is lowercased. |
| Account | The stable `(issuer, subject)` pair finds the account, so a changed provider email still signs in to the same account and the response shows the stored email. An unknown identity needs `Oidc__AllowRegistration=true` (`403 New single sign-on accounts are disabled on this server.`). An existing account with the same email is **never linked** (`409 An account already uses this email. Sign in with its existing method; automatic account linking is disabled.`). Otherwise the user (empty password), identity, ledger and default categories are inserted in one transaction. If a concurrent first sign-in for the same identity or email wins, the loser gets `409 This account already exists. Please try signing in again.` (or signs in if the identity is already committed when it looks); any other failure rolls back every row and returns the generic 500. |
| Session | The same 30-day `penny_session` cookie and `{token,email}` response as password login. |

### Pending attempts in PostgreSQL

Attempts are stored in `penny.oidc_attempts`: primary key `transaction_hash` (SHA-256 of the transaction), the redirect URI, state, nonce, PKCE verifier and `expires_at`, with format checks and an index on `expires_at`.

- **Single use.** Completion reads the row and then deletes it by key; only the request whose delete affects the row continues. A concurrent redemption waits on the row lock and deletes nothing, so it gets `401` without contacting the provider.
- **Expiry.** An attempt is valid while `expires_at > now`, 10 minutes after start. Every start first deletes expired attempts.
- **Bound.** A start is refused with `403 Too many sign-in attempts. Try again later.` while 1,000 unexpired attempts exist. Concurrent starts may each see room, so this is a flood guard, not an exact quota.
- **Restarts and instances.** Attempts survive restarts and work across API instances on the same database. The provider discovery document and JWKS are cached per process and fetched again after a restart.
- **Secrets at rest.** State, nonce and verifier are stored in plain text for at most 10 minutes; without the transaction (only its hash is stored) and the provider's authorization code they cannot complete a sign-in.

### Configuration

| Setting | Default / behavior |
| --- | --- |
| `Oidc__Issuer` | Unset (OIDC off). An HTTPS URL without credentials, query or fragment. It must equal the provider's advertised `issuer` **exactly** (including any trailing slash); discovery is read from `<issuer>/.well-known/openid-configuration`. |
| `Oidc__ClientId` | Unset. Setting either the issuer or the client ID turns OIDC on, and then the issuer, client ID and redirect URIs are all required. |
| `Oidc__ClientSecret` | Unset: a public client using PKCE only. Set it for a confidential client. Keep it in the secret manager; it is sent only to the token endpoint and is never logged or returned. |
| `Oidc__RedirectUris` | Comma-separated exact URIs: HTTPS, `http://localhost`/`http://127.0.0.1`, or `penny://auth/callback`, without query or fragment. Register each one with the provider. Typical: `https://penny.example.com/auth/callback,penny://auth/callback`. |
| `Oidc__Label` | `Single sign-on`. |
| `Oidc__AllowRegistration` | `false`. Must be `true` or `false`; a typo fails startup. Independent of `Auth__AllowRegistration`. |

Empty values count as unset. Invalid settings fail before the server listens, naming the setting and never including the secret.

**Provider requirements.** OIDC discovery; Authorization Code with S256 PKCE; RS256-signed ID tokens (other algorithms are refused); the `openid email profile` scopes; a verified email in the ID token or a JSON UserInfo response (signed UserInfo responses are not supported); and `client_secret_post` for confidential clients. Provider endpoints must use HTTPS. Provider calls time out after 10 seconds, follow no redirects, accept at most 1 MiB and are excluded from HTTP client logging.

**Troubleshooting.** `400 The sign-in provider is unavailable` means discovery or JWKS could not be fetched, or the advertised issuer differs from `Oidc__Issuer`; compare it with the provider's `/.well-known/openid-configuration`. `400 This sign-in redirect is not configured` means the client's redirect URI is not in `Oidc__RedirectUris`. `401 Sign-in expired` means the attempt was older than 10 minutes, already used, or started against another database. `401 Sign-in could not be verified` covers cancellation at the provider, a redirect URI registered differently at the provider, a rejected code exchange (wrong secret, verifier or redirect URI), an invalid ID token, or an unverified or missing email. The server does not log which check failed, to keep codes, tokens and claims out of logs; reproduce with the provider's own logs. After a provider key rotation the JWKS is refreshed when a token names an unknown key; retry if a sign-in fails at that moment.

## Verification

- Unit (`tests/Penny.Backend.UnitTests/Authentication`, `Configuration/AuthOptionsTests`): Identity hash round trip and format, rejection of empty and malformed hashes, rehash detection, zod email/length parity (cases cross-checked against zod 4.6.7), token hashing, IPv6 grouping and configuration validation.
- Integration against real PostgreSQL 18 and Kestrel (`Controllers/AuthTests`, `Http/SecurityPolicyTests`): register/login/me/logout over cookies and bearer tokens, stored token hashes, bearer precedence, per-session revocation and account isolation, exact millisecond expiry and expired-row purge, generic credential errors, upgrading weaker stored hashes on login, registration policy, concurrent registration (one 201, one 409, one user and ledger), rolled-back registration when the initial ledger fails, allowed and rejected origins and preflights, the 40-request window per host, proxy trust and liveness with the database down.
- OIDC unit (`Configuration/OidcOptionsTests`): defaults, optional/empty settings, required-setting, issuer and redirect URI validation, setting names in errors and secret redaction.
- OIDC integration against real PostgreSQL 18 and a deterministic local provider (`Infrastructure/FakeOidcProvider`: loopback Kestrel with a throwaway HTTPS certificate pinned by the API's provider client, per-run RSA signing keys, discovery/JWKS/token/UserInfo endpoints that check client, secret, redirect URI, single-use code and PKCE; no external network). `Controllers/OidcTests`: disabled routes, the authorization URL and stored hashed attempt, unconfigured redirects, first sign-in creating user/identity/ledger/session with cookie and bearer use, replay, changed provider email, registration disabled, email collision without linking, concurrent first sign-ins (one account), four concurrent redemptions of one attempt (one 200, one token request), exact expiry boundary and purge, unknown transactions, invalid bodies and oversized callbacks, wrong/missing/repeated state, redirect mismatches and fragments, cancellation, missing code, wrong or missing `iss`, bad nonce/audience/issuer/expiry/signature/subject, unverified or invalid email, UserInfo subject mismatch and fallback, provider unavailable or advertising another issuer, completion on a new host after a restart, the 1,000-attempt bound, rollback when the initial ledger fails, and startup failure on invalid settings. `Http/OidcPolicyTests`: one rate-limit window shared with password sign-in, and rejected origins that leave the attempt usable.

- Password reset unit (`Authentication/CredentialsTests`, `Configuration/AuthOptionsTests`): the email-only rule equals the sign-in rule, password limits, and `Auth__PasswordResetHours` default, bounds and errors.
- Password reset integration against real PostgreSQL 18 (`Controllers/PasswordResetTests`, `Http/PasswordResetPolicyTests`, `Migrations/PasswordResetCommandTests`): password and OIDC-only accounts reset and then sign in, with their sessions revoked; a current-hash account's bearer and cookie sessions and push devices are removed while other accounts keep theirs; the stored hash is Identity v3; only SHA-256 of the code is stored; exact expiry boundary and purge (on use and on issue); single use; superseded codes; six concurrent redemptions of one code (one `200`); short, long, missing and non-string passwords rejected without consuming the code; one generic error for missing, malformed, unknown, session-token and non-JSON codes; operator input errors; the rate-limit window shared with sign-in; rejected origins that leave the code usable; no code, code hash or password in trace-level logs; and the `reset-password` process (stdout is only the code, stderr carries no code or connection string, re-running supersedes, unknown/invalid email, usage and missing connection fail with exit code 1).
