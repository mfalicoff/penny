# Native sign-in and sessions (MAZ-68)

The SwiftUI app signs in with a password or with single sign-on (OIDC), keeps one session per server in the Keychain, restores it at launch and ends it on expiry or sign-out. The state machine and storage are in `apps/ios/Packages/PennyKit/Sources/PennyData/Auth`; the screens are in `Sources/PennyUI/Auth`. Both build on the [API client](api-client.md). The server side is described in [authentication](../reference/authentication.md).

## What people see

| Screen (specimen) | Behavior |
| --- | --- |
| Server connect (`server-connect`) | Shown first when no server is saved (Release builds have no default). Enter the base URL without `/api`, then **Check server**. HTTP addresses get a warning. |
| Server verified (`server-verified`) | After a successful check: "Server verified", whether the connection is HTTPS, the name, version and sign-in methods (`Email` or `Email · SSO`), and an amber note that switching servers later needs a sync and sign-out. **Use this server** saves it; **Check again** repeats the check. The URL field has a clear (×) button. |
| Sign in (`sign-in`) | The server chip (with **Change**), email and password, **Sign in**, **Continue with SSO** (VoiceOver also hears the server's provider label) when the server offers only its own single sign-on, and **New here? Create an account**. Failures appear under the fields and are announced to VoiceOver; the fields keep what was typed. A wrong password moves focus back to the password field. Under the sample-data link, a **Privacy Policy** link opens the server's policy in the browser (MAZ-169). |
| Create account (`create-account`) | A back button, the **Name** people in households and trips will see (required, 1–60 characters without control characters, the server's rule; MAZ-171), email and a password of 10–256 characters (checked before sending) with a four-bar strength meter and the "At least 10 characters" rule, then **Create account**. The meter is a hint only. The server can refuse new accounts (`403`) or a used email (`409`); its message is shown. Under the button, "By creating an account you agree to the Privacy Policy." links the server's policy (MAZ-169). |
| Sign-in providers (`iphone-sign-in-providers`, `iphone-create-account-providers`, MAZ-170) | One button per provider in `GET /api/auth/oidc` `providers`, in the server's order, and none for an empty list. When Apple or Google is listed, every provider leads, above "or use your email", on sign-in and on create account, with a smaller leaf and no lede on sign-in and a one-line headline on create account. Apple's button is solid black (white in dark mode) and Google's white with its grey outline (dark grey in dark mode), with their own logos and "Sign in with" or "Sign up with"; the server's own single sign-on is the neutral glass capsule with a key, "Continue with SSO" when it is the only one and "Continue with <label>" when there are several. A lone single sign-on keeps the `sign-in` layout and, as before, doesn't show on create account (signing in with it creates the account). |
| Single sign-on (`sign-in-sso`) | The button shows "Waiting for <label>…" while the system sign-in sheet is open. Closing the sheet, or declining at the provider, returns to the sign-in screen with "Single sign-on was cancelled", which is not an error. If the server cannot be checked for single sign-on, a **Retry** link replaces the button. |
| Server info (`server-info`) | Signed in: the server URL, version, connection, account and whether the session has been confirmed. It is read-only: "To change servers, sync your entries and sign out first." |
| Sign out (`sign-out`) | With no unsynced changes: "Sign out of <server>?". With unsynced changes: "N changes haven't synced" with **Sync, then sign out**, **Sign out anyway** and **Cancel**. If the server cannot be reached, nothing changes and an alert offers **Try again** or **Remove from this device**. |
| Forgot password (`iphone-forgot-password`, MAZ-124) | Only while the server sends email (`/api/info` `emailEnabled`, read with the privacy policy and kept with the saved server; absent means off). **Forgot password?** sits on the Password label's line of sign-in and opens a back button, the server chip, "Reset your password.", the email typed on sign-in and **Send reset link** (`POST /api/auth/password-reset/request`). The answer is the same whether or not the address has an account, so the screen says "If <email> has a Penny account on this server, a reset link is on its way. The link works once.", with **Resend in 0:59** counting down a minute. "Have a reset code from your server's administrator? **Enter it**" opens the reset code screen, as does a `404` (the server stopped sending email, which the saved server then forgets). The emailed link is a web URL (`<Email__AppUrl>/reset-password#code=…`): without Associated Domains, a signing change only a human makes, it opens the web app, which takes the new password. |
| Reset code (MAZ-123, MAZ-124) | No iPhone card: it follows `web-password-reset` (Reset code and New password only, as the owner decided) in the sign-in screens' style. The code is 64 hex characters (spaces and capitals are dropped before checking); the new password is 10–256 characters with the "At least 10 characters" rule. **Set password** sends `POST /api/auth/password-reset`; the server signs every device out and issues no session, so sign-in returns with "Your password changed and every device was signed out. Sign in with the new password." A used, replaced or expired code is the server's "This reset code is invalid or has expired." With email off, sign-in has no Forgot password (`iphone-sign-in`), so an operator code is entered on the web's `/reset-password`. |
| Session ended | When the server ends the session (expired after 30 days, revoked by a password reset or sign-out elsewhere), the app returns to sign-in with "Your session for <email> ended" and the email filled in. Changes on the device are kept. |

The redesign cards are `docs/design/penny-ios/iphone/{sign-in,create-account,server-connect,sign-out}.html`. `sign-in-sso`, `server-verified` and `server-info` have no card of their own in this baseline; they are the states of those cards described above (`server-info` follows the Server row of `settings.html`). `docs/design/penny-redesign/screen-inventory.json` (MAZ-122's handoff) does not exist on `v2` yet, so the screens follow `contracts/design-baseline.json` and the cards. After sign-in the MAZ-69 shell takes over; it also adds the demo ("Take a look around with sample data") and the app lock ([native shell](shell.md)).

## State machine

`AuthController` (`@MainActor`, `@Observable`) owns one `AuthState`:

| State | Meaning | Leaves to |
| --- | --- | --- |
| `restoring` | Reading the saved server and session at launch | `signedIn` (unverified), `signedOut`, `keychainUnavailable` |
| `keychainUnavailable` | The Keychain is locked (launch before the first unlock). Nothing is deleted or shown. | `restoring` on **Try again** or when the app becomes active |
| `signedOut(reason)` | `nil`, `.signedOut` or `.sessionExpired(email)` | `signingIn`; a server change resets the reason |
| `signingIn(method)` | Password, registration or single sign-on in flight. The server cannot be changed. | `signedIn`, or back to `signedOut` with the same reason on failure or cancellation |
| `signedIn(account)` | `SignedInAccount`: scope (server + lowercased email), a `generation`, and `isVerified` | `signingOut`; `signedOut(.sessionExpired)` on its own 401 |
| `signingOut(account)` | Revoking the session. Entering it bumps the generation, so nothing started for the signed-in account applies any more. | `signedOut(.signedOut)`, or back to `signedIn` (a new generation) when the server is unreachable |

Rules the tests hold:

- **One session per server, one signed-in account.** A new sign-in replaces the server's stored session. Everything signed-in work uses comes from `AuthController.client`, which carries the current account's token to its own server only.
- **Stale answers are dropped.** Every sign-in, restore, expiry, sign-out and server change bumps a generation, and every await is followed by a check that the generation and state are still the ones the work started with. An answer for an earlier generation (a slow launch check after the session ended or while signing out) changes nothing. While `signingIn` or `signingOut`, nothing else can start: no second sign-in or sign-out, no server change, no expiry.
- **Only the current session's 401 ends it.** Call `sessionDidExpire(for: account)` with the `SignedInAccount` whose client got the 401. It is ignored unless that account is the current session: a late 401 from an earlier session, even of the same account and server, or one that arrives while signing out, changes nothing.
- **Only the features that hold a client call `sessionDidExpire`.** The launch check, "Sync, then sign out" and the offline ledger sync (`LedgerSyncModel`, MAZ-71, [offline sync](offline-sync.md)) call it for the account their request was made for; there is no 401 hook in `APIClient`'s request path. Other features (shared, receipts, search screens) must route their own 401s to it.
- **Account switching never shows another person's data.** Data is partitioned by `AccountScope`. After an expiry, signing in as someone else gives a new scope and generation; the earlier account's local entries are neither shown, synced nor removed for them. `SearchCoordinator.reset(client:)` and every cache must key on the scope.
- **The server is read-only while signed in.** `useServer` works only while signed out; a candidate server is checked with an anonymous client, so it never receives a token.

## Session restore and recovery

1. **First launch after install.** Keychain items survive app deletion, so a fresh install deletes every Penny session item before reading (`AuthPreferences.hasLaunchedBefore`). A reinstalled app starts signed out instead of silently restoring an old account. The launch is marked done only when the deletion succeeds. If it fails (other than a locked Keychain), nothing is restored, the app starts signed out, and the purge runs again before the next session is saved and at the next launch; if it keeps failing until then, that later purge also removes the new session and the person signs in once more.
2. **Saved session.** The app signs in immediately, unverified, so local data is available offline, then calls `GET /api/auth/me`:
   - `200` with the same email: verified.
   - `200` with another email (the account's email changed on the server; the token is the same account): the token is the authority. `AccountLocalData.moveLocalData(from:to:)` first re-keys the old scope's entries and pending changes to the new email's scope, then the app switches to that scope and stores it, so unsynced work is neither orphaned nor left behind. If the move fails, nothing changes: the app stays on the stored scope, unverified, and tries again at the next launch. Sign-out waits for a move in progress.
   - `401`: the token is deleted and the state becomes `signedOut(.sessionExpired(email))`, unless the session is no longer current (see the rules above). Local work is kept.
   - Network or server failure: stays signed in, unverified. Nothing ends the session until something calls `sessionDidExpire` (see the rules above) or the next launch's check answers 401.
3. **Keychain locked** (`errSecInteractionNotAllowed`): `keychainUnavailable` until unlock. The session is not deleted and sign-in is not offered, so nobody signs in twice by accident.
4. **Damaged item** (unreadable JSON, wrong server, malformed token): deleted and treated as signed out.
5. **Keychain write failure at sign-in:** the new session is revoked on the server and the person sees "Couldn't keep you signed in on this device", so no valid token is left unsaved.

## Sign-out

`signOut(discardingUpTo:removeEvenIfUnreachable:)`, in this order:

1. `AccountLocalData.beginRemoval(for:)` stops the account's local data taking saves and returns the pending count in the same step, so a save made during sign-out is refused (the draft stays) rather than acknowledged and then removed. Refuse with `pendingChanges(count)` while that count is above `discardingUpTo`: 0 by default, and for **Sign out anyway** the count the person was shown, so changes saved after the warning bring it back with the new count. Whenever sign-out stops before removal (refused, unreachable, account changed, removal failed), `cancelRemoval(for:)` lets saves resume. **Sync, then sign out** (`syncThenSignOut`) syncs first and stops with `syncFailed` (nothing removed) when it cannot.
2. Enter `signingOut` (a new generation), then `DeviceRegistration.unregister(using:)` while the session still works, so the push `DELETE` is authenticated (`APNsDeviceRegistration`, MAZ-79: it removes this account's APNs token and never throws, [native notifications](notifications.md#registration-lifecycle)).
3. `POST /api/auth/logout`. A `401` means it already ended. Any other failure returns to `signedIn` with `serverUnreachable`; **Remove from this device** (`removeEvenIfUnreachable: true`) continues, and the server session then stays valid until it expires (at most 30 days). A retry from that alert passes the same agreed count, so step 1 discards only as many changes as the person agreed to lose; newer changes bring the warning back.
4. Delete the Keychain item, move to `signedOut(.signedOut)`, then `AccountLocalData.removeLocalData(for:)`. If removal fails, the person is signed out anyway (the session is gone), `AuthController.unremovedLocalData` names the account, and the sign-in screen says "You're signed out, but entries for <email> couldn't be removed from this device" with **Remove them now** (`removeUnremovedLocalData()`). The data stays under its own scope, so nobody else sees it; signing in again as that account makes it theirs again. The notice is kept in memory only; after a relaunch, `OfflineLedgerStore.storedScopes()` lists accounts that still have entries on the device, so the UI can offer the removal again (not wired to a screen yet).

By default, sign-out does not go ahead while the server is unreachable; **Remove from this device** is the explicit way out. The app passes `OfflineLedgerStore` (MAZ-71) as `AccountLocalData`: pending changes are the difference between the stored base and local ledgers, a copy that cannot be read counts as one pending change, and "Sync, then sign out" fails unless the server acknowledged everything ([offline sync](offline-sync.md#sign-out-and-cache-clearing)). The app passes `APNsDeviceRegistration` (MAZ-79); `NoDeviceRegistration` remains for tests and previews.

## Delete account (MAZ-152)

Settings › Profile › Delete account (card `iphone-delete-account`) calls `deleteAccount(password:)`: the password of a password account, nil for one that signs in with a provider (the request body is then `{}` and the session confirms).

1. An empty password is refused before any request ("Enter your password to delete your account.").
2. `AccountLocalData.beginRemoval(for:)` holds saves while the server decides; the state stays `signedIn`.
3. `POST /api/account/delete`. A `400` (wrong password), `409` (a household rule blocks leaving: a monthly balance to settle, or a creator whose household still has other members) or any failure throws `AccountDeletionFailure` with the server's own words; `cancelRemoval(for:)` lets saves resume and nothing changes. A `401` ends the session as on expiry, keeping local data.
4. On `200` the server has deleted the account and ended every session. The app enters `signingOut`, `DeviceRegistration.unregister` forgets the stored push registration (the server already removed the device; the request answers `401`), deletes the Keychain item, moves to `signedOut(.accountDeleted)` and removes the account's local ledger, offline queue and drafts. The signed-out state clears the widgets' App Group snapshot (`WidgetPublisher`), and the session change purges receipt previews and any export file (`AuthGate`). A removal failure is offered again as after sign-out. Sign-in then says "Your account was deleted, and every device was signed out."

Unsynced changes are not counted or synced first: deletion removes the account's data on the server too. The page lists what is deleted, the household and trip names whose shared expenses stay for the other members (`GET /api/households`, households then trips), and that backups keep deleted data for up to 30 days. Other members then see the person as "Former member" (`HouseholdMember.deleted`), never the placeholder email, with "?" in place of initials and no picture.

**Export all your data** (card `iphone-export-all`, `AccountExportModel`) downloads `GET /api/export` when the page opens, writes the ZIP to `tmp/PennyExport` with complete file protection under the name from `Content-Disposition` (`penny-export-YYYY-MM-DD.zip`), shows "name · size · ready" and **Save or share** (the share sheet). The file is removed when the page closes, and any left by a crash at the next session change.

## Keychain storage

`KeychainSessionStore` writes one generic-password item per server:

| Attribute | Value | Why |
| --- | --- | --- |
| Service | `com.mfalicoff.penny.session` | Its own service, so the fresh-install purge touches nothing else |
| Account | The normalized server URL (`ServerURL`) | One session per server; a token is never read for another server |
| Value | JSON `{"version":1,"server":…,"email":…,"token":…}` | The server is checked again on read |
| Accessibility | `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` | Background sync (later) can read it after the first unlock; never restored from a backup onto another device |
| Synchronizable | `false` | Never copied to iCloud Keychain |
| Keychain | Data protection keychain, the app's default access group | The widget extension never needs the token |

The token is redacted from every `description`; `SessionStoreError` carries only an `OSStatus`. The server address and install marker are not secrets and live in `UserDefaults` (`penny.auth.server`, `penny.auth.launched`).
## Single sign-on

Every provider the server lists signs in the same way (MAZ-170): the button's provider `id` goes on start, so several providers can be enabled together. A server from before MAZ-170 sends no `providers` list; its one provider (when `enabled`) shows as `sso` and starts without an id. Apple's response comes back through the server's callback relay to the same `penny://auth/callback`, and `error=user_cancelled_authorize` from it counts as cancelled.

The app uses `ASWebAuthenticationSession` through SwiftUI's `WebAuthenticationSession` (`SystemWebAuthenticator`), with the `penny` callback scheme:

1. `POST /api/auth/oidc/start` with `redirectUri: "penny://auth/callback"`. The transaction must be 64 lowercase hex characters and the authorization URL HTTPS (HTTP only for a loopback provider). `expiresAt` is on the server's clock, so the app never compares it with the device clock: the attempt's lifetime is `expiresAt` minus the response's `Date` header (both server time), and the local deadline is the device time of the request plus that lifetime. A device clock that is off by any amount therefore neither breaks single sign-on nor keeps an expired attempt alive. Without a `Date` header the app does not judge expiry and the server's check on complete decides.
2. The system sheet opens the provider. It is an **ephemeral** browser session: no cookies are shared with Safari or kept between attempts. On a shared device this stops the next person from being signed straight in to the previous person's provider account, at the cost of entering provider credentials each time (AutoFill helps).
3. The callback must be `penny://auth/callback` with exactly one `state` and no fragment. The in-memory attempt is consumed before anything else, so one attempt redeems at most one callback, and an attempt whose deadline passed while the sheet was open is not sent. The app also refuses a callback URL it has already sent, but that check is only a convenience: it remembers the last 32 URLs, in memory, in one process (a relaunch forgets them). The real guard is the server, which consumes the attempt before calling the provider, so a replayed callback can never create a second session.
4. `POST /api/auth/oidc/complete` with the transaction and the full callback URL; the response is the same `{token, email}` session as password sign-in.

A `penny://auth/callback` link that arrives through `onOpenURL` (not from the sheet) is ignored: the app never redeems a callback it did not request. Cancelling the sheet (`ASWebAuthenticationSessionError.canceledLogin`) or `error=access_denied` from the provider is reported as cancelled, not as a failure.

### Native Sign in with Apple

For a provider whose `native` is true (Apple with `NativeClientIds` on the server), `AuthController.signInNatively` runs `POST /api/auth/oidc/native/start {provider}`, asks Apple's sheet (`AppleSignInAuthenticator`, `ASAuthorizationAppleIDProvider`) for an ID token with the returned nonce, and redeems it once with `POST /api/auth/oidc/native/complete {transaction, idToken, givenName?, familyName?}`. Apple sends the name only the first time someone signs in to the app; a blank part, or one over 200 characters, is left out. The attempt's lifetime is measured as for the browser sheet, and closing Apple's sheet is reported as cancelled.

The sheet needs the Sign in with Apple capability on the App ID and the `com.apple.developer.applesignin` entitlement, which the app doesn't have yet: adding them is a signing change only a human makes ([ipa.md](ipa.md)). Until then `PENNY_SIGN_IN_WITH_APPLE` in `Configuration/Penny.xcconfig` is `NO` (read through the `PennySignInWithApple` Info.plist key), and Apple signs in through the browser sheet like every other provider. Turning it on is: the capability and regenerated profiles, the entitlement in `Configuration/Penny.entitlements`, and `PENNY_SIGN_IN_WITH_APPLE = YES`.

### Provider and callback setup

On the server (see [deployment](../self-hosting/deployment.md#openid-connect-oidc-sign-in)):

```dotenv
Oidc__RedirectUris=https://penny.example.com/auth/callback,penny://auth/callback
```

- `penny://auth/callback` must be listed **exactly** on the server and registered with the provider as a redirect URI. Otherwise start answers `400 This sign-in redirect is not configured on the server.`, which the app shows.
- The `penny` URL scheme is registered in the app's `Info.plist` (frozen for TestFlight/App Store continuity; `PennyTests` checks it). No associated domain or entitlement is needed.
- The provider must accept a custom-scheme redirect URI for this client. If it does not, single sign-on is unavailable in the app (password sign-in still works) and the server shows its own error on start or complete.

## Server choice

`checkServer` normalizes the address (`ServerURL`), calls `GET /api/info` (no credential, 10-second timeout, redirects refused) and reads `GET /api/auth/oidc` for the sign-in methods. An answer that is not `{"name":"penny","version":…}` is "This address did not identify itself as a Penny server". Debug builds default to `http://localhost:5001`, the backend's development stack (or `PENNY_TEST_SERVER_URL` through the test controls); Release has no default and starts at server connect. The app's `Info.plist` sets no `NSAppTransportSecurity` keys, so the default App Transport Security rules apply (the deployment target is iOS 26). According to Apple's [`NSAllowsLocalNetworking`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking) documentation: plain HTTP to a fully qualified host (`http://penny.example.com`) is blocked, and the check reports it as "Cannot reach this server"; unqualified names such as `localhost` and `.local` hosts are allowed, which is how the Debug default works; and since iOS 17, plain HTTP to an IP address (including `127.0.0.1` and LAN addresses) is blocked unless listed as an exception, which the app does not do. The server-connect screen warns about any HTTP address it can reach. This has not been checked on a device against each kind of address.

## Profile and privacy policy (MAZ-171, MAZ-169)

- **Privacy policy.** `GET /api/info` may carry `privacyPolicyUrl` (the server's `Legal__PrivacyPolicyUrl`). `PrivacyPolicy.url` keeps only an absolute `http`/`https` URL with a host and no credentials, as the web does; a missing field (older servers), `null` or anything else shows no link. The URL is kept with the saved server (`SavedServer.privacyPolicy`), refreshed by `AuthController.refreshServerInfo()` each time sign-in or create account appears, and linked from sign-in, create account and the footer of Settings › Profile ("Your account lives on <host>. Privacy Policy"). Links open in the browser. The demo has no server and no link.
- **Profile.** The Settings account row opens Settings › Profile (`ProfileView`; cards `iphone-profile`, `iphone-profile-provider`, `ipad-profile`): the picture with Change picture (the system photo picker, then "Move and scale", which uploads a square JPEG) and Remove, the name (saved with the copper check on iPhone, Save name on iPad), the Sign-in group with Change password for a password account, and the footer. Fields a sign-in provider manages are read only with a lock and say so. The Server row now opens the server's details.
- **Change password** sends `POST /api/auth/password`. This device stays signed in and the server signs the others out. A wrong current password clears and refocuses that field.
- **Name prompt.** When `/api/auth/me` says `needsName`, Home shows "What should people call you?" once (`NamePromptSheet`). Not now tells the server to stop asking. Older servers send no `needsName`, so nothing is asked. The summary is read again when the app returns to the foreground.
- **Names and pictures.** Shared screens show a member's display name, else their email, and their picture, else initials from the name or email (`HouseholdPeople.name`, `face`). Pictures (`/api/users/<id>/avatar?v=<n>`) load with the session from the same server only (`APIClient.avatar` refuses any other path) and are kept by URL for the session (`AvatarStore`); a 404 shows initials.

## Email verification (MAZ-172)

Verification only records that a password account's address is proven ([server side](../reference/authentication.md#email-verification-maz-172)); nothing in the app waits for it. Everything below shows only while the server sends email (`emailEnabled` on `/api/info`, kept with the saved server); without email the app shows no unverified state.

- **Check your email** (`CheckEmailView`, card `iphone-verify-email`). After a password sign-up the gate shows it instead of the shell (`AuthController.showsCheckEmail`): the address, "Use Penny right away" and "Verify your address", Continue to Penny, Resend (counting the server's minute down from the sign-up) and Change email. It belongs to that sign-up only: any later session clears it.
- **Resend** sends `POST /api/auth/email-verification/resend` (`AuthController.resendVerificationEmail`). The server answers 202 either way; a 404 means it stopped sending email, so the saved server forgets `emailEnabled`.
- **Change email** (`ChangeEmailSheet`, from Check your email and the Shared tab's reminder) sends `POST /api/auth/email` with the new address and the password. The account's local data is scoped by email, so the account then moves to the new address the way a launch-time email change does (`adoptChangedEmail`: local data first, then the stored session); if the data can't move, the next launch tries again. A taken or invalid address shows under Email, a wrong password clears Password. The sheet has no card of its own: it follows the web's Change your email in the sign-in screens' style.
- **The emailed link** is a web URL (`<AppUrl>/verify-email#code=…`). The app doesn't open web links, so the web page verifies it. The profile (`GET /api/profile`, `emailVerified`) is read again when the app returns to the foreground while the account is unverified, and when the Shared tab opens or refreshes. `APIClient.verifyEmail(token:)` is there for a future in-app link.
- **Shared tab** (card `iphone-unverified`): an unverified password account sees "Verify your email" with Resend link and Change email above its households. New household, Join and the toolbar + stay available. With no households yet, the tab shows the card's empty state (New household, Join).
- **Settings › Profile** (`iphone-profile`, `ipad-profile`): the Sign-in row shows Verified for a verified account (password or provider), or Not verified with a Resend link row for an unverified password account. Servers from before verification send no `emailVerified`; the app reads them as verified.

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
| Reset code malformed, used or expired (MAZ-124) | `invalidCode` | A reset code is 64 letters and numbers… / the server's message |
| Keychain refused the session | `storage` | Couldn't keep you signed in on this device. Please try again. |

## Tests and configuration

| Suite | Where | Covers |
| --- | --- | --- |
| `KeychainSessionStoreTests` | PennyDataTests (Mac host and simulator) | Round trip per server, replace, accessibility/synchronizable/data-protection attributes, locked Keychain, other status codes, damaged and foreign items deleted, `deleteAll` scoped to the service, redaction, an existing item moved to the current accessibility, items outside the data protection keychain left alone. Uses `FakeKeychain`, which models what the store relies on (`kSecClass`, `kSecAttrSynchronizable`, `kSecUseDataProtectionKeychain`, `kSecMatchLimit`, the primary key and duplicate adds) but not access groups or access control; `RealKeychainSessionStoreTests` covers the real Keychain. |
| `AuthControllerTests` | PennyDataTests | Restore without a server, with the Debug default, after a fresh install, a failed fresh-install purge (nothing restored, retried before the next save and at the next launch), verified, offline, expired, locked then unlocked, email changed (local data moved; staying put when it cannot move), and a late launch answer after expiry; password sign-in, wrong password, failure keeping the expiry notice, offline, rate limit, local validation, registration errors, concurrent sign-in, Keychain write failure revoking the session; late 401s from an earlier session (of another account or the same one, at launch and during "Sync, then sign out") and account switching; sign-out order (one shared log of requests, unregistration and removal), a launch check answering 200 or 401 while signing out (no overwrite, no second sign-out, no other sign-in), local data that cannot be removed, pending changes, sign out anyway, sync then sign out, sync failure, unreachable server and removal, already-revoked session; server checks without credentials, non-Penny and unreachable servers, invalid addresses, servers without SSO, server change clearing the notice, SSO availability; Delete account (MAZ-152): order and request body, a provider account's empty body, a refused 400, 409 or 500 keeping the session and local data, an empty password, offline, an ended session, and local data that cannot be removed afterwards. |
| `SignInProvidersTests` | PennyDataTests | MAZ-170: several providers in order, none, a server from before MAZ-170, invalid or repeated entries left out, a checked server's providers; browser sign-in started with the chosen provider's id (and without one for an old server), Apple's cancel; native sign-in redeeming the token with the name once, without a name, cancelled, failed, refused by the server, expired while the sheet was open, a provider that isn't native, a malformed nonce, an oversized token; the profile's `providerId` and `providerIcon`. |
| `SingleSignOnTests` | PennyDataTests | Successful redemption (request bodies, no bearer), cancelled sheet, declined at the provider, replayed callback, five malformed callbacks, attempt already expired, expiring while the sheet is open, device clock an hour fast or slow, no `Date` header, the `Date` header parsed by the client, non-HTTPS provider page, SSO not configured, redirect not listed, malformed transaction, oversized callback. |
| `AuthViewTests` | PennyUIModuleTests | Sign-out warning text, retry discarding only consented changes, server chip label, leftover-data notice, sign-in methods line, host display |
| `RealKeychainSessionStoreTests` | PennyTests (app-hosted, simulator) | The adapter against the signed app's real Keychain: round trip, replace, delete and the stored accessibility attributes |

Run `apps/ios/scripts/ios.sh package-test` for the PennyKit suites on the Mac (seconds) and `apps/ios/scripts/ios.sh test` for everything on clean iPhone and iPad simulators. Tests use `.test` domains and fixture tokens only, never a real provider or credentials.

Not automated yet: simulator journeys against the real API and a local OIDC provider (login, failed login, cancellation, expiry, logout, account switching with VoiceOver and keyboard checks). They need XCUITest, which is MAZ-81, plus the [full-stack test environment](../reference/test-environment.md) with a provider that accepts `penny://auth/callback`. Point the Debug app at a test server with `PENNY_TEST_SERVER_URL` in the launch environment (`Penny/TestControls.swift`).
