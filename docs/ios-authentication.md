# Native sign-in and sessions (MAZ-68)

The SwiftUI app signs in with a password or with single sign-on (OIDC), keeps one session per server in the Keychain, restores it at launch and ends it on expiry or sign-out. The state machine and storage are in `apps/ios/Packages/PennyKit/Sources/PennyData/Auth`; the screens are in `Sources/PennyUI/Auth`. Both build on the [API client](ios-api-client.md). The server side is described in [authentication](migration/authentication.md).

## What people see

| Screen (specimen) | Behavior |
| --- | --- |
| Server connect (`server-connect`) | Shown first when no server is saved (Release builds have no default). Enter the base URL without `/api`, then **Check server**. HTTP addresses get a warning. |
| Server verified (`server-verified`) | After a successful check: "Server verified", whether the connection is HTTPS, the name, version and sign-in methods (`Email` or `Email · <SSO label>`). **Use this server** saves it; **Check again** repeats the check. |
| Sign in (`sign-in`) | The server chip (with **Change**), email and password, **Sign in**, **Continue with <label>** when the server offers single sign-on, and **New here? Create an account**. Failures appear under the fields and are announced to VoiceOver; the fields keep what was typed. A wrong password moves focus back to the password field. |
| Create account (`create-account`) | Email and a password of 10–256 characters (checked before sending), then **Create account**. The server can refuse new accounts (`403`) or a used email (`409`); its message is shown. |
| Single sign-on (`sign-in-sso`) | The button shows "Waiting for <label>…" while the system sign-in sheet is open. Closing the sheet, or declining at the provider, returns to the sign-in screen with "Single sign-on was cancelled", which is not an error. If the server cannot be checked for single sign-on, a **Retry** link replaces the button. |
| Server info (`server-info`) | Signed in: the server URL, version, connection, account and whether the session has been confirmed. It is read-only: "To change servers, sync your entries and sign out first." |
| Sign out (`sign-out`) | With no unsynced changes: "Sign out of <server>?". With unsynced changes: "N changes haven't synced" with **Sync, then sign out**, **Sign out anyway** and **Cancel**. If the server cannot be reached, nothing changes and an alert offers **Try again** or **Remove from this device**. |
| Session ended | When the server ends the session (expired after 30 days, revoked by a password reset or sign-out elsewhere), the app returns to sign-in with "Your session for <email> ended" and the email filled in. Changes on the device are kept. |

