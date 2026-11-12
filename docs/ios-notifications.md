# Native household notifications (MAZ-79)

The native iOS app registers for Apple Push Notification service (APNs) and opens household notifications on the right household month or shared expense. The server side, which stores device registrations and delivers through APNs, is MAZ-61 ([push delivery](migration/push.md)).

| Area | Code |
| --- | --- |
| Payload rules, the APNs token and environment | `PennyDomain/Notifications/HouseholdNotification.swift` (`HouseholdNotification`, `PushDeviceToken`, `PushEnvironment`), `DeepLink.householdMonth` |
| Registration | `PennyData/API/APIClient+Push.swift`, `PennyData/Notifications/PushRegistration.swift` (`PushRegistrar`, `APNsDeviceRegistration`, `PushRegistrationStore`, `PushOwner`) |
| App glue | `PennyUI/Notifications/PushNotifications.swift` (`PushNotifications`, `PennyAppDelegate`), `ShellModel+Notifications.swift`, `NotificationViews.swift` (Settings row, Shared tab prompt); `Penny/PennyApp.swift` (`@UIApplicationDelegateAdaptor`) |
| Entitlement | `apps/ios/Configuration/Penny.entitlements` (`aps-environment`) |
| Tests | `PennyDomainTests/HouseholdNotificationTests`, `PennyDataTests/PushRegistrationTests`, `PennyUIModuleTests/NotificationTests`, `PennyTests` (`BuiltAppTests`, `TestControlsTests`), `PennyUITests/Notifications/NotificationJourneyTests` (Full plan) |

UIKit and UserNotifications stay in PennyUI and the app target. PennyDomain and PennyData only see tokens, permissions and payloads as values, so the registration lifecycle runs in host tests.

## Apple Developer setup

The app's entitlements now include `aps-environment`. Simulator builds sign ad hoc and need nothing. **Before the next device build, archive or TestFlight upload**, the App ID needs the capability. Without it, signing fails or the profile lacks the entitlement:

