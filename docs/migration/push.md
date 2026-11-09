# Push notifications: APNs delivery and the notification outbox (MAZ-61)

The .NET backend serves the legacy push device operations (`server/http/push.ts`, `server/application/push.ts`) and replaces the legacy in-process 15-second delivery timer with a PostgreSQL-leased delivery worker. It delivers to **native APNs device tokens** (new) and to **legacy Expo push tokens** (unchanged) side by side, so existing installs keep receiving notifications while the native iOS app (MAZ-79) moves to APNs. Node still serves production, so `contracts/openapi.json` keeps `x-implementation: legacy` for these operations; contract 1.5.0 adds the optional APNs fields.

Code: `Application/Push` (`PushDeviceService` validation, `PushDeliveryRunner` claim/prepare/send/record, `PushPayload`, `PushContent`, outcomes), `Persistence/Repositories/PostgresPushRepository` (devices, leases, outcomes), `Api/Push` (`ApnsTransport`, `ApnsProviderToken`, `ApnsCredentials`, `ExpoTransport`, `PushDeliveryWorker`), `Api/Controllers/PushDevicesController`, `Api/Commands/PushSmokeCommand`, `Api/Testing/FaultInjectingPushTransport`. Schema: migration `AddApnsPushDelivery`. Tests: `UnitTests/Push` (APNs request shape, status/reason classification, provider-token signing and refresh, Expo tickets and receipts, payload allowlist, backoff) and the real-PostgreSQL `IntegrationTests/Controllers/PushDeviceTests` (HTTP), `PushDeliveryTests` (recipients, routing, retries, cleanup, expiry, receipts), `PushConcurrencyTests` (competing workers, crash and lease takeover, lost lease after send, cancellation) and `Migrations/ImportedPushTests` (imported Expo tokens next to new APNs devices). Every test uses deterministic fake providers; none calls Apple or Expo.

## Device registration

Both operations require a session (cookie or bearer). Errors use `{error: string}`; every invalid body is `400 Invalid push device.` (legacy message).

| Operation | Route | Body | Success |
| --- | --- | --- | --- |
| `postApiPushDevices` | `POST /api/push/devices` | Legacy: `{token, platform}`. Native: `{token, platform: "ios", provider: "apns", environment}` | `201 {ok:true}` |
| `deleteApiPushDevices` | `DELETE /api/push/devices` | `{token}` | `200 {ok:true}` |

| `provider` | `token` | `platform` | `environment` |
| --- | --- | --- | --- |
| absent or `"expo"` (legacy) | `ExponentPushToken[…]` / `ExpoPushToken[…]` (legacy pattern) | `ios` or `android` | must be absent or `null` |
| `"apns"` | hex, an even number of 64–200 digits (Apple documents tokens as variable length; today 32 bytes). Stored lower-case | `ios` only | `"sandbox"` (development builds, Xcode) or `"production"` (TestFlight, App Store) |

- A registration belongs to the **session** that made it (`push_devices.session_hash`). Registering a token again moves it to the presenting session and user; pending deliveries of the previous user's messages to that token finish first (`device-transferred`), so a device that changes hands never receives the previous owner's notifications.
- `DELETE` removes the token only when the presenting session registered it (another session or user gets `200` and nothing changes, as in legacy). Pending deliveries to the removed token finish (`device-removed`). An APNs token in any letter case matches.
- **Logout** deletes the session and, by the `push_devices → sessions` cascade, its devices. **Expired sessions** keep their rows until purged at the next sign-in, but the worker never sends to a device whose session has expired (see below).
- The client must send the APNs environment its build actually uses. A token sent to the wrong gateway fails with `BadDeviceToken` and the device is removed; the app re-registers on its next launch.
- When the legacy transport is retired (`Push__Expo__Enabled=false`), Expo registrations are refused with the same 400. Node rejects APNs bodies (its token pattern fails), so native clients must only register against .NET.

## Events, recipients and payloads

Financial writers add `push_outbox` rows **in the same transaction** as the mutation and its audit row (MAZ-57/58/59): `expense.created`, `expense.updated` (shared expense writes and recurring occurrences) and `reimbursement.created` (settlement). One row per *current member except the actor*. A mutation that rolls back leaves no outbox row (`PushDeliveryTests.whenExpenseWriteFails_*`). Expense deletions, membership changes and rule edits never notify (legacy).

The payload is the legacy deep-link object, stored as `jsonb` and validated again before sending (the legacy zod `payload`): `householdId` and optional `expenseId` (`[A-Za-z0-9_-]{1,100}`), `month` (`YYYY-MM`), `eventId` (1–100 characters). An invalid stored payload fails permanently (`invalid-payload`). Clients navigate only to the allowlisted `/households/{householdId}?month=…&expenseId=…` route (`src/data/push.ts`).