The redesign cards are `docs/design/penny-ios/iphone/{sign-in,create-account,server-connect,sign-out}.html`. `sign-in-sso`, `server-verified` and `server-info` have no card of their own in this baseline; they are the states of those cards described above (`server-info` follows the Server row of `settings.html`). `docs/design/penny-redesign/screen-inventory.json` (MAZ-122's handoff) does not exist on `v2` yet, so the screens follow `contracts/design-baseline.json` and the cards. The signed-in content is a placeholder (account, server info and sign-out) until the MAZ-69 shell; the demo ("Take a look around with sample data") and the app lock are MAZ-69.

## State machine

`AuthController` (`@MainActor`, `@Observable`) owns one `AuthState`:

| State | Meaning | Leaves to |
| --- | --- | --- |
| `restoring` | Reading the saved server and session at launch | `signedIn` (unverified), `signedOut`, `keychainUnavailable` |
| `keychainUnavailable` | The Keychain is locked (launch before the first unlock). Nothing is deleted or shown. | `restoring` on **Try again** or when the app becomes active |
| `signedOut(reason)` | `nil`, `.signedOut` or `.sessionExpired(email)` | `signingIn`; a server change resets the reason |
| `signingIn(method)` | Password, registration or single sign-on in flight. The server cannot be changed. | `signedIn`, or back to `signedOut` with the same reason on failure or cancellation |
| `signedIn(account)` | `SignedInAccount`: scope (server + lowercased email), a `generation`, and `isVerified` | `signingOut`; `signedOut(.sessionExpired)` on its own 401 |
| `signingOut(account)` | Revoking the session | `signedOut(.signedOut)`, or back to `signedIn` when the server is unreachable |

Rules the tests hold:

- **One session per server, one signed-in account.** A new sign-in replaces the server's stored session. Everything signed-in work uses comes from `AuthController.client`, which carries the current account's token to its own server only.
- **Stale answers are dropped.** Every sign-in, restore, expiry, sign-out and server change bumps a generation. An answer that arrives for an earlier generation (a slow launch check after the session ended, a sign-in that finishes after the server changed) changes nothing; a session it created is revoked again.
- **Only the current account's 401 ends it.** Call `sessionDidExpire(for: scope)` when a request answers 401. A late 401 for another account or server is ignored.
- **Account switching never shows another person's data.** Data is partitioned by `AccountScope`. After an expiry, signing in as someone else gives a new scope and generation; the earlier account's local entries are neither shown, synced nor removed for them. `SearchCoordinator.reset(client:)` and every cache must key on the scope.
- **The server is read-only while signed in.** `useServer` works only while signed out; a candidate server is checked with an anonymous client, so it never receives a token.

## Session restore and recovery

1. **First launch after install.** Keychain items survive app deletion, so a fresh install deletes every Penny session item before reading (`AuthPreferences.hasLaunchedBefore`). A reinstalled app starts signed out instead of silently restoring an old account.
2. **Saved session.** The app signs in immediately, unverified, so local data is available offline, then calls `GET /api/auth/me`:
   - `200` with the same email: verified.
   - `200` with another email (the account's email changed): the token is the authority, so the app switches to that email's scope and stores it.
   - `401`: the token is deleted and the state becomes `signedOut(.sessionExpired(email))`. Local work is kept.
   - Network or server failure: stays signed in, unverified; the next request that answers 401 ends the session.
3. **Keychain locked** (`errSecInteractionNotAllowed`): `keychainUnavailable` until unlock. The session is not deleted and sign-in is not offered, so nobody signs in twice by accident.
4. **Damaged item** (unreadable JSON, wrong server, malformed token): deleted and treated as signed out.
5. **Keychain write failure at sign-in:** the new session is revoked on the server and the person sees "Couldn't keep you signed in on this device", so no valid token is left unsaved.

## Sign-out

`signOut(discardingPendingChanges:removeEvenIfUnreachable:)`, in this order:

1. Refuse with `pendingChanges(count)` while `AccountLocalData.pendingChangeCount` is above zero, unless the person chose **Sign out anyway**. **Sync, then sign out** (`syncThenSignOut`) syncs first and stops with `syncFailed` (nothing removed) when it cannot.
2. `DeviceRegistration.unregister(using:)` while the session still works, so the push `DELETE` is authenticated (MAZ-79 implements it; it must not throw).
3. `POST /api/auth/logout`. A `401` means it already ended. Any other failure returns to `signedIn` with `serverUnreachable`; **Remove from this device** (`removeEvenIfUnreachable: true`) continues, and the server session then stays valid until it expires (at most 30 days).
4. Delete the Keychain item, move to `signedOut(.signedOut)`, then `AccountLocalData.removeLocalData(for:)`.

The legacy app refused to sign out offline at all; the native app keeps that default and adds the explicit removal. Until MAZ-71 and MAZ-79 land, `NoLocalAccountData` (nothing pending) and `NoDeviceRegistration` stand in; those issues provide the real implementations.

## Keychain storage

`KeychainSessionStore` writes one generic-password item per server:

| Attribute | Value | Why |
| --- | --- | --- |
| Service | `com.mfalicoff.penny.session` | Separate from the Expo app's `expo-secure-store` items |
| Account | The normalized server URL (`ServerURL`) | One session per server; a token is never read for another server |
| Value | JSON `{"version":1,"server":…,"email":…,"token":…}` | The server is checked again on read |
| Accessibility | `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` | Background sync (later) can read it after the first unlock; never restored from a backup onto another device |
| Synchronizable | `false` | Never copied to iCloud Keychain |
| Keychain | Data protection keychain, the app's default access group | The widget extension never needs the token |

The token is redacted from every `description`; `SessionStoreError` carries only an `OSStatus`. The server address and install marker are not secrets and live in `UserDefaults` (`penny.auth.server`, `penny.auth.launched`).

**Expo upgrade.** The legacy app stored its token with `expo-secure-store` under `penny-session` (or `penny-session.<hex of the URL>` for a server other than the original one) and its server in AsyncStorage (`penny:server-connection`). Importing those in place is MAZ-72; until then an upgraded install asks the person to sign in again. The fresh-install purge only touches the native service above, never the Expo items.

## Single sign-on

The app uses `ASWebAuthenticationSession` through SwiftUI's `WebAuthenticationSession` (`SystemWebAuthenticator`), with the `penny` callback scheme:

1. `POST /api/auth/oidc/start` with `redirectUri: "penny://auth/callback"`. The transaction must be 64 lowercase hex characters and the authorization URL HTTPS (HTTP only for a loopback provider); the attempt must not have expired.
2. The system sheet opens the provider. It is an **ephemeral** browser session: no cookies are shared with Safari or kept between attempts. On a shared device this stops the next person from being signed straight in to the previous person's provider account, at the cost of entering provider credentials each time (AutoFill helps). The legacy app shared Safari's cookies.
3. The callback must be `penny://auth/callback` with exactly one `state` and no fragment. It is used **once**: the in-memory attempt is consumed before anything else, the same callback URL is refused if it ever arrives again, and an attempt that expired while the sheet was open is not sent. The server also consumes the attempt before calling the provider, so a replay can never create a second session.
4. `POST /api/auth/oidc/complete` with the transaction and the full callback URL; the response is the same `{token, email}` session as password sign-in.

A `penny://auth/callback` link that arrives through `onOpenURL` (not from the sheet) is ignored: the app never redeems a callback it did not request. Cancelling the sheet (`ASWebAuthenticationSessionError.canceledLogin`) or `error=access_denied` from the provider is reported as cancelled, not as a failure.

### Provider and callback setup

On the server (see [deployment](deployment.md#openid-connect-oidc-sign-in)):

```dotenv
Oidc__RedirectUris=https://penny.example.com/auth/callback,penny://auth/callback
```

- `penny://auth/callback` must be listed **exactly** on the server and registered with the provider as a redirect URI. Otherwise start answers `400 This sign-in redirect is not configured on the server.`, which the app shows.
- The `penny` URL scheme is registered in the app's `Info.plist` (unchanged from the Expo app; `PennyTests` checks it). No associated domain or entitlement is needed.
- The provider must accept a custom-scheme redirect URI for this client. If it does not, single sign-on is unavailable in the app (password sign-in still works) and the server shows its own error on start or complete.

## Server choice

`checkServer` normalizes the address like the legacy app, calls `GET /api/info` (no credential, 10-second timeout, redirects refused) and reads `GET /api/auth/oidc` for the sign-in methods. An answer that is not `{"name":"penny","version":…}` is "This address did not identify itself as a Penny server". Debug builds default to `http://localhost:3001` (or `PENNY_TEST_SERVER_URL` through the test controls); Release has no default and starts at server connect. A plain-HTTP server other than localhost is blocked by App Transport Security, as in the legacy app.

## Failure messages

`AuthFailure` has a `kind` to branch on and a `message` to show as is (the server's message when it sent one).

| Situation | Kind | Message |
| --- | --- | --- |
| Offline | `offline` | You're offline. Connect to the internet and try again. |
| Timeout, DNS, refused, TLS | `unreachable` | Can't reach <host>. Check your connection and try again. |
| Wrong email or password | `invalidCredentials` | Email or password is incorrect. |
| Registration disabled / email taken | `registrationDisabled` / `accountExists` | The server's message |
| `429` | `rateLimited` | Too many attempts. Please try again in N minutes. (from `Retry-After`, else 15) |
| SSO not configured / redirect not listed | `singleSignOnUnavailable` | The server's message |
| SSO attempt expired | `singleSignOnExpired` | Sign-in expired. Please try again. |
| SSO not verified at the server | `singleSignOnRejected` | The server's message |
| Callback refused locally (wrong shape or replay) | `callbackRejected` | This sign-in response was not accepted. Please try again. |
| Keychain refused the session | `storage` | Couldn't keep you signed in on this device. Please try again. |

## Tests and configuration

| Suite | Where | Covers |
| --- | --- | --- |
| `KeychainSessionStoreTests` | PennyDataTests (Mac host and simulator) | Round trip per server, replace, accessibility/synchronizable/data-protection attributes, locked Keychain, other status codes, damaged and foreign items deleted, `deleteAll` scoped to the service, redaction. Uses `FakeKeychain`, which interprets the queries as `SecItem*` does. |
| `AuthControllerTests` | PennyDataTests | Restore without a server, with the Debug default, after a fresh install, verified, offline, expired, locked then unlocked, email changed, and a late launch answer after expiry; password sign-in, wrong password, failure keeping the expiry notice, offline, rate limit, local validation, registration errors, concurrent sign-in, Keychain write failure revoking the session; ignored foreign 401s and account switching; sign-out order, pending changes, sign out anyway, sync then sign out, sync failure, unreachable server and removal, already-revoked session; server checks without credentials, non-Penny and unreachable servers, invalid addresses, servers without SSO, server change clearing the notice, SSO availability. |
| `SingleSignOnTests` | PennyDataTests | Successful redemption (request bodies, no bearer), cancelled sheet, declined at the provider, replayed callback, five malformed callbacks, attempt already expired, expiring while the sheet is open, non-HTTPS provider page, SSO not configured, redirect not listed, malformed transaction, oversized callback. |
| `AuthViewTests` | PennyUIModuleTests | Sign-out warning text, sign-in methods line, host display |
| `RealKeychainSessionStoreTests` | PennyTests (app-hosted, simulator) | The adapter against the signed app's real Keychain: round trip, replace, delete and the stored accessibility attributes |

Run `apps/ios/scripts/ios.sh package-test` for the PennyKit suites on the Mac (seconds) and `apps/ios/scripts/ios.sh test` for everything on clean iPhone and iPad simulators. Tests use `.test` domains and fixture tokens only, never a real provider or credentials.

Not automated yet: simulator journeys against the real API and a local OIDC provider (login, failed login, cancellation, expiry, logout, account switching with VoiceOver and keyboard checks). They need XCUITest, which is MAZ-81, plus the [full-stack test environment](migration/test-environment.md) with a provider that accepts `penny://auth/callback`. Point the Debug app at a test server with `PENNY_TEST_SERVER_URL` in the launch environment (`Penny/TestControls.swift`).