1. In [Apple Developer → Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list), open the App ID `com.mfalicoff.penny` and check that **Push Notifications** is enabled. The legacy app's `expo-notifications` plugin adds the same entitlement, so it may already be on. If not, enable it and save. Leave the certificate options alone: the server uses a token-based `.p8` key, not a push certificate.
2. Regenerate the app's provisioning profiles: development profiles for Xcode device builds and the App Store profile for archives. With automatic signing (`Configuration/Signing.local.xcconfig` with `DEVELOPMENT_TEAM`), Xcode does this on the next build if your account may manage the team's profiles. Otherwise, regenerate them in the portal and download them in Xcode (**Settings → Accounts → Download Manual Profiles**). The widget extension `com.mfalicoff.penny.ExpoWidgetsTarget` does not need the capability.
3. For the backend, create the APNs auth key and configure `Push__Apns__*` as described in [Apple credentials](migration/push.md#apple-credentials). One key serves both gateways.
4. The legacy EAS build is unchanged. If the capability was off and you enable it, regenerate the EAS App Store profile too (`EXPO_NO_CAPABILITY_SYNC=1 npx eas-cli@latest credentials --platform ios`, as in [Widget App Groups setup](ios-ipa.md#widget-app-groups-setup)).

The bundle id, App Group and URL scheme are unchanged.

### Which gateway a build uses

The entitlements file says `development`. Xcode signs development builds with it, and exporting for TestFlight or the App Store rewrites it to `production`. At run time the app reads the gateway it actually got (`PushEnvironment.current()`) and sends it as `environment` with the token:

| Build | Embedded profile | `environment` |
| --- | --- | --- |
| Simulator | none | `sandbox` |
| Xcode build on a device (development profile) | `aps-environment = development` | `sandbox` |
| Ad hoc | `aps-environment = production` | `production` |
| TestFlight, App Store | none (Apple strips it) | `production` |

A token sent with the wrong environment fails at Apple with `BadDeviceToken`. The server then removes the device, and the app registers again at its next launch.

## Permission

- Penny never asks at launch. It asks **in context**: a card on the Shared tab once the person is in at least one household ("Hear about household changes", **Turn on** / **Not now**), and the **Notifications** row in Settings. The row is shown for accounts only, never in the demo.
- **Turn on** shows the system prompt once. **Not now** hides the card on this device (`penny.push.promptDismissed`). Settings still offers it.
- The Settings row's value says **Off**, **On**, **Off in Settings** (denied), **Unavailable** (APNs gave no token) or **Not connected** (the server refused or could not be reached). After the first answer it opens Penny's page in iOS Settings, where notifications are turned on or off. The footer explains what Penny notifies about and that notifications never show names or amounts.
- Penny re-reads the permission every time it becomes active, so a change in iOS Settings applies on return. Provisional and ephemeral authorization count as allowed.

## Registration lifecycle

`PushRegistrar` registers a token only while an account is signed in, notifications are allowed and APNs has handed over a token. The app asks APNs for the token at every launch and activation while allowed.

| Event | What happens |
| --- | --- |
| Allowed, token received, account signed in | `POST /api/push/devices {token, platform: "ios", provider: "apns", environment}`. Sent once per process, token and account. The stored registration (`penny.push.registration`: token, environment and a SHA-256 of server and email, never the email itself) records who it belongs to |
| Same token again (each launch or activation) | Nothing is sent in the same process. A new launch registers again, which also recovers a device the server removed after `BadDeviceToken` |
| Token refreshed by APNs | The new token is registered, then the old one is removed |
| Account change (sign out, then another account) | The new account registers the same token. The server moves it to the new session, so the previous account's pending messages finish first and never reach the new account. Delivered notifications are cleared from Notification Center |
| Sign-out | `AuthController` calls `APNsDeviceRegistration.unregister` while the session still works: `DELETE /api/push/devices {token}` for this account's token, then the stored registration is forgotten. Offline, server logout or session expiry removes the device anyway, so sign-out never waits on it |
| Session expired | No request is possible. The server never sends to an expired session. The stored owner stays until another account registers, so a leftover notification cannot open in the next account |
| Turned off in iOS Settings | The registration is removed with `DELETE`. Turning it back on registers again |
| APNs fails (no network at first launch, simulator without push, a build without the entitlement) | Status **Unavailable**. Everything else works, and Penny tries again at the next launch |
| Server refuses or is unreachable | Status **Not connected**. Penny retries when it becomes active. A Node server refuses APNs bodies with `400`; only the .NET backend accepts them |
| An answer arrives after the account changed | Dropped. It never claims the registration for the earlier account |

The demo never registers and never opens a notification.

## Payloads and navigation

The server sends the legacy deep-link object as top-level custom keys next to `aps` ([payloads](migration/push.md#events-recipients-and-payloads)):

```json
{ "aps": { "alert": { "title": "New household expense", "body": "A member added an expense. Open Penny to see your share." }, "thread-id": "household-<id>" },
  "householdId": "<id>", "month": "2026-09", "expenseId": "<id>", "eventId": "<id>" }
```

`HouseholdNotification(userInfo:)` applies the legacy client's allowlist (`src/data/push.ts`): `householdId` and an optional `expenseId` must match `[A-Za-z0-9_-]{1,100}`, and `month` must be `YYYY-MM` within the ledger range. Anything else (a missing or mistyped key, a URL, path segments, `null`) makes the whole payload invalid, and the notification then just opens the app where it was. `eventId` and unknown keys are ignored. The legacy in-app route `penny:///households/<id>?month=YYYY-MM&expenseId=<id>` parses to the same destination (`DeepLink.householdMonth`); without a valid month it opens the household as before.

| Payload | Opens | Back |
| --- | --- | --- |
| `householdId`, `month` | **Shared** tab → the household on that month | the Shared list |
| `householdId`, `month`, `expenseId` | **Shared** tab → the household on that month → the expense | the household (on that month), then the Shared list |

- The destination is shown from the Shared tab's root, and any open sheet or Settings closes first (`ShellRoute.open`), as for every deep link. On iPad, the sidebar selects Shared and the detail column shows the page.
- The household page keeps the notification's month instead of following the calendar (`HouseholdModel.open(month:current:)`), until the calendar moves to a later month. If that page is already open, it reads the household again.
- Shared trips are households, so their notifications also open from Shared, where v2 lists them. The Trips tab lists personal trips only.
- A household or expense the account cannot see (left, removed, archived or never joined) opens the page's named state ("Household not available", "Expense not found"). The server refuses the read, so no data is shown.

## Privacy and gates

- **Auth and app lock.** An opened notification goes through the same `DeepLinkInbox` as `penny://` links. It waits while signed out, restoring the session or locked, and opens once the account's shell is shown and the lock is open. Nothing is shown behind the lock screen.
- **Another account.** A notification opens only in the account the stored registration belongs to. A tap that arrives while nobody is signed in waits for the next account, then is dropped if the device's registration belongs to someone else. Leaving or changing the account clears Penny's delivered notifications and badge.
- **Foreground.** A notification that arrives while Penny is open shows a banner only for a valid payload while its account is signed in. Otherwise it is suppressed.
- **Lock screen.** Titles and bodies never name people, amounts or titles (server rule, MAZ-61), so lock screens and notification previews reveal nothing financial. The app lock does not cover iOS notification previews; the [App lock](ios-shell.md#app-lock) setting says so.
- No token, payload or email is logged. The token's `description` is redacted.

## Tests and verification

Automated (part of `ios.sh ci` unless noted):

- `HouseholdNotificationTests` (host): valid payloads, 19 malformed ones, the legacy query route, Shared routing and Back paths, the inbox gate (signed out, demo, locked, another account), token limits and redaction.
- `PushRegistrationTests` (host): the request bodies against `contracts/openapi.json`, registering once, token refresh, account change, denial, server failure and retry, APNs unavailable, a stale answer after an account change, sign-out `DELETE` for this account only (also offline), the owner digest, a damaged stored value and reading `aps-environment` from a provisioning profile.
- `NotificationTests` (PennyUI, host and simulators): cold start before sign-in, warm start, malformed payloads, notifications for another account (held, then dropped), foreground presentation, the contextual prompt (never at launch, one system prompt, Not now), declined permission, APNs unavailable, and the shell opening the household on the notification's month.
- `BuiltAppTests` checks the entitlements and `TestControlsTests` the injection controls.
- **Simulator payload injection** (`NotificationJourneyTests`, Full UI plan, `ios.sh ui-test full`, needs the full-stack environment): Debug-only test controls hand a payload to `PushNotifications.didOpen`, the same call the app delegate makes, at launch (`PENNY_TEST_NOTIFICATION`) or on the first return from the background (`PENNY_TEST_NOTIFICATION_ON_RESUME`). The journeys cover a cold start signed out (the expense opens only after sign-in; Back shows the household on its month, then Shared), a cold start signed in (relaunch), a warm start for the previous month (the household opens on September, not the current month), another account's household (named error state, no data), and a malformed payload (Home). Release builds contain none of it (`ios.sh release-check`).

Manual, on a simulator: `apps/ios/scripts/ios.sh push <file.apns> [device]` sends a payload through `xcrun simctl push` (default: the booted simulator). Use `apps/ios/scripts/notifications/household-expense.apns`, with your household and expense ids, or `malformed.apns`. Allow notifications in Penny first. This exercises presentation and the tap on the real UserNotifications path, but not APNs.

### Physical device (required before release)

Injection and `simctl push` do not prove transport: they skip Apple's gateway, the provider token, the topic and the environment. Before each release, on a physical iPhone with a development build (sandbox) and with a TestFlight build (production):

1. Complete the [Apple Developer setup](#apple-developer-setup), install, sign in and turn notifications on from the Shared tab. Confirm a `push_devices` row with `provider = 'apns'` and the expected environment.
2. Run the [physical-device smoke test](migration/push.md#physical-device-smoke-test) (`push-smoke-apns`): the banner shows on the locked and unlocked device.
3. End to end: a second account adds a shared expense in the same household. Tap the notification from the lock screen with Face ID lock on: Penny asks to unlock first, then opens the expense on its month. Repeat with Penny running in the background, and with Penny force-quit (cold start).
4. Sign out, add another expense from the second account: no notification. Sign in as a different account: the earlier notifications are gone from Notification Center.
5. Turn notifications off in iOS Settings, return to Penny (the registration is removed), and turn them back on.

Record the date, build, environment and results with the release ([verification](migration/verification.md)).

## Limitations

- Delivery is at least once (MAZ-61). A repeated delivery replaces the earlier banner (`apns-collapse-id`).
- Notifications are household events only. Personal ledger changes never notify (legacy).
- There are no notification actions, Notification Service Extension, rich content or badges beyond clearing them. The app does not refresh household data on a foreground notification until it is opened.
- A device that ran the Expo app and the native app can briefly receive both Expo and APNs notifications until the Expo session ends ([token migration](migration/push.md#token-and-provider-migration)).