Notification text never names people, amounts or titles, so lock screens reveal nothing financial:

| Event | Title | Body |
| --- | --- | --- |
| `expense.created` | New household expense | A member added an expense. Open Penny to see your share. |
| `expense.updated` | Household expense updated | A shared expense changed. Open Penny to review it. |
| `reimbursement.created` | Reimbursement recorded | A household reimbursement was recorded. |

**APNs request** — `POST https://api.push.apple.com/3/device/{token}` (production) or `https://api.sandbox.push.apple.com/3/device/{token}` (sandbox), HTTP/2 only:

```text
authorization: bearer <ES256 provider token>
apns-topic: <Push__Apns__Topic, the bundle id>
apns-push-type: alert
apns-priority: 10
apns-expiration: <message created_at + 24 h, Unix seconds>
apns-collapse-id: <outbox id>
apns-id: <UUID derived from outbox id + token; stable across retries>
```

```json
{
  "aps": {
    "alert": { "title": "New household expense", "body": "A member added an expense. Open Penny to see your share." },
    "sound": "default",
    "thread-id": "household-<householdId>"
  },
  "householdId": "<id>", "month": "2026-09", "expenseId": "<id>", "eventId": "<id>"
}
```

The deep-link keys are top-level custom keys (MAZ-79 reads them from `userInfo`); `expenseId` is omitted for reimbursements. `thread-id` groups a household's notifications.

**Expo request** — unchanged legacy shape to `https://exp.host/--/api/v2/push/send` (batches of up to 100): `{to, title, body, sound: "default", channelId: "households", data: <payload>}`, followed by receipt checks at `…/getReceipts`.

## Delivery: outbox, leases and retries

`PushDeliveryWorker` (hosted, `Push__Worker`, default on) runs a pass, then checks due Expo receipts, then waits `Push__PollSeconds` (default 15, the legacy interval) unless the pass claimed a full batch. **Any number of processes may run it**; PostgreSQL leases keep them apart, and all state lives in PostgreSQL so a restart resumes where it stopped.

1. **Claim.** One short transaction leases up to 25 due, unleased outbox rows (`sent_at IS NULL AND next_attempt_at <= now`) to a fresh random token for 2 minutes (`lease_owner/token/expires_at`). The pattern is MAZ-59's: read candidates through the partial `ix_push_outbox_due` index, one conditional `UPDATE` (the row lock serializes competing claims; the loser re-checks the predicate against the winner's lease), read back the rows leased to this token. While a runner holds a message's lease, only it touches that message's deliveries.
2. **Prepare** (one READ COMMITTED transaction per message, which first extends the lease with a conditional update and so holds the row lock):
   - A message older than **24 hours** finishes undelivered (`expired`).
   - On first use, deliveries are planned for the recipient's devices **with a live session** (`push_deliveries`, one per token, with the device's provider). Devices registered after a message's deliveries were planned do not receive it (legacy).
   - Pending deliveries whose device was removed, transferred to another user, or whose session ended finish undelivered (`device-removed`). *A logged-out, expired or transferred device never receives the user's data.*
   - Up to 20 due deliveries are taken; their `attempts` is incremented and `next_attempt_at` moved to the lease end **before** anything is sent, so a crash never loses an attempt.
3. **Send.** Deliveries are grouped by the device's current provider and environment. APNs requests run 8 at a time over HTTP/2.
4. **Record** (one transaction per message): each outcome is applied, the message is marked sent once no delivery is pending (otherwise rescheduled to its earliest pending delivery), and the lease is released. Outcomes are recorded even if the lease was lost meanwhile (they are facts); only the release requires the lease.

| Outcome | Delivery | Device |
| --- | --- | --- |
| Accepted (APNs 200 / Expo `ok` ticket) | `sent_at`, `ticket_id` (`apns-id` or Expo ticket). APNs: done. Expo: receipt due in 15 minutes | kept |
| Retry | `next_attempt_at` = now + 5 s × 2^(attempts−1), at most 1 hour, or the provider's longer `Retry-After` (≤ 1 h); `last_error` | kept |
| Permanent | finished with `last_error` | kept |
| Invalid token | finished; every other pending delivery to the token finishes too | **deleted**, unless it was registered again after the rejected send was claimed (a fresh registration proves the token valid) |

APNs classification (`ApnsTransport.Classify`, reasons from Apple's documented error list):

| Status / reason | Outcome |
| --- | --- |
| 410 (`Unregistered`, `ExpiredToken`), 400 `BadDeviceToken` | Invalid token |
| 403 `ExpiredProviderToken` | Retry; the provider token is replaced if it is at least 20 minutes old |
| 403 `InvalidProviderToken`/`MissingProviderToken`/`BadCertificate`/`BadCertificateEnvironment`/`Forbidden`, 400 `BadTopic`/`TopicDisallowed`/`MissingTopic`/`DeviceTokenNotForTopic` | Retry and a configuration warning in the log: fixing `Push__Apns__*` still delivers messages younger than 24 h, and no device is removed because of a server misconfiguration |
| 429, 5xx, network error, 10-second timeout | Retry |
| Other 4xx (`BadPayload`, `PayloadTooLarge`, `BadExpirationDate`, …) | Permanent |

Expo keeps the legacy rules: whole-request 4xx other than 429 is permanent, other failures retry; `DeviceNotRegistered` tickets and receipts delete the device; `MessageRateExceeded` retries; other ticket errors are permanent. Receipts are claimed with the delivery's own lease columns 15 minutes after acceptance; rate-limited or missing receipts retry with the same backoff and are closed after 24 hours.

### At-least-once and its limits

Delivery is **at least once**. A notification can be sent twice when a runner crashes, is cancelled or loses its lease (a send outliving the 2-minute lease) between sending and recording: the next runner resends after the lease expires (`PushConcurrencyTests`). Both sends carry the same `apns-collapse-id`, so iOS replaces the earlier banner instead of showing two; Expo has no equivalent. Neither APNs nor Expo deduplicates, and a provider acceptance is not proof of display (Apple stores one notification per app for an offline device, and drops it at `apns-expiration`). A device removed or logged out *during* an in-flight send can still receive that one notification. Messages that cannot be delivered within 24 hours are dropped (`expired`); this bound is new — the legacy sender retried forever.

## Configuration

| Setting | Default / behavior |
| --- | --- |
| `Push__Worker` | `true`; `false` stops this process from delivering (another process may). At least one process must run it |
| `Push__PollSeconds` | 15 (legacy timer); idle delay between passes, bounded 1–3,600 |
| `Push__Expo__Enabled` | `true`. `false` retires the legacy Expo transport: Expo registrations are refused and pending Expo deliveries finish as `expo-retired`. Follow the [retirement gates](#token-and-provider-migration) |
| `Push__Apns__TeamId` | 10-character Apple Developer team id |
| `Push__Apns__KeyId` | 10-character id of the APNs auth key |
| `Push__Apns__Topic` | The iOS app's bundle id |
| `Push__Apns__PrivateKeyPath` / `Push__Apns__PrivateKey` | Exactly one: an absolute path to the `.p8` file (mode 0600, owned by the service user) or its PEM text from the secret manager |

Set all APNs settings or none. A partial or invalid configuration (unreadable file, not an ECDSA P-256 key, malformed ids) stops the host before it listens, naming the setting and never echoing the key. Without APNs settings the host starts, logs a warning, and APNs deliveries wait as `apns:not-configured` (retrying with backoff) until configured or expired; Expo continues.

### Apple credentials

1. In the Apple Developer account, **Certificates, Identifiers & Profiles → Keys**, create a key with *Apple Push Notifications service (APNs)* enabled. Download the `.p8` once (Apple will not show it again) and note its **Key ID** and the account's **Team ID**.
2. Ensure the app identifier (bundle id, `Push__Apns__Topic`) has the *Push Notifications* capability; MAZ-79 adds the entitlement (`aps-environment`) to the native app.
3. Store the `.p8` in the secret manager. One token-based key works for both sandbox and production and for every app in the team; it does not expire, so rotation is manual: create a new key, deploy the new `KeyId` and key, then revoke the old key in the portal.
4. The provider token is an ES256 JWT `{alg: ES256, kid: KeyId}.{iss: TeamId, iat}` signed with the key. It is reused for 40 minutes (Apple rejects tokens older than an hour and throttles refreshes more often than every 20 minutes) and never logged.

The key, provider tokens, device tokens, payloads and response bodies never appear in logs, `last_error` or command output.

## Token and provider migration

During coexistence a user can have any mix of Expo tokens (legacy React Native installs, Android) and APNs tokens (the native iOS app); each device receives each message through its own transport.

- **Imported state.** `import-sqlite` copies `push_devices`, `push_outbox` and `push_deliveries` unchanged; every imported device and delivery gets `provider = 'expo'` and no environment (`ImportedPushTests`). Imported messages older than 24 hours expire on their first claim instead of being sent.
- **Moving a device to APNs.** The native app registers its APNs token under its own session; nothing links it to an earlier Expo token, so a device that ran both apps can briefly receive both until the legacy app's session ends or its token is rejected.
- **Retiring Expo** (`Push__Expo__Enabled=false`) only after all gates hold: the native iOS app with APNs registration (MAZ-79) is the supported iOS client; no Android or legacy React Native client remains supported; the monitoring query below shows no Expo deliveries for at least 30 days and no live Expo devices except accepted leftovers; the physical-device smoke test passes in production. Retiring is reversible (set it back to `true`), but Expo deliveries finished while retired are not resent. Removing the Expo transport code, the Expo token pattern and the `provider = 'expo'` rows follows in a later change once the setting has been off for a release.

## Monitoring

Logs (`PushDeliveryWorker`, `ApnsTransport`) carry only counts, provider reason codes and exception types: per-pass accepted/retrying/failed/invalid counts, receipt counts, APNs configuration rejections, and per-message or per-pass failures. Useful read-only queries (runtime role):

```sql
-- Backlog and age of undelivered messages
SELECT count(*), min(created_at) FROM penny.push_outbox WHERE sent_at IS NULL;
-- Outcomes per provider in the last day (NULL last_error = delivered)
SELECT provider, coalesce(last_error, 'accepted') AS outcome, count(*)
FROM penny.push_deliveries d JOIN penny.push_outbox o ON o.id = d.outbox_id
WHERE o.created_at > now() - interval '1 day' GROUP BY 1, 2 ORDER BY 1, 3 DESC;
-- Live devices per provider and environment
SELECT provider, environment, count(*) FROM penny.push_devices GROUP BY 1, 2;
-- Leases held past expiry (a stuck or crashed worker; they are taken over automatically)
SELECT count(*) FROM penny.push_outbox WHERE lease_expires_at < now();
```

Alert on a growing backlog, many `expired` rows, or any `apns:403:*`/`apns:400:BadTopic`-style configuration reasons.

## Physical-device smoke test

APNs delivery can only be proven with Apple's gateway and a real device. Run this before enabling APNs in an environment, after rotating the key, and before retiring Expo:

1. Install a build of the native app (MAZ-79) on a physical iPhone, allow notifications, and copy the APNs token the app registers (development builds log it; or read the newest `push_devices` row with `provider = 'apns'`). Use `sandbox` for Xcode/development builds and `production` for TestFlight/App Store builds.
2. With the deployment's `Push__Apns__*` settings: `bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- push-smoke-apns <TOKEN> sandbox|production`. It sends one synthetic "Penny push test" alert without the database or HTTP host and prints `accepted` (exit 0) or the reason code (exit 2; 1 for usage/configuration errors). It never prints the token.
3. Confirm the banner appears on the locked and the unlocked device. Then do an end-to-end check: a second account in the same household adds a shared expense; the device shows "New household expense" within one poll interval, and tapping it opens that household month with the expense (MAZ-79 navigation).
4. Negative checks: run the command with the other environment (expect `apns:400:BadDeviceToken`); sign out on the device and add another expense (no notification).

Record the date, build, environment and results with the release ([verification](verification.md)).

### Simulator limitations

The iOS Simulator cannot prove APNs delivery: simulator device tokens and `xcrun simctl push` (or dragging an `.apns` file) inject a notification locally without Apple's gateway, the provider token, the topic or the environment, so they exercise only the app's presentation and tap navigation (MAZ-79), not this backend. Notification Service Extensions and some interruption behaviors also differ. Backend correctness is covered by the fake-provider tests above; gateway behavior only by the physical-device test.

## Test controls

In MAZ-62 full-stack runs, `push` fault rules now apply: before each provider call the worker asks the registry for a `push` rule whose `method` names the provider (`apns` or `expo`, or any when unset). The rule waits `delayMs`, then `abort` answers every message in the call with a network retry, `status` 410 with an invalid token (the device is removed), 429/5xx with a retry and other 4xx with a permanent failure; a rule with neither lets the real provider answer. See [test environment](test-environment.md#test-controls).

## Deliberate differences from the legacy service

- APNs is a second transport with its own registration fields; Expo behavior is unchanged.
- Messages expire after 24 hours (legacy retried forever); APNs gets the same `apns-expiration`.
- Leases are explicit columns with random tokens (legacy reused `next_attempt_at` as a lease), so any number of processes can deliver.
- Invalid-token cleanup spares a token registered again after the rejected send; legacy deleted it.
- Per-delivery `last_error` and `provider` columns support monitoring; `push_outbox.attempts` counts send passes (legacy left it 0).
- Retry delays honor a provider's longer `Retry-After` (capped at 1 hour).
